"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { emitNotificationsChanged } from "@/lib/notify-events";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payload: {
    todo_id?: string;
    resolution_id?: string;
    conflicting_todo_ids?: string[];
    note?: string;
  } | null;
  is_read: boolean;
  created_at: string;
  space_id: string | null;
};

type ResolutionRow = {
  id: string;
  todo_id: string;
  space_id: string | null;
  status: string;
  creator_id: string;
  user_id: string;
  conflicting_todo_ids: string[];
  note: string | null;
};

type TodoConflictInfo = {
  id: string;
  title: string;
  space_id: string;
  space_name: string;
};

function formatTodoLabel(t: TodoConflictInfo | undefined, fallbackId?: string) {
  if (!t) return fallbackId ? `未知任务（${fallbackId.slice(0, 8)}…）` : "未知任务";
  return `${t.space_name} · ${t.title}`;
}

function normalizeSpaceName(
  spaces: unknown,
): string {
  const raw = Array.isArray(spaces) ? spaces[0] : spaces;
  const name = (raw as { name?: string } | null)?.name;
  return name?.trim() || "未命名空间";
}

export function NotificationsPanel() {
  const router = useRouter();
  const supabase = createClient();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [resolutions, setResolutions] = useState<ResolutionRow[]>([]);
  const [todoById, setTodoById] = useState<Record<string, TodoConflictInfo>>(
    {},
  );
  const [myId, setMyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [escalateId, setEscalateId] = useState<string | null>(null);
  const [escalateNote, setEscalateNote] = useState("");

  const load = useCallback(
    async (history = showHistory) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setMyId(user.id);

      const q = supabase
        .from("notifications")
        .select("id, type, title, body, payload, is_read, created_at, space_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(history ? 100 : 30);

      let notes: NotificationRow[] = [];
      if (!history) {
        // 默认只显示未读；已读请到「查看历史消息」
        const { data: unread } = await supabase
          .from("notifications")
          .select(
            "id, type, title, body, payload, is_read, created_at, space_id",
          )
          .eq("user_id", user.id)
          .eq("is_read", false)
          .order("created_at", { ascending: false })
          .limit(30);
        notes = (unread as NotificationRow[]) ?? [];
      } else {
        const { data } = await q;
        notes = (data as NotificationRow[]) ?? [];
      }
      setItems(notes);

      const { data: res } = await supabase
        .from("conflict_resolutions")
        .select(
          "id, todo_id, space_id, status, creator_id, user_id, conflicting_todo_ids, note",
        )
        .or(`user_id.eq.${user.id},creator_id.eq.${user.id}`)
        .in("status", ["pending", "escalated"])
        .order("created_at", { ascending: false })
        .limit(20);

      const resolutionsRows = (res as ResolutionRow[]) ?? [];
      setResolutions(resolutionsRows);

      // 拉齐冲突相关任务：空间名 + 标题
      const idSet = new Set<string>();
      for (const r of resolutionsRows) {
        if (r.todo_id) idSet.add(r.todo_id);
        for (const cid of r.conflicting_todo_ids ?? []) idSet.add(cid);
      }
      for (const n of notes) {
        if (n.type !== "conflict") continue;
        if (n.payload?.todo_id) idSet.add(n.payload.todo_id);
        for (const cid of n.payload?.conflicting_todo_ids ?? []) idSet.add(cid);
      }

      const ids = [...idSet];
      if (ids.length === 0) {
        setTodoById({});
        return;
      }

      const { data: todos } = await supabase
        .from("todos")
        .select("id, title, space_id, spaces(name)")
        .in("id", ids);

      const map: Record<string, TodoConflictInfo> = {};
      for (const row of todos ?? []) {
        map[row.id as string] = {
          id: row.id as string,
          title: (row.title as string) || "未命名任务",
          space_id: row.space_id as string,
          space_name: normalizeSpaceName(row.spaces),
        };
      }
      setTodoById(map);
    },
    [supabase, showHistory],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 实时刷新通知与待处理冲突
  useEffect(() => {
    if (!myId) return;
    const ch = supabase
      .channel(`notifications-panel-${myId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${myId}`,
        },
        () => {
          void load();
          emitNotificationsChanged();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conflict_resolutions",
        },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [myId, supabase, load]);

  async function markRead(id: string) {
    const snapshot = items.find((n) => n.id === id);
    // 立刻从列表消失 / 标已读
    if (!showHistory) {
      setItems((prev) => prev.filter((n) => n.id !== id));
    } else {
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    }
    emitNotificationsChanged();
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);
    if (error && snapshot) {
      setItems((prev) =>
        prev.some((n) => n.id === id) ? prev : [snapshot, ...prev],
      );
      setMsg(error.message);
      emitNotificationsChanged();
    }
  }

  async function markAllRead() {
    if (!myId) return;
    const snapshot = items;
    if (!showHistory) {
      setItems([]);
      setMsg("已全部标为已读，可在「查看历史消息」中查看");
    } else {
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setMsg("已全部标为已读");
    }
    emitNotificationsChanged({ notesCleared: true });
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", myId)
      .eq("is_read", false);
    if (error) {
      setItems(snapshot);
      setMsg(error.message);
      emitNotificationsChanged();
    }
  }

  async function deleteNote(id: string) {
    const snapshot = items.find((n) => n.id === id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    emitNotificationsChanged();
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", id);
    if (error && snapshot) {
      setItems((prev) =>
        prev.some((n) => n.id === id) ? prev : [snapshot, ...prev],
      );
      setMsg(error.message);
      emitNotificationsChanged();
    }
  }

  function openConflictCalendar(spaceId: string | null | undefined, todoId: string) {
    if (!spaceId) {
      setMsg("该冲突未关联空间");
      return;
    }
    startTransition(() => {
      router.push(
        `/app/spaces/${spaceId}?view=calendar&focus=${encodeURIComponent(todoId)}`,
      );
    });
  }

  async function openNote(n: NotificationRow) {
    void markRead(n.id);
    if (n.type === "conflict") {
      const todoId = n.payload?.todo_id;
      const info = todoId ? todoById[todoId] : undefined;
      const spaceId = info?.space_id || n.space_id;
      if (spaceId && todoId) {
        openConflictCalendar(spaceId, todoId);
        return;
      }
    }
    if (n.space_id) {
      startTransition(() => {
        router.push(`/app/spaces/${n.space_id}?view=calendar`);
      });
      return;
    }
    setMsg("该消息未关联空间");
  }

  async function selfResolve(id: string) {
    const snapshot = resolutions.find((r) => r.id === id);
    setResolutions((prev) => prev.filter((r) => r.id !== id));
    setMsg("已标记为自行解决（未通知创建人）");
    emitNotificationsChanged();
    const { error } = await supabase.rpc("resolve_conflict_self", {
      p_resolution_id: id,
    });
    if (error) {
      if (snapshot) {
        setResolutions((prev) =>
          prev.some((r) => r.id === id) ? prev : [snapshot, ...prev],
        );
      }
      setMsg(error.message);
      emitNotificationsChanged();
    }
  }

  async function submitEscalate() {
    if (!escalateId) return;
    const note = escalateNote.trim();
    if (!note) {
      setMsg("发给创建人需要填写原因");
      return;
    }
    const id = escalateId;
    const snapshot = resolutions.find((r) => r.id === id);
    setResolutions((prev) => prev.filter((r) => r.id !== id));
    setEscalateId(null);
    setEscalateNote("");
    setMsg("已发给创建人");
    emitNotificationsChanged();
    const { error } = await supabase.rpc("escalate_conflict_resolution", {
      p_resolution_id: id,
      p_note: note,
    });
    if (error) {
      if (snapshot) {
        setResolutions((prev) =>
          prev.some((r) => r.id === id) ? prev : [snapshot, ...prev],
        );
      }
      setEscalateId(id);
      setEscalateNote(note);
      setMsg(error.message);
      emitNotificationsChanged();
    }
  }

  async function dismiss(id: string) {
    const snapshot = resolutions.find((r) => r.id === id);
    setResolutions((prev) => prev.filter((r) => r.id !== id));
    setMsg("已关闭");
    emitNotificationsChanged();
    const { error } = await supabase.rpc("dismiss_conflict_resolution", {
      p_resolution_id: id,
    });
    if (error) {
      if (snapshot) {
        setResolutions((prev) =>
          prev.some((r) => r.id === id) ? prev : [snapshot, ...prev],
        );
      }
      setMsg(error.message);
      emitNotificationsChanged();
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">消息中心</h1>
          <p className="mt-1 text-sm text-zinc-500">通知、冲突与历史消息</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-xl bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800"
            onClick={() => void markAllRead()}
          >
            一键已读
          </button>
          <button
            type="button"
            className="rounded-xl border border-[#2f5f8f]/55 px-3 py-1.5 text-sm font-medium text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7]"
            onClick={() => {
              const next = !showHistory;
              setShowHistory(next);
              void load(next);
            }}
          >
            {showHistory ? "只看最近" : "查看历史消息"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        {resolutions.length > 0 ? (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-medium text-zinc-500">
              待处理冲突
              <span className="ml-1 font-normal text-zinc-400">
                （角标含此处条数；「一键已读」只清下方通知，冲突需解决或忽略）
              </span>
            </p>
            {resolutions.map((r) => {
              const iAmAssignee = r.user_id === myId;
              const iAmCreator = r.creator_id === myId;
              const samePerson = r.creator_id === r.user_id;
              const primary = todoById[r.todo_id];
              const others = (r.conflicting_todo_ids ?? []).filter(
                (id) => id !== r.todo_id,
              );
              const openSpaceId = primary?.space_id || r.space_id;
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-red-100 bg-red-50/60 p-3 text-sm"
                >
                  <button
                    type="button"
                    className="w-full text-left font-medium text-zinc-800"
                    onClick={() =>
                      openConflictCalendar(openSpaceId, r.todo_id)
                    }
                    disabled={!openSpaceId}
                  >
                    {r.status === "escalated"
                      ? "已打回创建人"
                      : samePerson
                        ? "日程冲突 · 需要修改 → 打开日历"
                        : "日程冲突 → 打开日历"}
                  </button>
                  <div className="mt-1.5 space-y-1 text-xs text-zinc-600">
                    <p>
                      <span className="text-zinc-400">任务 </span>
                      {openSpaceId ? (
                        <button
                          type="button"
                          className="font-medium text-[#2f5f8f] underline-offset-2 hover:underline"
                          onClick={() =>
                            openConflictCalendar(openSpaceId, r.todo_id)
                          }
                        >
                          {formatTodoLabel(primary, r.todo_id)}
                        </button>
                      ) : (
                        <span className="font-medium text-zinc-800">
                          {formatTodoLabel(primary, r.todo_id)}
                        </span>
                      )}
                    </p>
                    {others.length > 0 ? (
                      <div>
                        <p className="text-zinc-400">
                          与以下 {others.length} 项重叠
                        </p>
                        <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                          {others.map((id) => {
                            const t = todoById[id];
                            return (
                              <li key={id}>
                                {t?.space_id ? (
                                  <button
                                    type="button"
                                    className="text-left text-[#2f5f8f] underline-offset-2 hover:underline"
                                    onClick={() =>
                                      openConflictCalendar(t.space_id, id)
                                    }
                                  >
                                    {formatTodoLabel(t, id)}
                                  </button>
                                ) : (
                                  formatTodoLabel(t, id)
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-zinc-400">
                        重叠 {r.conflicting_todo_ids?.length ?? 0} 项
                      </p>
                    )}
                  </div>
                  {r.status === "escalated" && r.note ? (
                    <p className="mt-1 text-xs text-zinc-600">原因：{r.note}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {iAmAssignee && r.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          className="rounded-lg bg-zinc-900 px-2 py-1 text-xs font-medium text-white transition-colors duration-200 hover:bg-zinc-800"
                          onClick={() => void selfResolve(r.id)}
                        >
                          {samePerson ? "已改时段，确认解决" : "自己解决"}
                        </button>
                        {!samePerson ? (
                          <button
                            type="button"
                            className="rounded-lg border border-[#2f5f8f]/55 bg-white px-2 py-1 text-xs font-medium text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7]"
                            onClick={() => {
                              setEscalateId(r.id);
                              setEscalateNote("");
                            }}
                          >
                            发给创建人
                          </button>
                        ) : null}
                        <p className="w-full text-[10px] text-zinc-400">
                          {samePerson
                            ? "这是你创建的任务：请先在日历修改重叠时段，再点确认（不会另发消息给他人）"
                            : "「自己解决」：先改时段再确认，不会通知创建人；「发给创建人」才会通知对方（需填原因）"}
                        </p>
                        {escalateId === r.id ? (
                          <div className="mt-1 w-full space-y-1.5 rounded-lg border border-zinc-200 bg-white p-2">
                            <label className="block text-[11px] text-zinc-600">
                              发给创建人的原因（必填）
                              <textarea
                                className="mt-1 w-full rounded-lg border border-brand/40 px-2 py-1.5 text-xs text-[var(--brand-ink)] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                                rows={2}
                                value={escalateNote}
                                onChange={(e) => setEscalateNote(e.target.value)}
                                placeholder="例如：时段无法挪动，请改期或换人"
                              />
                            </label>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                className="rounded-lg bg-zinc-900 px-2 py-1 text-xs font-medium text-white transition-colors duration-200 hover:bg-zinc-800"
                                onClick={() => void submitEscalate()}
                              >
                                确认发送
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-[#2f5f8f]/55 px-2 py-1 text-xs text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7]"
                                onClick={() => {
                                  setEscalateId(null);
                                  setEscalateNote("");
                                }}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {iAmCreator && r.status === "escalated" ? (
                      <button
                        type="button"
                        className="rounded-lg border border-[#2f5f8f]/55 bg-white px-2 py-1 text-xs font-medium text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7]"
                        onClick={() => void dismiss(r.id)}
                      >
                        我已处理，关闭
                      </button>
                    ) : null}
                    {/* 冲突不在 notifications 已读里；忽略/关闭走 conflict_resolutions */}
                    {(iAmAssignee || iAmCreator) &&
                    (r.status === "pending" || r.status === "escalated") &&
                    !(iAmCreator && r.status === "escalated") ? (
                      <button
                        type="button"
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 transition-colors duration-200 hover:bg-zinc-50"
                        onClick={() => void dismiss(r.id)}
                      >
                        忽略关闭
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <ul className="divide-y divide-zinc-100">
          {items.length === 0 ? (
            <li className="py-10 text-center text-sm text-zinc-400">
              {showHistory ? "暂无历史消息" : "暂无通知"}
            </li>
          ) : (
            items.map((n) => (
              <li key={n.id} className="flex items-start gap-2 py-3">
                <button
                  type="button"
                  onClick={() => openNote(n)}
                  className={[
                    "min-w-0 flex-1 text-left",
                    n.is_read ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <p className="text-sm font-medium text-zinc-800">
                    {n.title}
                    {!n.is_read ? (
                      <span className="ml-1 text-red-500">·</span>
                    ) : null}
                  </p>
                  {n.body ? (
                    <p className="mt-0.5 text-xs text-zinc-500">{n.body}</p>
                  ) : null}
                  {n.type === "conflict" ? (
                    <div className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
                      {n.payload?.todo_id ? (
                        <p>
                          任务{" "}
                          <span className="font-medium text-zinc-700">
                            {formatTodoLabel(
                              todoById[n.payload.todo_id],
                              n.payload.todo_id,
                            )}
                          </span>
                        </p>
                      ) : null}
                      {(n.payload?.conflicting_todo_ids ?? []).filter(
                        (id) => id !== n.payload?.todo_id,
                      ).length > 0 ? (
                        <p>
                          重叠{" "}
                          {(n.payload?.conflicting_todo_ids ?? [])
                            .filter((id) => id !== n.payload?.todo_id)
                            .map((id) =>
                              formatTodoLabel(todoById[id], id),
                            )
                            .join("；")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  aria-label="删除"
                  title="删除"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-lg leading-none text-zinc-400 hover:bg-zinc-100 hover:text-red-600"
                  onClick={() => void deleteNote(n.id)}
                >
                  ×
                </button>
              </li>
            ))
          )}
        </ul>
        {msg ? <p className="mt-3 text-xs text-zinc-500">{msg}</p> : null}
      </div>
    </div>
  );
}

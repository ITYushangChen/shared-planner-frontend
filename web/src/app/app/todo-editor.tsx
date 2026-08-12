"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { notifyTodoAssignment } from "@/lib/notify";
import {
  emitTodoDeleted,
  emitTodoUpserted,
} from "@/lib/todo-schedule-events";
import { suppressTodosRealtimeRefresh } from "@/lib/todos-realtime-gate";
import {
  allDayRangeToIso,
  type SpaceMemberOption,
  type TodoRow,
} from "@/lib/todos";
import { resolveTodoColor } from "@/lib/ui-prefs";
import { DEFAULT_DEPARTMENT, DEPARTMENT_OPTIONS } from "@/lib/departments";
import { TodoComments } from "./todo-comments";
import { useUiPrefsOptional } from "./ui-prefs-provider";

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Props = {
  todo: TodoRow;
  members: SpaceMemberOption[];
  open: boolean;
  onClose: () => void;
  canAssign?: boolean;
  /** 打开时展示的提示（如未排期拖入需设时间） */
  hintMessage?: string;
};

export function TodoEditor({
  todo,
  members,
  open,
  onClose,
  canAssign = false,
  hintMessage,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const uiPrefs = useUiPrefsOptional()?.globalPrefs;
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? "");
  const [priority, setPriority] = useState(todo.priority);
  const [color, setColor] = useState(todo.color ?? "");
  const [department, setDepartment] = useState(
    todo.department ?? DEFAULT_DEPARTMENT,
  );
  const [status, setStatus] = useState(todo.status);
  const previewColor = resolveTodoColor(
    color.trim() || null,
    priority,
    uiPrefs,
  );
  const [isAllDay, setIsAllDay] = useState(todo.is_all_day);
  const [startLocal, setStartLocal] = useState(toLocalInput(todo.start_at));
  const [endLocal, setEndLocal] = useState(toLocalInput(todo.end_at));
  const [startDate, setStartDate] = useState(toDateInput(todo.start_at));
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    (todo.todo_assignees ?? []).map((a) => a.user_id),
  );
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [durationMin, setDurationMin] = useState(60);

  useEffect(() => {
    if (!open) return;
    setTitle(todo.title);
    setDescription(todo.description ?? "");
    setPriority(todo.priority);
    setColor(todo.color ?? "");
    setDepartment(todo.department ?? DEFAULT_DEPARTMENT);
    setStatus(todo.status);
    setIsAllDay(todo.is_all_day);
    setStartLocal(toLocalInput(todo.start_at));
    setEndLocal(toLocalInput(todo.end_at));
    setStartDate(toDateInput(todo.start_at));
    setAssigneeIds((todo.todo_assignees ?? []).map((a) => a.user_id));
    if (todo.start_at && todo.end_at && !todo.is_all_day) {
      const mins = Math.max(
        1,
        Math.round(
          (new Date(todo.end_at).getTime() -
            new Date(todo.start_at).getTime()) /
            60000,
        ),
      );
      setDurationMin(mins);
    } else if (
      typeof todo.duration_minutes === "number" &&
      todo.duration_minutes > 0
    ) {
      setDurationMin(Math.round(todo.duration_minutes));
    } else {
      setDurationMin(60);
    }
    setMsg(hintMessage?.trim() || "");

    // 日历精简查询不含 description，打开时补拉
    if (todo.description != null) return;
    let cancelled = false;
    void supabase
      .from("todos")
      .select("description")
      .eq("id", todo.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.description != null) {
          setDescription(data.description);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [todo, open, supabase, hintMessage]);

  if (!open) return null;

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function buildTimes() {
    const mins = Math.max(1, durationMin || 60);
    if (isAllDay) {
      if (!startDate) {
        return { start_at: null, end_at: null, duration_minutes: mins };
      }
      const range = allDayRangeToIso(startDate);
      return {
        start_at: range.start_at,
        end_at: range.end_at,
        duration_minutes: null as number | null,
      };
    }
    const start_at = startLocal ? new Date(startLocal).toISOString() : null;
    let end_at = endLocal ? new Date(endLocal).toISOString() : null;
    let duration_minutes: number | null = mins;
    if (start_at && !end_at) {
      end_at = new Date(
        new Date(start_at).getTime() + mins * 60 * 1000,
      ).toISOString();
    } else if (start_at && end_at) {
      const ms =
        new Date(end_at).getTime() - new Date(start_at).getTime();
      if (Number.isFinite(ms) && ms > 0) {
        duration_minutes = Math.max(1, Math.round(ms / 60000));
      }
    }
    if (!start_at) end_at = null;
    return { start_at, end_at, duration_minutes };
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg("保存中…");
    const { start_at, end_at, duration_minutes } = buildTimes();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const patch: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      color: color.trim() || null,
      status,
      department,
      is_all_day: isAllDay,
      start_at,
      end_at,
      duration_minutes,
    };

    if (status === "done") {
      patch.completed_by = user?.id ?? null;
      patch.completed_at = new Date().toISOString();
    } else {
      patch.completed_by = null;
      patch.completed_at = null;
    }

    const { error } = await supabase
      .from("todos")
      .update(patch)
      .eq("id", todo.id);

    if (error) {
      setLoading(false);
      setMsg(error.message);
      return;
    }

    // 仅 owner/admin 可改指派；可不选（未排期可无指派人）。成员不改指派表。
    if (canAssign) {
      await supabase.from("todo_assignees").delete().eq("todo_id", todo.id);
      if (assigneeIds.length > 0) {
        const { error: aerr } = await supabase.from("todo_assignees").insert(
          assigneeIds.map((user_id) => ({ todo_id: todo.id, user_id })),
        );
        if (aerr) {
          setLoading(false);
          setMsg(aerr.message);
          return;
        }
      }
    }

    const patched: TodoRow = {
      ...todo,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      color: color.trim() || null,
      status,
      department,
      is_all_day: isAllDay,
      start_at,
      end_at,
      duration_minutes,
      todo_assignees: canAssign
        ? assigneeIds.map((user_id) => ({ user_id }))
        : todo.todo_assignees,
    };
    suppressTodosRealtimeRefresh(6000);
    emitTodoUpserted(patched);
    onClose();

    void notifyTodoAssignment(todo.id);
    setLoading(false);
  }

  async function onSplit() {
    const n = Math.min(14, Math.max(2, splitCount));
    if (!todo.start_at || !todo.end_at) {
      setMsg("请先设置开始/结束时间再拆段");
      return;
    }
    if (todo.parent_todo_id) {
      setMsg("子任务不能再拆段，请编辑父任务");
      return;
    }
    if (!confirm(`将拆成 ${n} 段独立任务，父任务取消排期。继续？`)) return;

    setLoading(true);
    setMsg("拆分中…");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setMsg("请先登录");
      return;
    }

    const startMs = new Date(todo.start_at).getTime();
    const endMs = new Date(todo.end_at).getTime();
    const span = endMs - startMs;
    if (span <= 0) {
      setLoading(false);
      setMsg("结束时间必须晚于开始时间");
      return;
    }
    const slice = Math.floor(span / n);

    for (let i = 0; i < n; i++) {
      const segStart = new Date(startMs + slice * i);
      const segEnd =
        i === n - 1 ? new Date(endMs) : new Date(startMs + slice * (i + 1));
      const { data: child, error } = await supabase
        .from("todos")
        .insert({
          space_id: todo.space_id,
          creator_id: user.id,
          parent_todo_id: todo.id,
          title: `${title.trim() || todo.title}（段${i + 1}）`,
          description: description.trim() || todo.description,
          priority,
          department: todo.department ?? DEFAULT_DEPARTMENT,
          status: "todo",
          start_at: segStart.toISOString(),
          end_at: segEnd.toISOString(),
          is_all_day: false,
          source: "manual",
        })
        .select("id")
        .single();
      if (error || !child) {
        setLoading(false);
        setMsg(error?.message || "拆段失败");
        return;
      }
      const assign =
        assigneeIds.length > 0 ? assigneeIds : [user.id];
      await supabase.from("todo_assignees").insert(
        assign.map((user_id) => ({ todo_id: child.id, user_id })),
      );
      await notifyTodoAssignment(child.id);
    }

    await supabase
      .from("todos")
      .update({ start_at: null, end_at: null, is_all_day: false })
      .eq("id", todo.id);

    setLoading(false);
    setMsg(`已拆成 ${n} 段，可在日历上分别拖动`);
    onClose();
    router.refresh();
  }

  async function onComplete() {
    setStatus("done");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setLoading(true);
    const { error } = await supabase
      .from("todos")
      .update({
        status: "done",
        completed_by: user?.id ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", todo.id);
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    suppressTodosRealtimeRefresh(6000);
    emitTodoUpserted({
      ...todo,
      status: "done",
      completed_by: user?.id ?? null,
      completed_at: new Date().toISOString(),
    });
    onClose();
  }

  async function onClearSchedule() {
    setLoading(true);
    let duration_minutes =
      typeof todo.duration_minutes === "number" && todo.duration_minutes > 0
        ? todo.duration_minutes
        : Math.max(1, durationMin || 60);
    if (todo.start_at && todo.end_at && !todo.is_all_day) {
      const ms =
        new Date(todo.end_at).getTime() - new Date(todo.start_at).getTime();
      if (Number.isFinite(ms) && ms > 0) {
        duration_minutes = Math.max(1, Math.round(ms / 60000));
      }
    }
    const { error } = await supabase
      .from("todos")
      .update({
        start_at: null,
        end_at: null,
        is_all_day: false,
        duration_minutes,
      })
      .eq("id", todo.id);
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    suppressTodosRealtimeRefresh(6000);
    emitTodoUpserted({
      ...todo,
      start_at: null,
      end_at: null,
      is_all_day: false,
      duration_minutes,
    });
    onClose();
  }

  async function onDelete() {
    if (!confirm("确定删除该待办？")) return;
    // 立刻从日历/列表消失，后台再删库
    suppressTodosRealtimeRefresh(6000);
    emitTodoDeleted(todo.id);
    onClose();
    const { error } = await supabase.from("todos").delete().eq("id", todo.id);
    if (error) {
      emitTodoUpserted(todo);
      setMsg(error.message);
      return;
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 md:items-center">
      <form
        onSubmit={onSave}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-900">编辑待办</h3>
          <button type="button" className="text-sm text-zinc-500" onClick={onClose}>
            关闭
          </button>
        </div>

        {hintMessage?.trim() ? (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {hintMessage.trim()}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <label className="text-sm text-zinc-700">
            标题
            <input
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label className="text-sm text-zinc-700">
            描述
            <textarea
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm text-zinc-700">
              重要性
              <select
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={priority === "high" ? "high" : "low"}
                onChange={(e) =>
                  setPriority(e.target.value as TodoRow["priority"])
                }
                style={{
                  borderLeftWidth: 4,
                  borderLeftColor: previewColor,
                }}
              >
                <option value="high">重要</option>
                <option value="low">不重要</option>
              </select>
            </label>
            <label className="text-sm text-zinc-700">
              状态
              <select
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as TodoRow["status"])
                }
              >
                <option value="todo">待办</option>
                <option value="in_progress">进行中</option>
                <option value="done">已完成</option>
              </select>
            </label>
          </div>

          <label className="text-sm text-zinc-700">
            部门
            <select
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              {DEPARTMENT_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-sm text-zinc-700">
              卡片/日历颜色
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="留空则用优先级默认色"
              />
            </label>
            <input
              type="color"
              className="h-10 w-12 cursor-pointer rounded border border-zinc-200"
              value={
                /^#[0-9a-fA-F]{6}$/.test(previewColor)
                  ? previewColor
                  : "#4a6fa5"
              }
              onChange={(e) => setColor(e.target.value)}
            />
            {color ? (
              <button
                type="button"
                className="mb-1 text-xs text-zinc-500 underline"
                onClick={() => setColor("")}
              >
                跟随优先级
              </button>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
            />
            全天事件
          </label>

          {isAllDay ? (
            <label className="text-sm text-zinc-700">
              日期
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm text-zinc-700">
                  开始
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm"
                    value={startLocal}
                    onChange={(e) => {
                      setStartLocal(e.target.value);
                      if (e.target.value && durationMin > 0) {
                        const start = new Date(e.target.value);
                        const end = new Date(
                          start.getTime() + durationMin * 60 * 1000,
                        );
                        const pad = (n: number) => String(n).padStart(2, "0");
                        setEndLocal(
                          `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`,
                        );
                      }
                    }}
                  />
                </label>
                <label className="text-sm text-zinc-700">
                  结束
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                  />
                </label>
              </div>
              <label className="text-sm text-zinc-700">
                任务时长（分钟）
                <input
                  type="number"
                  min={1}
                  max={24 * 60}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm"
                  value={durationMin}
                  onChange={(e) => {
                    const n = Math.max(1, Number(e.target.value) || 1);
                    setDurationMin(n);
                    if (startLocal) {
                      const start = new Date(startLocal);
                      const end = new Date(start.getTime() + n * 60 * 1000);
                      const pad = (x: number) => String(x).padStart(2, "0");
                      setEndLocal(
                        `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`,
                      );
                    }
                  }}
                />
              </label>
            </>
          )}

          {canAssign ? (
            <fieldset className="rounded-lg border border-zinc-200 p-3">
              <legend className="px-1 text-sm text-zinc-700">指派人</legend>
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                {members.length === 0 ? (
                  <p className="text-xs text-zinc-400">暂无成员</p>
                ) : (
                  members.map((m) => (
                    <label
                      key={m.user_id}
                      className="flex items-center gap-2 text-sm text-zinc-700"
                    >
                      <input
                        type="checkbox"
                        checked={assigneeIds.includes(m.user_id)}
                        onChange={() => toggleAssignee(m.user_id)}
                      />
                      {m.display_name}
                      {m.email ? (
                        <span className="text-xs text-zinc-400">{m.email}</span>
                      ) : null}
                    </label>
                  ))
                )}
              </div>
            </fieldset>
          ) : (
            <p className="text-xs text-zinc-400">
              普通成员不能指定指派人；保存时不改动现有指派
            </p>
          )}

          <TodoComments todoId={todo.id} />

          {todo.parent_todo_id ? (
            <p className="text-xs text-amber-700">
              这是长任务的分段，可单独改期 / 改指派
            </p>
          ) : null}

          {todo.completed_at ? (
            <p className="text-xs text-zinc-500">
              完成于 {new Date(todo.completed_at).toLocaleString()}
            </p>
          ) : null}

          {!todo.parent_todo_id ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-zinc-200 p-3">
              <label className="text-xs text-zinc-500">
                拆分为
                <input
                  type="number"
                  min={2}
                  max={14}
                  className="ml-1 w-14 rounded border border-zinc-200 px-1 py-1 text-sm"
                  value={splitCount}
                  onChange={(e) => setSplitCount(Number(e.target.value) || 2)}
                />
                段
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={onSplit}
                className="rounded-xl border border-[#2f5f8f]/55 px-3 py-1.5 text-sm font-medium text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7] disabled:opacity-50"
              >
                拆分长任务
              </button>
              <p className="w-full text-[10px] text-zinc-400">
                均分原时段为子任务，父任务回到待排期；各段可单独拖动
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              保存
            </button>
            <button
              type="button"
              disabled={loading || status === "done"}
              onClick={onComplete}
              className="rounded-xl border border-[#2f5f8f]/55 px-3 py-2 text-sm font-medium text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7] disabled:opacity-50"
            >
              标记完成
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={onClearSchedule}
              className="rounded-xl border border-[#2f5f8f]/55 px-3 py-2 text-sm font-medium text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7] disabled:opacity-50"
            >
              取消排期
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={onDelete}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600"
            >
              删除
            </button>
          </div>
          {msg ? <p className="text-sm text-zinc-500">{msg}</p> : null}
        </div>
      </form>
    </div>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { newId } from "@/lib/id";
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
  type SpaceNavItem,
  type TodoRow,
} from "@/lib/todos";
import { resolveTodoColor } from "@/lib/ui-prefs";
import { useUiPrefsOptional } from "./ui-prefs-provider";

/** 总览：落到个人默认空间（spaces 列表第一项） */
const OVERVIEW_VALUE = "__overview__";

type Props = {
  spaces: SpaceNavItem[];
  defaultSpaceId?: string;
  members?: SpaceMemberOption[];
  membersBySpace?: Record<string, SpaceMemberOption[]>;
  /** 所有者/管理员可指派他人；成员只能给自己 */
  canAssign?: boolean;
  /** 弹窗内使用：去掉外框与标题 */
  bare?: boolean;
  /** 总览页：可选「创建到总览」→ 个人默认空间 */
  allowOverview?: boolean;
  /** 日历点选预填：datetime-local */
  initialStartLocal?: string;
  initialEndLocal?: string;
  initialIsAllDay?: boolean;
  initialStartDate?: string;
  initialPriority?: "high" | "low";
  onCreated?: () => void;
};

export function QuickCreateTodo({
  spaces,
  defaultSpaceId,
  members = [],
  membersBySpace,
  canAssign = false,
  bare = false,
  allowOverview = false,
  initialStartLocal = "",
  initialEndLocal = "",
  initialIsAllDay = false,
  initialStartDate = "",
  initialPriority = "low",
  onCreated,
}: Props) {
  const supabase = createClient();
  const defaultSpace = spaces[0]?.id || "";
  const [title, setTitle] = useState("");
  const [spaceId, setSpaceId] = useState(
    allowOverview && !defaultSpaceId
      ? OVERVIEW_VALUE
      : defaultSpaceId || defaultSpace,
  );
  const resolvedSpaceId =
    spaceId === OVERVIEW_VALUE ? defaultSpace : spaceId;
  const activeMembers = membersBySpace?.[resolvedSpaceId] ?? members;
  const spaceRole = spaces.find((s) => s.id === resolvedSpaceId)?.role;
  const allowAssign =
    canAssign || spaceRole === "owner" || spaceRole === "admin";
  const [isAllDay, setIsAllDay] = useState(initialIsAllDay);
  const [startLocal, setStartLocal] = useState(initialStartLocal);
  const [endLocal, setEndLocal] = useState(initialEndLocal);
  const [startDate, setStartDate] = useState(
    initialStartDate ||
      (initialIsAllDay && initialStartLocal
        ? initialStartLocal.slice(0, 10)
        : ""),
  );
  const [durationMin, setDurationMin] = useState(60);
  const [priority, setPriority] = useState<"high" | "low">(initialPriority);
  const [color, setColor] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const uiPrefs = useUiPrefsOptional()?.globalPrefs;
  const previewColor = resolveTodoColor(
    color.trim() || null,
    priority,
    uiPrefs,
  );

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function applyDuration(startValue: string, minutes: number) {
    if (!startValue || minutes <= 0) return;
    const start = new Date(startValue);
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    setEndLocal(
      `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`,
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !resolvedSpaceId) {
      setMsg("请填写标题并选择空间");
      return;
    }

    setLoading(true);
    setMsg("创建中…");

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setLoading(false);
      setMsg("请先登录");
      return;
    }

    let start_at: string | null = null;
    let end_at: string | null = null;
    let duration_minutes: number | null = Math.max(1, durationMin || 60);
    if (isAllDay && startDate) {
      const range = allDayRangeToIso(startDate);
      start_at = range.start_at;
      end_at = range.end_at;
      duration_minutes = null;
    } else {
      start_at = startLocal ? new Date(startLocal).toISOString() : null;
      end_at = endLocal ? new Date(endLocal).toISOString() : null;
      if (start_at && !end_at) {
        end_at = new Date(
          new Date(start_at).getTime() + duration_minutes * 60 * 1000,
        ).toISOString();
      } else if (start_at && end_at) {
        const ms =
          new Date(end_at).getTime() - new Date(start_at).getTime();
        if (Number.isFinite(ms) && ms > 0) {
          duration_minutes = Math.max(1, Math.round(ms / 60000));
        }
      }
      if (!start_at) {
        end_at = null;
      }
    }

    const hasSchedule = Boolean(start_at);
    const assign =
      allowAssign && assigneeIds.length > 0
        ? assigneeIds
        : hasSchedule
          ? [user.id]
          : [];
    const spaceMeta = spaces.find((s) => s.id === resolvedSpaceId);
    const todoId = newId();
    const optimistic: TodoRow = {
      id: todoId,
      title: title.trim(),
      description: null,
      priority,
      status: "todo",
      start_at,
      end_at,
      is_all_day: isAllDay,
      due_at: null,
      duration_minutes,
      space_id: resolvedSpaceId,
      creator_id: user.id,
      color: color.trim() || null,
      spaces: spaceMeta
        ? { id: spaceMeta.id, name: spaceMeta.name, kind: spaceMeta.kind }
        : null,
      todo_assignees: assign.map((user_id) => ({ user_id })),
    };

    // 立刻出现在日历/未排期，再写库
    suppressTodosRealtimeRefresh(8000);
    emitTodoUpserted(optimistic);
    setTitle("");
    setStartLocal("");
    setEndLocal("");
    setStartDate("");
    setIsAllDay(false);
    setDurationMin(60);
    setAssigneeIds([]);
    setColor("");
    setLoading(false);
    setMsg("");
    onCreated?.();

    const { error } = await supabase.from("todos").insert({
      id: todoId,
      space_id: resolvedSpaceId,
      creator_id: user.id,
      title: optimistic.title,
      priority,
      color: optimistic.color,
      status: "todo",
      start_at,
      end_at,
      is_all_day: isAllDay,
      duration_minutes,
      source: "manual",
    });

    if (error) {
      emitTodoDeleted(todoId);
      setMsg(error.message || "创建失败");
      return;
    }

    if (assign.length > 0) {
      const { error: aerr } = await supabase.from("todo_assignees").insert(
        assign.map((user_id) => ({ todo_id: todoId, user_id })),
      );
      if (aerr) {
        setMsg(aerr.message);
        return;
      }
    }
    if (assign.length > 0 || hasSchedule) {
      void notifyTodoAssignment(todoId);
    }
  }

  if (spaces.length === 0) {
    return (
      <p className="text-sm text-zinc-500">请先创建空间后再添加待办。</p>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={
        bare
          ? "flex flex-col gap-2"
          : "flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3"
      }
    >
      {bare ? null : (
        <h3 className="text-sm font-medium text-zinc-800">快速创建待办</h3>
      )}
      <input
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
        placeholder="待办标题"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <label className="text-xs text-zinc-500">
        创建到
        <select
          className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none"
          value={spaceId}
          onChange={(e) => {
            setSpaceId(e.target.value);
            setAssigneeIds([]);
          }}
        >
          {allowOverview ? (
            <option value={OVERVIEW_VALUE}>
              总览工作区（个人默认空间）
            </option>
          ) : null}
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-600">
        <input
          type="checkbox"
          checked={isAllDay}
          onChange={(e) => setIsAllDay(e.target.checked)}
        />
        全天事件
      </label>
      {isAllDay ? (
        <label className="text-xs text-zinc-500">
          日期
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-zinc-500">
              开始（可选）
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
                value={startLocal}
                onChange={(e) => {
                  setStartLocal(e.target.value);
                  applyDuration(e.target.value, durationMin);
                }}
              />
            </label>
            <label className="text-xs text-zinc-500">
              结束（可选）
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
              />
            </label>
          </div>
          <label className="text-xs text-zinc-500">
            任务时长（分钟，精确）
            <input
              type="number"
              min={1}
              max={24 * 60}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
              value={durationMin}
              onChange={(e) => {
                const n = Number(e.target.value) || 1;
                setDurationMin(n);
                if (startLocal) applyDuration(startLocal, n);
              }}
            />
          </label>
        </>
      )}
      <label className="text-xs text-zinc-500">
        重要性
        <select
          className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
          value={priority === "high" ? "high" : "low"}
          onChange={(e) =>
            setPriority(e.target.value as "high" | "low")
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
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-zinc-500">
          卡片/日历颜色（可选）
          <input
            type="text"
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="留空用优先级默认色"
          />
        </label>
        <input
          type="color"
          className="h-10 w-12 cursor-pointer rounded border border-zinc-200"
          value={
            /^#[0-9a-fA-F]{6}$/.test(previewColor) ? previewColor : "#4a6fa5"
          }
          onChange={(e) => setColor(e.target.value)}
        />
      </div>
      {allowAssign && activeMembers.length > 0 ? (
        <fieldset className="rounded-lg border border-zinc-200 bg-white p-2">
          <legend className="px-1 text-xs text-zinc-500">指派人（可多选，可不选）</legend>
          <div className="flex max-h-24 flex-col gap-1 overflow-y-auto">
            {activeMembers.map((m) => (
              <label
                key={m.user_id}
                className="flex items-center gap-2 text-xs text-zinc-700"
              >
                <input
                  type="checkbox"
                  checked={assigneeIds.includes(m.user_id)}
                  onChange={() => toggleAssignee(m.user_id)}
                />
                {m.display_name}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-zinc-400">
            未排期可不选指派人；已填时间且未选时默认指派自己
          </p>
        </fieldset>
      ) : (
        <p className="text-[11px] text-zinc-400">
          普通成员不能指定指派人；未排期可不指派，填时间后将指派给你自己
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? "创建中…" : "添加待办"}
      </button>
      {msg ? <p className="text-xs text-zinc-500">{msg}</p> : null}
    </form>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  DateSelectArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import type {
  DateClickArg,
  EventDragStopArg,
  EventReceiveArg,
  EventResizeDoneArg,
} from "@fullcalendar/interaction";
import zhCn from "@fullcalendar/core/locales/zh-cn";
import { createClient } from "@/lib/supabase/client";
import { findConflictTodoIds } from "@/lib/conflicts";
import { notifyTodoAssignment } from "@/lib/notify";
import {
  TODO_DELETED,
  TODO_UPSERTED,
  applyTodoDelete,
  applyTodoUpsert,
  emitTodoScheduled,
  emitTodoUnscheduled,
  emitTodoUpserted,
  type TodoDeletedDetail,
  type TodoUpsertedDetail,
} from "@/lib/todo-schedule-events";
import {
  isTodosRealtimeRefreshSuppressed,
  suppressTodosRealtimeRefresh,
} from "@/lib/todos-realtime-gate";
import {
  TODO_SELECT_LEAN,
  allDayRangeToIso,
  localDateKey,
  minutesBetween,
  resolveTodoDurationMinutes,
  todosToEvents,
  type SpaceMemberOption,
  type SpaceNavItem,
  type TodoRow,
} from "@/lib/todos";
import { hexToRgba, resolveTaskOpacity } from "@/lib/ui-prefs";
import { chipClass } from "./ui-btn-class";
import { useUiPrefsOptional } from "./ui-prefs-provider";
import { DEFAULT_DEPARTMENT } from "@/lib/departments";

const FC_PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin];

function todosSignature(list: TodoRow[]) {
  return list
    .map(
      (t) =>
        `${t.id}:${t.start_at}:${t.end_at}:${t.status}:${t.title}:${t.is_all_day}`,
    )
    .join("|");
}

const TodoEditor = dynamic(
  () => import("./todo-editor").then((m) => ({ default: m.TodoEditor })),
  { ssr: false },
);
const QuickCreateTodo = dynamic(
  () =>
    import("./quick-create-todo").then((m) => ({ default: m.QuickCreateTodo })),
  { ssr: false },
);

type CreatePrefill = {
  startLocal: string;
  endLocal: string;
  isAllDay: boolean;
  startDate: string;
};

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatEventTimeRange(
  start: Date | null,
  end: Date | null,
  allDay: boolean,
) {
  if (allDay) return "全天";
  if (!start) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const a = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  if (!end) return a;
  const b = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `${a}~${b}`;
}

type Props = {
  todos: TodoRow[];
  spaces?: SpaceNavItem[];
  defaultSpaceId?: string;
  allowOverview?: boolean;
  members?: SpaceMemberOption[];
  membersBySpace?: Record<string, SpaceMemberOption[]>;
  canAssignBySpace?: Record<string, boolean>;
  title?: string;
  canAssign?: boolean;
  showMineFilter?: boolean;
  mineOnly?: boolean;
  onMineOnlyChange?: (v: boolean) => void;
  /** 手机：去掉说明文案，强化日期切换控件 */
  mobileDateChrome?: boolean;
  /** 隐藏标题与说明条 */
  hideTitle?: boolean;
  /** 与顶栏日/周/月同步（URL range） */
  viewRange?: "day" | "week" | "month";
};

function rangeToFcView(range: "day" | "week" | "month") {
  if (range === "day") return "timeGridDay";
  if (range === "month") return "dayGridMonth";
  return "timeGridWeek";
}

export function TodosCalendar({
  todos: todosProp,
  spaces = [],
  defaultSpaceId,
  allowOverview = false,
  members = [],
  membersBySpace,
  canAssignBySpace,
  title = "日历",
  canAssign = false,
  showMineFilter = false,
  mineOnly = false,
  onMineOnlyChange,
  mobileDateChrome = false,
  hideTitle = false,
  viewRange = "week",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const calendarRef = useRef<FullCalendar>(null);
  const [todos, setTodos] = useState(todosProp);
  const todosRef = useRef(todosProp);
  const todosSigRef = useRef("");
  /** 刚拖过的 id：父级 props 同步时保留本地时段，避免整表重绑闪屏 */
  const dirtyTodoIdsRef = useRef(new Set<string>());
  todosRef.current = todos;
  const [selected, setSelected] = useState<TodoRow | null>(null);
  /** 消息中心冲突跳转：?focus=todoId */
  const focusFromUrl = searchParams.get("focus");
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [focusPulseId, setFocusPulseId] = useState<string | null>(null);
  const [createPrefill, setCreatePrefill] = useState<CreatePrefill | null>(
    null,
  );
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    todo: TodoRow;
  } | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // 父级 props 更新：同内容跳过；有 dirty 则按 id 合并时段，避免整表闪
  useEffect(() => {
    const sig = todosSignature(todosProp);
    if (sig === todosSigRef.current) {
      dirtyTodoIdsRef.current.clear();
      return;
    }
    if (isTodosRealtimeRefreshSuppressed()) return;

    const dirty = dirtyTodoIdsRef.current;
    if (dirty.size === 0) {
      todosSigRef.current = sig;
      todosRef.current = todosProp;
      setTodos(todosProp);
      return;
    }

    const localById = new Map(todosRef.current.map((t) => [t.id, t]));
    const merged = todosProp.map((t) => {
      if (!dirty.has(t.id)) return t;
      const local = localById.get(t.id);
      if (!local) return t;
      // props 已追上本地时段则清 dirty
      if (
        local.start_at === t.start_at &&
        local.end_at === t.end_at &&
        local.is_all_day === t.is_all_day
      ) {
        dirty.delete(t.id);
        return t;
      }
      return {
        ...t,
        start_at: local.start_at,
        end_at: local.end_at,
        is_all_day: local.is_all_day,
        duration_minutes: local.duration_minutes,
      };
    });
    // 本地有、props 暂无的（极少）保留
    for (const id of dirty) {
      const local = localById.get(id);
      if (local && !merged.some((t) => t.id === id)) merged.push(local);
    }

    const mergedSig = todosSignature(merged);
    if (mergedSig === todosSigRef.current) return;
    todosSigRef.current = mergedSig;
    todosRef.current = merged;
    setTodos(merged);
  }, [todosProp]);

  useEffect(() => {
    if (!mobileDateChrome) {
      setIsMobile(false);
      return;
    }
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mobileDateChrome]);

  useEffect(() => {
    // FullCalendar.changeView 内部会 flushSync，须离开当前 React 渲染周期
    const next = rangeToFcView(viewRange);
    const t = window.setTimeout(() => {
      const api = calendarRef.current?.getApi();
      if (api && api.view.type !== next) api.changeView(next);
    }, 0);
    return () => window.clearTimeout(t);
  }, [viewRange]);

  useEffect(() => {
    if (focusFromUrl) setPendingFocus(focusFromUrl);
  }, [focusFromUrl]);

  // 冲突 focus：等待办到位后定位、高亮并打开编辑
  useEffect(() => {
    if (!pendingFocus) return;
    const todo = todos.find((t) => t.id === pendingFocus);
    if (!todo?.start_at) return;

    const focusId = pendingFocus;
    setPendingFocus(null);
    setFocusPulseId(focusId);
    setSelected(todo);

    const go = window.setTimeout(() => {
      const api = calendarRef.current?.getApi();
      if (api) api.gotoDate(new Date(todo.start_at!));
    }, 0);

    const params = new URLSearchParams(searchParams.toString());
    if (params.has("focus")) {
      params.delete("focus");
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    }

    const clearPulse = window.setTimeout(() => setFocusPulseId(null), 4500);
    return () => {
      window.clearTimeout(go);
      window.clearTimeout(clearPulse);
    };
  }, [pendingFocus, todos, pathname, router, searchParams]);

  // 本地创建/删除立刻反映到日历（不靠 router.refresh）
  useEffect(() => {
    function onUpsert(ev: Event) {
      const todo = (ev as CustomEvent<TodoUpsertedDetail>).detail?.todo;
      if (!todo?.id) return;
      if (!todo.start_at) {
        const next = applyTodoDelete(todosRef.current, todo.id);
        todosRef.current = next;
        todosSigRef.current = todosSignature(next);
        setTodos(next);
        return;
      }
      dirtyTodoIdsRef.current.add(todo.id);
      const next = applyTodoUpsert(todosRef.current, todo);
      todosRef.current = next;
      todosSigRef.current = todosSignature(next);
      setTodos(next);
    }
    function onDeleted(ev: Event) {
      const todoId = (ev as CustomEvent<TodoDeletedDetail>).detail?.todoId;
      if (!todoId) return;
      dirtyTodoIdsRef.current.add(todoId);
      const next = applyTodoDelete(todosRef.current, todoId);
      todosRef.current = next;
      todosSigRef.current = todosSignature(next);
      setTodos(next);
      setSelected((cur) => (cur?.id === todoId ? null : cur));
    }
    window.addEventListener(TODO_UPSERTED, onUpsert);
    window.addEventListener(TODO_DELETED, onDeleted);
    return () => {
      window.removeEventListener(TODO_UPSERTED, onUpsert);
      window.removeEventListener(TODO_DELETED, onDeleted);
    };
  }, []);

  const editorMembers = selected
    ? (membersBySpace?.[selected.space_id] ?? members)
    : members;
  const editorCanAssign = selected
    ? (canAssignBySpace?.[selected.space_id] ?? canAssign)
    : canAssign;

  const uiPrefs = useUiPrefsOptional()?.globalPrefs;
  const conflictIds = useMemo(() => findConflictTodoIds(todos), [todos]);

  const events = useMemo(() => {
    const base = todosToEvents(todos, uiPrefs) as EventInput[];
    return base.map((ev) => {
      const id = String(ev.id);
      const classes: string[] = [];
      if (conflictIds.has(id)) classes.push("fc-event-conflict");
      if (focusPulseId === id) classes.push("fc-event-focus");
      if (conflictIds.has(id)) {
        return {
          ...ev,
          classNames: classes,
          backgroundColor: "#dc2626",
          borderColor: "#b91c1c",
          textColor: "#ffffff",
        };
      }
      if (classes.length > 0) {
        return { ...ev, classNames: classes };
      }
      return ev;
    });
  }, [todos, conflictIds, uiPrefs, focusPulseId]);

  async function persistRange(
    todoId: string,
    start: Date | null,
    end: Date | null,
    allDay: boolean,
    opts?: { fromDrag?: boolean; revert?: () => void },
  ): Promise<boolean> {
    if (!start) return false;
    let startIso: string;
    let endIso: string;
    if (allDay) {
      // FC 全天 end 为 exclusive；用本地日期，避免 UTC 切日偏一天
      const startYmd = localDateKey(start);
      const endExclusiveYmd = end ? localDateKey(end) : null;
      const range = allDayRangeToIso(startYmd, endExclusiveYmd);
      startIso = range.start_at;
      endIso = range.end_at;
    } else {
      startIso = start.toISOString();
      endIso = end
        ? end.toISOString()
        : new Date(start.getTime() + 60 * 60 * 1000).toISOString();
    }

    const duration_minutes = allDay
      ? null
      : minutesBetween(startIso, endIso);

    // 拖拽：全局 suppress（window），避免双模块失效；时长覆盖 notify 延迟
    if (opts?.fromDrag) suppressTodosRealtimeRefresh(6000);

    const { error: upErr } = await supabase
      .from("todos")
      .update({
        start_at: startIso,
        end_at: endIso,
        is_all_day: allDay,
        duration_minutes,
      })
      .eq("id", todoId);

    if (upErr) {
      setError(upErr.message);
      opts?.revert?.();
      if (!opts?.fromDrag) router.refresh();
      return false;
    }

    let next: TodoRow[];
    const exists = todosRef.current.some((t) => t.id === todoId);
    if (exists) {
      next = todosRef.current.map((t) =>
        t.id === todoId
          ? {
              ...t,
              start_at: startIso,
              end_at: endIso,
              is_all_day: allDay,
              duration_minutes,
            }
          : t,
      );
    } else {
      // 从未排期拖入：日历列表里原先没有这条
      const { data: row } = await supabase
        .from("todos")
        .select(TODO_SELECT_LEAN)
        .eq("id", todoId)
        .maybeSingle();
      next = row
        ? [...todosRef.current, row as unknown as TodoRow]
        : todosRef.current;
    }
    // 同步 state，立刻重算冲突标红（findConflictTodoIds 依赖 todos）
    todosRef.current = next;
    todosSigRef.current = todosSignature(next);
    dirtyTodoIdsRef.current.add(todoId);
    setTodos(next);
    void notifyTodoAssignment(todoId);
    setError("");
    return true;
  }

  async function clearSchedule(todoId: string, opts?: { revert?: () => void }) {
    suppressTodosRealtimeRefresh(6000);
    const todo = todosRef.current.find((t) => t.id === todoId);
    const duration_minutes = todo
      ? resolveTodoDurationMinutes(todo)
      : null;

    // 立刻出现在未排期 / 移出日历
    if (todo) emitTodoUnscheduled(todo);
    const next = todosRef.current.filter((t) => t.id !== todoId);
    todosRef.current = next;
    todosSigRef.current = todosSignature(next);
    dirtyTodoIdsRef.current.add(todoId);
    setTodos(next);

    const { error: upErr } = await supabase
      .from("todos")
      .update({
        start_at: null,
        end_at: null,
        is_all_day: false,
        ...(duration_minutes != null ? { duration_minutes } : {}),
      })
      .eq("id", todoId);
    if (upErr) {
      setError(upErr.message);
      emitTodoScheduled(todoId);
      if (todo) {
        const restored = [todo, ...todosRef.current];
        todosRef.current = restored;
        todosSigRef.current = todosSignature(restored);
        setTodos(restored);
      }
      opts?.revert?.();
      return;
    }
    setMenu(null);
    setError("");
  }

  async function copyTodo(todo: TodoRow) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("请先登录");
      return;
    }
    // 已排期副本保留时段（整体后移 1 小时避免完全重叠），可直接在日历上拖
    let start_at = todo.start_at;
    let end_at = todo.end_at;
    if (start_at && end_at && !todo.is_all_day) {
      const shift = 60 * 60 * 1000;
      start_at = new Date(new Date(start_at).getTime() + shift).toISOString();
      end_at = new Date(new Date(end_at).getTime() + shift).toISOString();
    }
    const { data: created, error: cErr } = await supabase
      .from("todos")
      .insert({
        space_id: todo.space_id,
        creator_id: user.id,
        title: `${todo.title}（副本）`,
        description: todo.description,
        priority: todo.priority,
        department: todo.department ?? DEFAULT_DEPARTMENT,
        status: "todo",
        start_at,
        end_at,
        is_all_day: todo.is_all_day,
        due_at: todo.due_at,
        source: "manual",
        parent_todo_id: todo.parent_todo_id ?? null,
      })
      .select("id")
      .single();
    if (cErr || !created) {
      setError(cErr?.message || "复制失败");
      return;
    }
    const assignees =
      (todo.todo_assignees ?? []).map((a) => a.user_id).length > 0
        ? (todo.todo_assignees ?? []).map((a) => a.user_id)
        : [user.id];
    await supabase.from("todo_assignees").insert(
      assignees.map((user_id) => ({ todo_id: created.id, user_id })),
    );
    suppressTodosRealtimeRefresh(3000);
    await notifyTodoAssignment(created.id);
    const assigneesRows = assignees.map((user_id) => ({ user_id }));
    const next: TodoRow[] = [
      ...todosRef.current,
      {
        ...todo,
        id: created.id,
        title: `${todo.title}（副本）`,
        status: "todo",
        start_at,
        end_at,
        todo_assignees: assigneesRows,
      },
    ];
    todosRef.current = next;
    todosSigRef.current = todosSignature(next);
    setTodos(next);
    emitTodoUpserted(next[next.length - 1]!);
    setMenu(null);
    setError("");
  }

  function onEventClick(info: EventClickArg) {
    setMenu(null);
    setCreatePrefill(null);
    const todo = todos.find((t) => t.id === info.event.id) || null;
    setSelected(todo);
  }

  function openCreateAt(start: Date, end: Date | null, allDay: boolean) {
    if (spaces.length === 0) {
      setError("暂无可用空间，请先创建空间");
      return;
    }
    setMenu(null);
    setSelected(null);
    if (allDay) {
      setCreatePrefill({
        startLocal: "",
        endLocal: "",
        isAllDay: true,
        startDate: toDateInput(start),
      });
      return;
    }
    const startLocal = toLocalInput(start);
    const endDate =
      end ?? new Date(start.getTime() + 60 * 60 * 1000);
    setCreatePrefill({
      startLocal,
      endLocal: toLocalInput(endDate),
      isAllDay: false,
      startDate: "",
    });
  }

  function onDateClick(info: DateClickArg) {
    const end = info.allDay
      ? null
      : new Date(info.date.getTime() + 60 * 60 * 1000);
    openCreateAt(info.date, end, info.allDay);
  }

  function onDateSelect(info: DateSelectArg) {
    if (!info.start) return;
    openCreateAt(info.start, info.end, info.allDay);
    info.view.calendar.unselect();
  }

  async function onEventDrop(info: EventDropArg) {
    await persistRange(
      info.event.id,
      info.event.start,
      info.event.end,
      info.event.allDay,
      { fromDrag: true, revert: () => info.revert() },
    );
  }

  async function onEventResize(info: EventResizeDoneArg) {
    await persistRange(
      info.event.id,
      info.event.start,
      info.event.end,
      info.event.allDay,
      { fromDrag: true, revert: () => info.revert() },
    );
  }

  async function onEventReceive(info: EventReceiveArg) {
    // 从未排期拖入：先从未排期移除，写库失败再加回
    suppressTodosRealtimeRefresh(6000);
    const todoId = info.event.id;
    emitTodoScheduled(todoId);
    const ok = await persistRange(
      todoId,
      info.event.start,
      info.event.end,
      info.event.allDay,
      { revert: () => info.revert() },
    );
    if (!ok) {
      const { data: row } = await supabase
        .from("todos")
        .select(TODO_SELECT_LEAN)
        .eq("id", todoId)
        .maybeSingle();
      if (row) emitTodoUnscheduled(row as unknown as TodoRow);
    }
  }

  function setUnscheduledDropActive(on: boolean) {
    const zone = document.getElementById("unscheduled-drop-zone");
    if (!zone) return;
    zone.classList.toggle("ring-2", on);
    zone.classList.toggle("ring-[var(--brand)]", on);
    zone.classList.toggle("border-[var(--brand)]", on);
    zone.classList.toggle("bg-brand-soft", on);
  }

  function onEventDragStart() {
    setUnscheduledDropActive(true);
  }

  async function onEventDragStop(info: EventDragStopArg) {
    setUnscheduledDropActive(false);
    const zone = document.getElementById("unscheduled-drop-zone");
    if (!zone) return;
    const rect = zone.getBoundingClientRect();
    const { clientX: x, clientY: y } = info.jsEvent;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const removed = info.event;
      removed.remove();
      await clearSchedule(removed.id, {
        revert: () => {
          // 失败时靠 props/refresh 恢复；FC 事件已 remove
          todosSigRef.current = "";
          setTodos([...todosRef.current]);
        },
      });
    }
  }

  function renderEventContent(arg: EventContentArg) {
    const todoTitle =
      (arg.event.extendedProps.todoTitle as string | undefined) ||
      arg.event.title;
    const timeLabel = formatEventTimeRange(
      arg.event.start,
      arg.event.end,
      arg.event.allDay,
    );
    const assignees =
      (arg.event.extendedProps.assignees as string | undefined)?.trim() ||
      "未指定";
    return (
      <div className="fc-event-stack px-0.5 py-0.5 leading-snug">
        <div
          className={[
            "flex min-w-0 items-baseline gap-1 font-semibold leading-snug",
            isMobile ? "text-[12px]" : "text-[15px] md:text-[14px]",
          ].join(" ")}
        >
          <span className="min-w-0 flex-1 truncate">{todoTitle}</span>
          <span
            className={[
              "shrink-0 font-normal opacity-90",
              isMobile ? "text-[9px]" : "text-[11px] md:text-[10px]",
            ].join(" ")}
          >
            {assignees}
          </span>
        </div>
        {timeLabel ? (
          <div
            className={[
              "whitespace-normal break-words leading-snug opacity-90",
              isMobile ? "text-[9px]" : "text-[12px] md:text-[11px]",
            ].join(" ")}
          >
            {timeLabel}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={[
        "rounded-xl border border-zinc-200 bg-white md:p-4",
        mobileDateChrome
          ? "sharetodo-cal-mobile -mx-4 -mb-4 border-0 p-0 md:mx-0 md:mb-0 md:rounded-xl md:border md:p-4"
          : "p-3",
      ].join(" ")}
    >
      {hideTitle ? null : (
        <div
          className={[
            "mb-3 flex flex-wrap items-center justify-between gap-2",
            mobileDateChrome ? "hidden md:flex" : "",
          ].join(" ")}
        >
          <h2 className="text-sm font-medium text-zinc-700">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {showMineFilter && onMineOnlyChange ? (
              <button
                type="button"
                onClick={() => onMineOnlyChange(!mineOnly)}
                className={chipClass(mineOnly)}
              >
                个人任务
              </button>
            ) : null}
            {conflictIds.size > 0 ? (
              <p className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
                {conflictIds.size} 项冲突 · 红色标出
              </p>
            ) : (
              <p className="text-xs text-zinc-400">无时段冲突</p>
            )}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </div>
        </div>
      )}

      {mobileDateChrome && conflictIds.size > 0 ? (
        <p className="mb-2 text-xs font-medium text-red-600 md:hidden">
          {conflictIds.size} 项冲突
        </p>
      ) : null}
      {mobileDateChrome && error ? (
        <p className="mb-2 text-xs text-red-600 md:hidden">{error}</p>
      ) : null}

      {hideTitle ? null : (
        <p
          className={[
            "mb-2 text-[11px] text-zinc-400",
            mobileDateChrome ? "hidden md:block" : "",
          ].join(" ")}
        >
          点击空白处创建任务；点击已有任务可编辑；拖回侧栏「未排期」可取消排期
        </p>
      )}

      <div
        className="fc-theme sharetodo-calendar text-sm"
        onContextMenu={(e) => {
          const target = (e.target as HTMLElement).closest(".fc-event");
          if (!target) return;
          e.preventDefault();
          const id =
            target.getAttribute("data-event-id") ||
            (target as HTMLElement).dataset?.eventId;
          // FullCalendar stores id on fc-event via arg - fallback: find by title
          const el = target as HTMLElement;
          const fcId =
            el.getAttribute("data-event") ||
            Array.from(todos).find((t) =>
              el.textContent?.includes(t.title),
            )?.id;
          const todo = todos.find(
            (t) => t.id === id || t.id === fcId || el.textContent?.includes(t.title),
          );
          if (todo) {
            setMenu({ x: e.clientX, y: e.clientY, todo });
          }
        }}
      >
        <FullCalendar
          ref={calendarRef}
          plugins={FC_PLUGINS}
          initialView={rangeToFcView(viewRange)}
          headerToolbar={
            isMobile
              ? {
                  left: "prev,next",
                  center: "today",
                  right: "title",
                }
              : {
                  left: "prev,next today",
                  center: "title",
                  right: "",
                }
          }
          locale={zhCn}
          height={isMobile ? "100%" : "auto"}
          expandRows={isMobile}
          nowIndicator
          editable
          droppable
          selectable
          selectMirror
          eventDurationEditable
          eventStartEditable
          events={events}
          eventContent={renderEventContent}
          dateClick={onDateClick}
          select={onDateSelect}
          eventClick={onEventClick}
          eventDrop={onEventDrop}
          eventResize={onEventResize}
          eventReceive={onEventReceive}
          eventDragStart={onEventDragStart}
          eventDragStop={onEventDragStop}
          eventDidMount={(arg) => {
            arg.el.setAttribute("data-event-id", arg.event.id);
            const taskOpacity = resolveTaskOpacity(uiPrefs);
            const glassMobile =
              mobileDateChrome &&
              typeof window !== "undefined" &&
              window.matchMedia("(max-width: 767px)").matches;
            if (glassMobile && !conflictIds.has(arg.event.id)) {
              const raw =
                (arg.event.extendedProps.solidColor as string | undefined) ||
                arg.event.backgroundColor ||
                (arg.event.extendedProps.color as string | undefined) ||
                "#5cb88a";
              const alpha = Math.min(0.72, taskOpacity);
              arg.el.classList.add("fc-event-glass");
              arg.el.style.setProperty(
                "background-color",
                hexToRgba(raw, alpha),
                "important",
              );
              arg.el.style.setProperty("border-color", "transparent", "important");
              arg.el.style.setProperty("color", "#ffffff", "important");
              const stack = arg.el.querySelector(".fc-event-stack");
              if (stack instanceof HTMLElement) {
                stack.style.setProperty("color", "#ffffff", "important");
              }
            } else if (
              !conflictIds.has(arg.event.id) &&
              taskOpacity < 0.999
            ) {
              const raw =
                (arg.event.extendedProps.solidColor as string | undefined) ||
                arg.event.backgroundColor ||
                "#5cb88a";
              arg.el.style.setProperty(
                "background-color",
                hexToRgba(raw, taskOpacity),
                "important",
              );
              arg.el.style.setProperty(
                "border-color",
                hexToRgba(raw, Math.min(1, taskOpacity + 0.05)),
                "important",
              );
            }
            if (conflictIds.has(arg.event.id)) {
              arg.el.classList.add("fc-event-conflict");
              arg.el.style.setProperty("background-color", "#dc2626", "important");
              arg.el.style.setProperty("border-color", "#b91c1c", "important");
              arg.el.style.setProperty("color", "#ffffff", "important");
              const stack = arg.el.querySelector(".fc-event-stack");
              if (stack instanceof HTMLElement) {
                stack.style.setProperty("color", "#ffffff", "important");
              }
            }
            if (focusPulseId === arg.event.id) {
              arg.el.classList.add("fc-event-focus");
            }
            arg.el.addEventListener("contextmenu", (ev) => {
              ev.preventDefault();
              const todo = todos.find((t) => t.id === arg.event.id);
              if (!todo) return;
              setMenu({
                x: (ev as MouseEvent).clientX,
                y: (ev as MouseEvent).clientY,
                todo,
              });
            });
          }}
          buttonText={{
            today: "今天",
            month: "月",
            week: "周",
            day: "日",
          }}
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          allDayText="全天"
          allDaySlot
          dayMaxEvents={false}
        />
      </div>

      {menu ? (
        <div
          className="fixed z-[70] min-w-[8rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
            onClick={() => copyTodo(menu.todo)}
          >
            复制（保留排期）
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
            onClick={() => {
              setSelected(menu.todo);
              setMenu(null);
            }}
          >
            编辑
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-50"
            onClick={() => setMenu(null)}
          >
            取消
          </button>
        </div>
      ) : null}

      {selected ? (
        <TodoEditor
          todo={selected}
          members={editorMembers}
          canAssign={editorCanAssign}
          open
          onClose={() => setSelected(null)}
        />
      ) : null}

      {createPrefill && spaces.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) setCreatePrefill(null);
              }}
            >
              <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-zinc-900">
                    新建待办
                  </h2>
                  <button
                    type="button"
                    onClick={() => setCreatePrefill(null)}
                    className="text-sm text-zinc-500 hover:text-zinc-800"
                  >
                    关闭
                  </button>
                </div>
                <QuickCreateTodo
                  key={`${createPrefill.startLocal}-${createPrefill.startDate}-${createPrefill.isAllDay}`}
                  spaces={spaces}
                  defaultSpaceId={defaultSpaceId}
                  allowOverview={allowOverview}
                  members={members}
                  membersBySpace={membersBySpace}
                  canAssign={canAssign}
                  bare
                  initialStartLocal={createPrefill.startLocal}
                  initialEndLocal={createPrefill.endLocal}
                  initialIsAllDay={createPrefill.isAllDay}
                  initialStartDate={createPrefill.startDate}
                  onCreated={() => {
                    setCreatePrefill(null);
                  }}
                />
              </div>
            </div>,
            document.body,
          )
        : null}

      <style jsx global>{`
        .sharetodo-calendar .fc {
          --fc-border-color: #e4e4e7;
          --fc-button-bg-color: #18181b;
          --fc-button-border-color: #18181b;
          --fc-button-hover-bg-color: #27272a;
          --fc-button-hover-border-color: #27272a;
          --fc-button-active-bg-color: #09090b;
          --fc-button-active-border-color: #09090b;
          --fc-today-bg-color: #d4d4d8;
        }
        .sharetodo-calendar .fc-day-today {
          background-color: var(--fc-today-bg-color) !important;
        }
        .sharetodo-calendar .fc-toolbar-title {
          font-size: 1rem;
          font-weight: 600;
        }
        .sharetodo-calendar .fc-button {
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
        }
        .sharetodo-calendar .fc-event-conflict,
        .sharetodo-calendar .fc-event-conflict .fc-event-main,
        .sharetodo-calendar .fc-event-conflict .fc-event-title {
          background-color: #dc2626 !important;
          border-color: #b91c1c !important;
          color: #fff !important;
        }
        .sharetodo-calendar .fc-event-conflict {
          box-shadow: 0 0 0 2px #fecaca;
        }
        .sharetodo-calendar .fc-event-focus {
          box-shadow: 0 0 0 3px #fbbf24, 0 0 0 6px rgba(251, 191, 36, 0.35) !important;
          z-index: 5 !important;
          animation: fc-focus-pulse 1.2s ease-in-out 2;
        }
        @keyframes fc-focus-pulse {
          0%,
          100% {
            filter: brightness(1);
          }
          50% {
            filter: brightness(1.15);
          }
        }
        .sharetodo-calendar .fc-timegrid-event {
          min-height: 2.5rem;
        }
        /* 拖拽：隐藏拖影 / mirror，只保留落点反馈 */
        .fc-event-mirror,
        .fc-event-dragging,
        .fc-event-mirror.fc-event,
        .fc-event-dragging.fc-event {
          opacity: 0 !important;
          visibility: hidden !important;
          box-shadow: none !important;
          pointer-events: none !important;
        }
        .sharetodo-calendar .fc-timegrid-event .fc-event-main,
        .sharetodo-calendar .fc-timegrid-event .fc-event-main-frame {
          overflow: visible;
          height: auto;
        }
        /* 月视图：每天格子固定高度，格内滚动看全部任务 */
        .sharetodo-calendar .fc-dayGridMonth-view .fc-daygrid-day-frame {
          min-height: 6.5rem !important;
          height: 6.5rem !important;
          max-height: 6.5rem !important;
          overflow-x: hidden;
          overflow-y: auto;
        }
        .sharetodo-calendar .fc-dayGridMonth-view .fc-daygrid-day-events {
          min-height: 0 !important;
        }
        .sharetodo-calendar .fc-dayGridMonth-view .fc-daygrid-event-harness {
          margin-top: 1px;
        }
        .sharetodo-calendar .fc-dayGridMonth-view .fc-daygrid-body,
        .sharetodo-calendar .fc-dayGridMonth-view .fc-scrollgrid-sync-table {
          height: auto !important;
        }
        /* 手机：满高 + 节次感时间格 + 半透明色块（无虚线网格） */
        @media (max-width: 767px) {
          .sharetodo-cal-mobile {
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
            border-radius: 0 !important;
          }
          .sharetodo-cal-mobile .sharetodo-calendar,
          .sharetodo-cal-mobile .fc {
            height: calc(
              100dvh - 10.25rem - env(safe-area-inset-top, 0px) -
                env(safe-area-inset-bottom, 0px)
            ) !important;
            --fc-border-color: rgba(113, 113, 122, 0.22);
            --fc-today-bg-color: rgba(63, 63, 70, 0.22);
            --fc-page-bg-color: transparent;
            --fc-neutral-bg-color: rgba(255, 255, 255, 0.2);
          }
          .sharetodo-cal-mobile .fc-scrollgrid,
          .sharetodo-cal-mobile .fc-scrollgrid td,
          .sharetodo-cal-mobile .fc-scrollgrid th {
            border-style: solid !important;
          }
          .sharetodo-cal-mobile .fc-timegrid-slot {
            /* 接近课表单节高度 */
            height: 2.85rem !important;
            min-height: 2.85rem !important;
          }
          .sharetodo-cal-mobile .fc-timegrid-event,
          .sharetodo-cal-mobile .fc-event-glass {
            border-radius: 0.45rem !important;
            border: none !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
          }
          .sharetodo-cal-mobile .fc-event-stack {
            color: #fff !important;
          }
          .sharetodo-cal-mobile .fc-header-toolbar {
            display: flex;
            flex-direction: row;
            flex-wrap: nowrap;
            align-items: center;
            justify-content: space-between;
            gap: 0.25rem;
            margin-bottom: 0.25rem;
          }
          .sharetodo-cal-mobile .fc-toolbar-chunk {
            display: flex;
            align-items: center;
            justify-content: center;
            flex-wrap: nowrap;
            gap: 0.25rem;
            min-width: 0;
          }
          .sharetodo-cal-mobile .fc-toolbar-title {
            font-size: 0.8rem;
            font-weight: 600;
            text-align: right;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 42vw;
          }
          .sharetodo-cal-mobile .fc-prev-button,
          .sharetodo-cal-mobile .fc-next-button {
            background: #18181b !important;
            border-color: #18181b !important;
            color: #fff !important;
            border-radius: 0.5rem;
            min-width: 2.25rem;
            min-height: 2.25rem;
          }
          .sharetodo-cal-mobile .fc-today-button {
            background: #71717a !important;
            border-color: #71717a !important;
            color: #fff !important;
            border-radius: 0.5rem;
            width: auto;
            max-width: none;
            padding: 0.35rem 0.85rem !important;
          }
          .sharetodo-cal-mobile .fc-button-group {
            border-radius: 0.5rem;
            overflow: hidden;
          }
          .sharetodo-cal-mobile .fc-event-stack {
            color: inherit;
            overflow: visible;
          }
          .sharetodo-cal-mobile .fc-timegrid-event {
            min-height: 2.5rem !important;
          }
          .sharetodo-cal-mobile .fc-timegrid-event .fc-event-main,
          .sharetodo-cal-mobile .fc-timegrid-event .fc-event-main-frame {
            overflow: visible !important;
            height: auto !important;
            padding: 2px 3px;
          }
          .sharetodo-cal-mobile .fc-dayGridMonth-view .fc-daygrid-day-frame {
            min-height: 5rem !important;
            height: 5rem !important;
            max-height: 5rem !important;
          }
        }
      `}</style>
    </div>
  );
}

import { spaceKindLabel } from "@/lib/spaces";
import {
  DEFAULT_PRIORITY_COLORS,
  hexToRgba,
  resolveTaskOpacity,
  resolveTodoColor,
  type UiPrefs,
} from "@/lib/ui-prefs";

export type TodoAssignee = {
  user_id: string;
  profiles?: {
    display_name: string;
    email: string | null;
  } | null;
};

export type TodoRow = {
  id: string;
  title: string;
  description: string | null;
  priority: "high" | "medium" | "low";
  status: "todo" | "in_progress" | "done";
  start_at: string | null;
  end_at: string | null;
  is_all_day: boolean;
  due_at: string | null;
  space_id: string;
  creator_id?: string | null;
  parent_todo_id?: string | null;
  completed_by?: string | null;
  completed_at?: string | null;
  /** 计划时长（分钟）；未排期时保留 */
  duration_minutes?: number | null;
  /** 自定义展示/日历色 */
  color?: string | null;
  /** 任务所属部门；未选择时为「通用」 */
  department?: string | null;
  spaces: {
    id: string;
    name: string;
    kind: string;
  } | null;
  todo_assignees?: TodoAssignee[] | null;
};

export type SpaceMemberOption = {
  user_id: string;
  display_name: string;
  email: string | null;
};

export const TODO_SELECT =
  "id, title, description, priority, status, start_at, end_at, is_all_day, due_at, duration_minutes, department, space_id, creator_id, parent_todo_id, completed_by, completed_at, color, spaces(id, name, kind), todo_assignees(user_id, profiles(display_name, email))";

/** 日历/首屏：去掉 description / 完成态 / email；编辑器打开时再拉详情 */
export const TODO_SELECT_LEAN =
  "id, title, priority, status, start_at, end_at, is_all_day, due_at, duration_minutes, department, space_id, creator_id, parent_todo_id, color, spaces(id, name, kind), todo_assignees(user_id, profiles(display_name))";

export type SpaceNavItem = {
  id: string;
  name: string;
  kind: string;
  role: string;
  visibility: string;
  avatar_url?: string | null;
  /** 用于识别 bootstrap 默认空间 */
  description?: string | null;
};

export const KIND_COLORS: Record<string, string> = {
  work: "#2563eb",
  life: "#059669",
  family: "#d97706",
  personal: "#7c3aed",
  other: "#52525b",
};

/** 系统默认优先级色（可被 ui_prefs / 单条 color 覆盖） */
export const PRIORITY_COLORS: Record<string, string> = {
  ...DEFAULT_PRIORITY_COLORS,
};

export const STATUS_LABEL: Record<string, string> = {
  todo: "未开始",
  in_progress: "进行中",
  done: "已完成",
};

export const STATUS_COLORS: Record<string, string> = {
  todo: "#e85d5d",
  in_progress: "#4a9eda",
  done: "#3db87a",
};

/** 跨自然日排期（用于卡片渐变区分） */
export function isCrossDayTodo(todo: TodoRow): boolean {
  if (!todo.start_at || !todo.end_at || todo.is_all_day) return false;
  const a = new Date(todo.start_at);
  const b = new Date(todo.end_at);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}

export function todoEventColor(kind: string | null | undefined): string {
  return KIND_COLORS[kind || "other"] || KIND_COLORS.other;
}

export function todoPriorityColor(
  priority: string | null | undefined,
): string {
  return PRIORITY_COLORS[priority || "medium"] || PRIORITY_COLORS.medium;
}

/** 浅色底上用深色字，保证可读 */
export function todoPriorityTextColor(
  priority: string | null | undefined,
): string {
  return "#18181b";
}

/** 本地日历日 YYYY-MM-DD（勿用 toISOString 切日期，会偏时区） */
export function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addLocalDateKey(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return localDateKey(new Date(y, m - 1, d + days));
}

/** 本地日 00:00 → timestamptz ISO */
export function localDateKeyToStartIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/**
 * 全天写入 DB：start = 首日 00:00，end = 结束日（exclusive）00:00。
 * FullCalendar 全天 end 为开区间，须至少比 start 多 1 天。
 */
export function allDayRangeToIso(
  startYmd: string,
  endExclusiveYmd?: string | null,
): { start_at: string; end_at: string } {
  const endYmd =
    endExclusiveYmd && endExclusiveYmd > startYmd
      ? endExclusiveYmd
      : addLocalDateKey(startYmd, 1);
  return {
    start_at: localDateKeyToStartIso(startYmd),
    end_at: localDateKeyToStartIso(endYmd),
  };
}

/** 从已存全天 todo 得到 FC 用的日期串（end exclusive） */
export function todoAllDayFcRange(todo: {
  start_at: string;
  end_at: string | null;
}): { start: string; end: string } {
  const startYmd = localDateKey(new Date(todo.start_at));
  if (!todo.end_at) {
    return { start: startYmd, end: addLocalDateKey(startYmd, 1) };
  }
  const end = new Date(todo.end_at);
  const endYmd = localDateKey(end);
  const isMidnight =
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end.getMilliseconds() === 0;
  // 新格式：次日 00:00 exclusive；旧格式：当日 23:59:59 inclusive → +1 日
  if (isMidnight && endYmd > startYmd) {
    return { start: startYmd, end: endYmd };
  }
  return { start: startYmd, end: addLocalDateKey(endYmd, 1) };
}

export function todosToEvents(todos: TodoRow[], uiPrefs?: UiPrefs | null) {
  const taskOpacity = resolveTaskOpacity(uiPrefs);
  return todos
    .filter((t) => t.start_at)
    .map((t) => {
      const color = resolveTodoColor(t.color, t.priority, uiPrefs);
      const fill =
        taskOpacity >= 0.999 ? color : hexToRgba(color, taskOpacity);
      const spaceName = t.spaces?.name?.trim();
      const urgent = isUrgentTodo(t);
      const base = t.parent_todo_id ? `▸ ${t.title}` : t.title;
      const bits = [
        urgent ? "紧急" : null,
        spaceName || null,
        base,
      ].filter(Boolean);
      const allDayRange = t.is_all_day
        ? todoAllDayFcRange({ start_at: t.start_at!, end_at: t.end_at })
        : null;
      return {
        id: t.id,
        title: bits.join(" · "),
        start: allDayRange ? allDayRange.start : t.start_at!,
        end: allDayRange ? allDayRange.end : t.end_at || undefined,
        allDay: t.is_all_day,
        backgroundColor: fill,
        borderColor: urgent
          ? hexToRgba("#e85d5d", Math.min(1, taskOpacity + 0.05))
          : fill,
        textColor: todoPriorityTextColor(t.priority),
        extendedProps: {
          spaceId: t.space_id,
          spaceName: spaceName ?? "空间",
          kindLabel: spaceKindLabel(t.spaces?.kind),
          status: t.status,
          priority: t.priority,
          urgent,
          parentTodoId: t.parent_todo_id ?? null,
          color: t.color ?? null,
          solidColor: color,
          todoTitle: t.title,
          assignees: (t.todo_assignees ?? [])
            .map(
              (a) =>
                a.profiles?.display_name?.trim() ||
                a.profiles?.email?.trim() ||
                "成员",
            )
            .filter(Boolean)
            .join("、"),
        },
      };
    });
}

export type OverviewRange = "day" | "week" | "month";

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Monday as start of week */
export function getOverviewBounds(range: OverviewRange, base = new Date()) {
  const dayStart = startOfLocalDay(base);
  if (range === "day") {
    return { start: dayStart, end: endOfLocalDay(base) };
  }
  if (range === "week") {
    const day = dayStart.getDay(); // 0 Sun
    const diffToMon = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(dayStart);
    weekStart.setDate(dayStart.getDate() + diffToMon);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return { start: weekStart, end: endOfLocalDay(weekEnd) };
  }
  const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
  const monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { start: monthStart, end: endOfLocalDay(monthEnd) };
}

export function todoOverlapsRange(
  todo: TodoRow,
  start: Date,
  end: Date,
): boolean {
  // 未排期（无 start_at）：日/周/月下仍出现在任务总览与待办列表
  if (!todo.start_at) return true;
  const s = new Date(todo.start_at).getTime();
  const e = new Date(todo.end_at || todo.start_at).getTime();
  return s <= end.getTime() && e >= start.getTime();
}

/** 从起止时间推算分钟数；无效则 null */
export function minutesBetween(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): number | null {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(1, Math.round(ms / 60000));
}

export function resolveTodoDurationMinutes(todo: TodoRow): number | null {
  if (
    typeof todo.duration_minutes === "number" &&
    Number.isFinite(todo.duration_minutes) &&
    todo.duration_minutes > 0
  ) {
    return Math.round(todo.duration_minutes);
  }
  if (todo.is_all_day) return null;
  return minutesBetween(todo.start_at, todo.end_at);
}

export function formatDurationLabel(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h} 小时`;
  return `${h} 小时 ${rem} 分`;
}

/** FullCalendar external drag duration，如 01:30 */
export function durationToFcString(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${String(h).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

export function formatTodoTimeLabel(todo: TodoRow): string {
  if (!todo.start_at) {
    const dur = resolveTodoDurationMinutes(todo);
    if (todo.due_at) {
      const due = `截止 ${formatShortDateTime(todo.due_at)}`;
      return dur ? `${due} · ${formatDurationLabel(dur)}` : due;
    }
    return dur ? `待排期 · ${formatDurationLabel(dur)}` : "待排期";
  }
  if (todo.is_all_day) {
    return `全天 · ${formatShortDate(todo.start_at)}`;
  }
  const start = formatShortDateTime(todo.start_at);
  if (!todo.end_at) return start;
  const sameDay =
    formatShortDate(todo.start_at) === formatShortDate(todo.end_at);
  if (sameDay) {
    const dayPrefix = isSameCalendarDay(todo.start_at, new Date())
      ? "今天 "
      : `${formatShortDate(todo.start_at)} `;
    return `${dayPrefix}${formatTime(todo.start_at)}~${formatTime(todo.end_at)}`;
  }
  return `${start} – ${formatShortDateTime(todo.end_at)}`;
}

function isSameCalendarDay(iso: string, ref: Date) {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

/** 醒目截止时间文案 */
export function formatDueLabel(todo: TodoRow): string | null {
  if (!todo.due_at) return null;
  return `截止 ${formatShortDateTime(todo.due_at)}`;
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatShortDateTime(iso: string) {
  return `${formatShortDate(iso)} ${formatTime(iso)}`;
}

/** 是否指派给指定用户（含多指派） */
export function isAssignedToUser(
  todo: TodoRow,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return (todo.todo_assignees ?? []).some((a) => a.user_id === userId);
}

/** 展示用：重要 / 不重要（DB 仍用 high | medium | low） */
export const PRIORITY_LABEL: Record<string, string> = {
  high: "重要",
  medium: "不重要",
  low: "不重要",
};

export const PRIORITY_FULL_LABEL: Record<string, string> = {
  high: "重要",
  medium: "不重要",
  low: "不重要",
};

export type ImportanceKey = "important" | "normal";

export const IMPORTANCE_ORDER: ImportanceKey[] = ["important", "normal"];

export const IMPORTANCE_LABEL: Record<ImportanceKey, string> = {
  important: "重要",
  normal: "不重要",
};

/** high → 重要；medium/low → 不重要 */
export function todoImportance(priority: string | null | undefined): ImportanceKey {
  return priority === "high" ? "important" : "normal";
}

export function importanceToPriority(
  key: ImportanceKey,
): "high" | "low" {
  return key === "important" ? "high" : "low";
}

/** 仅按截止/开始时间判断紧急（不过滤已完成） */
export function isUrgentByDeadline(
  todo: Pick<TodoRow, "due_at" | "start_at">,
  nowMs = Date.now(),
): boolean {
  const iso = todo.due_at || todo.start_at;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t - nowMs <= 60 * 60 * 1000;
}

/**
 * 距截止/开始时间 ≤ 1 小时（含已过期未完成）→ 紧急。
 * 优先 due_at，否则用 start_at。已完成不标紧急。
 */
export function isUrgentTodo(
  todo: Pick<TodoRow, "due_at" | "start_at" | "status">,
  nowMs = Date.now(),
): boolean {
  if (todo.status === "done") return false;
  return isUrgentByDeadline(todo, nowMs);
}

/** 四象限：紧急×重要 */
export type QuadrantKey =
  | "urgent_important"
  | "urgent_normal"
  | "important"
  | "normal";

export const QUADRANT_ORDER: QuadrantKey[] = [
  "urgent_important",
  "urgent_normal",
  "important",
  "normal",
];

export const QUADRANT_LABEL: Record<QuadrantKey, string> = {
  urgent_important: "紧急 · 重要",
  urgent_normal: "紧急 · 不重要",
  important: "重要 · 不紧急",
  normal: "不重要 · 不紧急",
};

/** 2×2 展示顺序：左上紧急重要、右上紧急不重要、左下重要不紧急、右下不重要不紧急 */
export function todoQuadrant(
  todo: Pick<TodoRow, "due_at" | "start_at" | "priority" | "status">,
  nowMs = Date.now(),
  opts?: { includeDone?: boolean },
): QuadrantKey {
  const urgent =
    opts?.includeDone || todo.status !== "done"
      ? isUrgentByDeadline(todo, nowMs)
      : false;
  const important = todoImportance(todo.priority) === "important";
  if (urgent && important) return "urgent_important";
  if (urgent && !important) return "urgent_normal";
  if (!urgent && important) return "important";
  return "normal";
}


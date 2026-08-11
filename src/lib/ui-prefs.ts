export type PriorityColors = {
  high: string;
  medium: string;
  low: string;
};

export type UiPrefs = {
  bgColor?: string | null;
  bgImageUrl?: string | null;
  /** 0–1，背景图透明度 */
  bgOpacity?: number | null;
  /** cover | contain | 100% | 80% 等 */
  bgSize?: string | null;
  /** center | top left | 50% 30% 等 */
  bgPosition?: string | null;
  priorityColors?: Partial<PriorityColors> | null;
  /** 0–1，日历任务条底色透明度（全局外观） */
  taskOpacity?: number | null;
  /**
   * 手机课表节次（可选）。形如
   * [{ "index": 1, "start": "08:00", "end": "08:50" }, ...]
   */
  timetablePeriods?: Array<{
    index: number;
    start: string;
    end: string;
  }> | null;
};

export type ResolvedBackground = {
  bgColor: string;
  bgImageUrl: string | null;
  bgOpacity: number;
  bgSize: string;
  bgPosition: string;
};

export const DEFAULT_PRIORITY_COLORS: PriorityColors = {
  high: "#e5a54b",
  medium: "#2bb8a0",
  low: "#5cb88a",
};

export const DEFAULT_BG_COLOR = "#f5f6f8";
export const DEFAULT_BG_OPACITY = 0.45;
export const DEFAULT_BG_SIZE = "cover";
export const DEFAULT_BG_POSITION = "center";
/** 日历任务条默认不透明 */
export const DEFAULT_TASK_OPACITY = 1;

export const BG_SIZE_OPTIONS = [
  { value: "cover", label: "铺满（裁切）" },
  { value: "contain", label: "完整显示" },
  { value: "100% 100%", label: "拉伸铺满" },
  { value: "80%", label: "80% 大小" },
  { value: "60%", label: "60% 大小" },
  { value: "auto", label: "原始尺寸" },
] as const;

export const BG_POSITION_OPTIONS = [
  { value: "center", label: "居中" },
  { value: "top", label: "顶部" },
  { value: "bottom", label: "底部" },
  { value: "left", label: "左侧" },
  { value: "right", label: "右侧" },
  { value: "top left", label: "左上" },
  { value: "top right", label: "右上" },
  { value: "bottom left", label: "左下" },
  { value: "bottom right", label: "右下" },
] as const;

function pickStr(
  space: string | null | undefined,
  global: string | null | undefined,
  fallback: string,
): string {
  const s = space?.trim();
  if (s) return s;
  const g = global?.trim();
  if (g) return g;
  return fallback;
}

function pickOpacity(
  space: number | null | undefined,
  global: number | null | undefined,
): number {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  if (typeof space === "number" && !Number.isNaN(space)) return clamp(space);
  if (typeof global === "number" && !Number.isNaN(global)) return clamp(global);
  return DEFAULT_BG_OPACITY;
}

export function parseUiPrefs(raw: unknown): UiPrefs {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const pc = o.priorityColors;
  let priorityColors: Partial<PriorityColors> | undefined;
  if (pc && typeof pc === "object") {
    const p = pc as Record<string, unknown>;
    priorityColors = {
      high: typeof p.high === "string" ? p.high : undefined,
      medium: typeof p.medium === "string" ? p.medium : undefined,
      low: typeof p.low === "string" ? p.low : undefined,
    };
  }
  let bgOpacity: number | null = null;
  if (typeof o.bgOpacity === "number" && !Number.isNaN(o.bgOpacity)) {
    bgOpacity = o.bgOpacity;
  } else if (typeof o.bgOpacity === "string" && o.bgOpacity.trim() !== "") {
    const n = Number(o.bgOpacity);
    if (!Number.isNaN(n)) bgOpacity = n;
  }

  let taskOpacity: number | null = null;
  if (typeof o.taskOpacity === "number" && !Number.isNaN(o.taskOpacity)) {
    taskOpacity = o.taskOpacity;
  } else if (typeof o.taskOpacity === "string" && o.taskOpacity.trim() !== "") {
    const n = Number(o.taskOpacity);
    if (!Number.isNaN(n)) taskOpacity = n;
  }

  let timetablePeriods: UiPrefs["timetablePeriods"];
  if (Array.isArray(o.timetablePeriods)) {
    const list = o.timetablePeriods
      .filter(
        (p): p is { index: number; start: string; end: string } =>
          !!p &&
          typeof p === "object" &&
          typeof (p as { index?: unknown }).index === "number" &&
          typeof (p as { start?: unknown }).start === "string" &&
          typeof (p as { end?: unknown }).end === "string",
      )
      .map((p) => ({
        index: p.index,
        start: p.start.trim(),
        end: p.end.trim(),
      }));
    timetablePeriods = list.length > 0 ? list : null;
  }

  return {
    bgColor: typeof o.bgColor === "string" ? o.bgColor : null,
    bgImageUrl: typeof o.bgImageUrl === "string" ? o.bgImageUrl : null,
    bgOpacity,
    bgSize: typeof o.bgSize === "string" ? o.bgSize : null,
    bgPosition: typeof o.bgPosition === "string" ? o.bgPosition : null,
    priorityColors,
    taskOpacity,
    timetablePeriods,
  };
}

/** 任务条透明度，限制在可读区间 */
export function resolveTaskOpacity(prefs?: UiPrefs | null): number {
  const n = prefs?.taskOpacity;
  if (typeof n === "number" && !Number.isNaN(n)) {
    return Math.min(1, Math.max(0.15, n));
  }
  return DEFAULT_TASK_OPACITY;
}

/** #rgb / #rrggbb → rgba */
export function hexToRgba(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith("rgba") || c.startsWith("rgb")) return c;
  let hex = c.replace("#", "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (hex.length !== 6) return `rgba(92, 184, 138, ${alpha})`;
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mergePriorityColors(
  prefs?: UiPrefs | null,
): PriorityColors {
  return {
    high: prefs?.priorityColors?.high || DEFAULT_PRIORITY_COLORS.high,
    medium: prefs?.priorityColors?.medium || DEFAULT_PRIORITY_COLORS.medium,
    low: prefs?.priorityColors?.low || DEFAULT_PRIORITY_COLORS.low,
  };
}

/** 空间字段优先；未设则回退全局 / 默认 */
export function resolveBackground(
  globalPrefs: UiPrefs,
  spacePrefs?: UiPrefs | null,
): ResolvedBackground {
  return {
    bgColor: pickStr(
      spacePrefs?.bgColor,
      globalPrefs.bgColor,
      DEFAULT_BG_COLOR,
    ),
    bgImageUrl:
      (spacePrefs?.bgImageUrl && spacePrefs.bgImageUrl.trim()) ||
      (globalPrefs.bgImageUrl && globalPrefs.bgImageUrl.trim()) ||
      null,
    bgOpacity: pickOpacity(spacePrefs?.bgOpacity, globalPrefs.bgOpacity),
    bgSize: pickStr(
      spacePrefs?.bgSize,
      globalPrefs.bgSize,
      DEFAULT_BG_SIZE,
    ),
    bgPosition: pickStr(
      spacePrefs?.bgPosition,
      globalPrefs.bgPosition,
      DEFAULT_BG_POSITION,
    ),
  };
}

export function resolveTodoColor(
  todoColor: string | null | undefined,
  priority: string | null | undefined,
  prefs?: UiPrefs | null,
): string {
  if (todoColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(todoColor)) {
    return todoColor;
  }
  const map = mergePriorityColors(prefs);
  const key = (priority || "medium") as keyof PriorityColors;
  return map[key] || map.medium;
}

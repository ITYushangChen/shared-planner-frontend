/**
 * 手机课表日历的节次配置（可改默认值，或通过 ui_prefs.timetablePeriods 覆盖）。
 * start/end 为本地 24h「HH:mm」。
 */
export type TimetablePeriod = {
  index: number;
  start: string;
  end: string;
};

/** 与常见课表接近的默认节次（可配置） */
export const DEFAULT_TIMETABLE_PERIODS: TimetablePeriod[] = [
  { index: 1, start: "08:00", end: "08:50" },
  { index: 2, start: "09:00", end: "09:50" },
  { index: 3, start: "10:10", end: "11:00" },
  { index: 4, start: "11:10", end: "12:00" },
  { index: 5, start: "14:00", end: "14:50" },
  { index: 6, start: "15:00", end: "15:50" },
  { index: 7, start: "16:10", end: "17:00" },
  { index: 8, start: "17:10", end: "18:00" },
  { index: 9, start: "18:40", end: "19:30" },
  { index: 10, start: "19:40", end: "20:30" },
];

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export function parseHmToMinutes(hm: string): number | null {
  const m = TIME_RE.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function formatHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isValidPeriod(p: unknown): p is TimetablePeriod {
  if (!p || typeof p !== "object") return false;
  const o = p as TimetablePeriod;
  return (
    typeof o.index === "number" &&
    typeof o.start === "string" &&
    typeof o.end === "string" &&
    parseHmToMinutes(o.start) != null &&
    parseHmToMinutes(o.end) != null
  );
}

/** 从 ui_prefs 或任意 JSON 解析节次；非法则回退默认 */
export function resolveTimetablePeriods(raw: unknown): TimetablePeriod[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_TIMETABLE_PERIODS;
  }
  const list = raw.filter(isValidPeriod).map((p) => ({
    index: p.index,
    start: p.start.trim(),
    end: p.end.trim(),
  }));
  if (list.length === 0) return DEFAULT_TIMETABLE_PERIODS;
  return [...list].sort((a, b) => a.index - b.index);
}

export function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 将时刻落到节次下标（0-based）；若在节次外，夹到最近节次 */
export function minutesToPeriodIndex(
  minutes: number,
  periods: TimetablePeriod[],
  edge: "start" | "end",
): number {
  const ranges = periods.map((p) => ({
    start: parseHmToMinutes(p.start) ?? 0,
    end: parseHmToMinutes(p.end) ?? 0,
  }));
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (minutes >= r.start && minutes < r.end) return i;
    if (edge === "end" && minutes === r.end) return i;
  }
  if (minutes < ranges[0].start) return 0;
  if (minutes >= ranges[ranges.length - 1].end) return ranges.length - 1;
  // 节间空隙：start 归下一节，end 归上一节
  for (let i = 0; i < ranges.length - 1; i++) {
    if (minutes >= ranges[i].end && minutes < ranges[i + 1].start) {
      return edge === "start" ? i + 1 : i;
    }
  }
  return 0;
}

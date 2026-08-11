"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  addDays,
  minutesToPeriodIndex,
  resolveTimetablePeriods,
  startOfWeekMonday,
  type TimetablePeriod,
} from "@/lib/timetable-periods";
import {
  KIND_COLORS,
  type SpaceMemberOption,
  type SpaceNavItem,
  type TodoRow,
} from "@/lib/todos";
import { resolveTodoColor } from "@/lib/ui-prefs";
import { QuickCreateTodo } from "./quick-create-todo";
import { TodoEditor } from "./todo-editor";
import { useUiPrefsOptional } from "./ui-prefs-provider";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

type Props = {
  todos: TodoRow[];
  spaces?: SpaceNavItem[];
  defaultSpaceId?: string;
  members?: SpaceMemberOption[];
  membersBySpace?: Record<string, SpaceMemberOption[]>;
  canAssign?: boolean;
  canAssignBySpace?: Record<string, boolean>;
};

type DayBlock = {
  todo: TodoRow;
  dayIndex: number;
  startPeriod: number; // 0-based inclusive
  endPeriod: number; // 0-based exclusive for grid
  lane: number;
  laneCount: number;
};

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function assignLanes(blocks: DayBlock[]): DayBlock[] {
  const byDay = new Map<number, DayBlock[]>();
  for (const b of blocks) {
    const list = byDay.get(b.dayIndex) ?? [];
    list.push(b);
    byDay.set(b.dayIndex, list);
  }
  const result: DayBlock[] = [];
  for (const [, list] of byDay) {
    list.sort(
      (a, b) => a.startPeriod - b.startPeriod || a.endPeriod - b.endPeriod,
    );
    const laneEnds: number[] = [];
    const dayResult: DayBlock[] = [];
    for (const b of list) {
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] > b.startPeriod) lane++;
      if (lane === laneEnds.length) laneEnds.push(b.endPeriod);
      else laneEnds[lane] = b.endPeriod;
      dayResult.push({ ...b, lane, laneCount: 1 });
    }
    const laneCount = Math.max(1, ...dayResult.map((d) => d.lane + 1));
    for (const d of dayResult) {
      result.push({ ...d, laneCount });
    }
  }
  return result;
}

function buildBlocks(
  todos: TodoRow[],
  weekStart: Date,
  periods: TimetablePeriod[],
): DayBlock[] {
  const weekEnd = addDays(weekStart, 7);
  const raw: DayBlock[] = [];

  for (const todo of todos) {
    if (!todo.start_at || todo.status === "done") continue;
    const start = new Date(todo.start_at);
    const end = todo.end_at
      ? new Date(todo.end_at)
      : new Date(start.getTime() + 50 * 60 * 1000);
    if (end <= weekStart || start >= weekEnd) continue;

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const day = addDays(weekStart, dayIndex);
      const dayStart = new Date(day);
      const dayEnd = addDays(day, 1);
      if (end <= dayStart || start >= dayEnd) continue;

      const segStart = start < dayStart ? dayStart : start;
      const segEnd = end > dayEnd ? dayEnd : end;

      let startPeriod: number;
      let endPeriodExclusive: number;

      if (todo.is_all_day) {
        startPeriod = 0;
        endPeriodExclusive = periods.length;
      } else {
        const sm = segStart.getHours() * 60 + segStart.getMinutes();
        const em = segEnd.getHours() * 60 + segEnd.getMinutes();
        startPeriod = minutesToPeriodIndex(sm, periods, "start");
        const endIdx = minutesToPeriodIndex(
          Math.max(sm, em - 1),
          periods,
          "end",
        );
        endPeriodExclusive = Math.max(startPeriod + 1, endIdx + 1);
        endPeriodExclusive = Math.min(periods.length, endPeriodExclusive);
      }

      raw.push({
        todo,
        dayIndex,
        startPeriod,
        endPeriod: endPeriodExclusive,
        lane: 0,
        laneCount: 1,
      });
    }
  }

  return assignLanes(raw);
}

function formatTimeRange(todo: TodoRow): string {
  if (!todo.start_at) return "";
  if (todo.is_all_day) return "全天";
  const s = new Date(todo.start_at);
  const e = todo.end_at ? new Date(todo.end_at) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const a = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
  if (!e) return a;
  const b = `${pad(e.getHours())}:${pad(e.getMinutes())}`;
  return `${a}-${b}`;
}

export function MobileTimetable({
  todos,
  spaces = [],
  defaultSpaceId,
  members = [],
  membersBySpace,
  canAssign = false,
  canAssignBySpace,
}: Props) {
  const ui = useUiPrefsOptional()?.globalPrefs;
  const periods = useMemo(
    () => resolveTimetablePeriods(ui?.timetablePeriods),
    [ui?.timetablePeriods],
  );

  const [anchor, setAnchor] = useState(() => new Date());
  const weekStart = useMemo(() => startOfWeekMonday(anchor), [anchor]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const blocks = useMemo(
    () => buildBlocks(todos, weekStart, periods),
    [todos, weekStart, periods],
  );

  const [selected, setSelected] = useState<TodoRow | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{
    startLocal: string;
    endLocal: string;
    isAllDay: boolean;
    startDate: string;
  } | null>(null);

  const editorMembers = selected
    ? (membersBySpace?.[selected.space_id] ?? members)
    : members;
  const editorCanAssign = selected
    ? (canAssignBySpace?.[selected.space_id] ?? canAssign)
    : canAssign;

  const weekLabel = `${weekStart.getMonth() + 1}/${weekStart.getDate()} – ${addDays(weekStart, 6).getMonth() + 1}/${addDays(weekStart, 6).getDate()}`;

  function openCreate(day: Date, period: TimetablePeriod) {
    const [sh, sm] = period.start.split(":").map(Number);
    const [eh, em] = period.end.split(":").map(Number);
    const start = new Date(day);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(day);
    end.setHours(eh, em, 0, 0);
    setCreatePrefill({
      startLocal: toLocalInput(start),
      endLocal: toLocalInput(end),
      isAllDay: false,
      startDate: toDateInput(day),
    });
  }

  const rowH = 2.85; // rem — 手机竖屏更紧凑

  return (
    <div className="md:hidden">
      <div className="mb-3 flex flex-col items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-0.5">
          <button
            type="button"
            aria-label="上一周"
            className="inline-flex h-9 w-10 items-center justify-center rounded-md text-white"
            onClick={() => setAnchor(addDays(weekStart, -7))}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下一周"
            className="inline-flex h-9 w-10 items-center justify-center rounded-md text-white"
            onClick={() => setAnchor(addDays(weekStart, 7))}
          >
            ›
          </button>
        </div>
        <button
          type="button"
          className="rounded-lg bg-zinc-500 px-6 py-1.5 text-sm font-medium text-white"
          onClick={() => setAnchor(new Date())}
        >
          今天
        </button>
        <p className="text-xs text-[var(--text-muted)]">{weekLabel}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/30 bg-white/55 shadow-sm backdrop-blur-[2px]">
        <div
          className="w-full"
          style={{
            display: "grid",
            gridTemplateColumns: `2.1rem repeat(7, minmax(0, 1fr))`,
          }}
        >
          {/* header */}
          <div className="border-b border-dashed border-zinc-400/50 bg-white/40 p-1" />
          {days.map((d, i) => {
            const today = sameDay(d, new Date());
            return (
              <button
                key={i}
                type="button"
                className={[
                  "border-b border-l border-dashed border-zinc-400/50 px-0.5 py-1 text-center",
                  today ? "bg-orange-500/90 text-white" : "bg-white/40",
                ].join(" ")}
                onClick={() => setAnchor(d)}
              >
                <div className="text-[10px] opacity-80">{WEEKDAY_LABELS[i]}</div>
                <div className="text-xs font-semibold">{d.getDate()}</div>
              </button>
            );
          })}

          {/* time + grid */}
          <div className="contents">
            {/* left labels */}
            <div
              className="relative border-r border-dashed border-zinc-400/40"
              style={{
                gridColumn: 1,
                gridRow: `2 / span ${periods.length}`,
                height: `${periods.length * rowH}rem`,
              }}
            >
              {periods.map((p, idx) => (
                <div
                  key={p.index}
                  className="absolute left-0 right-0 flex flex-col items-center justify-start border-b border-dashed border-zinc-400/40 px-0.5 pt-1"
                  style={{
                    top: `${idx * rowH}rem`,
                    height: `${rowH}rem`,
                  }}
                >
                  <span className="text-xs font-semibold text-zinc-800">
                    {p.index}
                  </span>
                  <span className="text-[8px] leading-tight text-zinc-500">
                    {p.start}
                  </span>
                  <span className="text-[8px] leading-tight text-zinc-500">
                    {p.end}
                  </span>
                </div>
              ))}
            </div>

            {days.map((day, dayIndex) => (
              <div
                key={dayIndex}
                className="relative border-l border-dashed border-zinc-400/40"
                style={{
                  gridColumn: dayIndex + 2,
                  gridRow: `2 / span ${periods.length}`,
                  height: `${periods.length * rowH}rem`,
                }}
              >
                {periods.map((p, idx) => (
                  <button
                    key={p.index}
                    type="button"
                    aria-label={`第${p.index}节新建`}
                    className="absolute left-0 right-0 border-b border-dashed border-zinc-400/30"
                    style={{
                      top: `${idx * rowH}rem`,
                      height: `${rowH}rem`,
                    }}
                    onClick={() => openCreate(day, p)}
                  />
                ))}

                {blocks
                  .filter((b) => b.dayIndex === dayIndex)
                  .map((b) => {
                    const color =
                      resolveTodoColor(
                        b.todo.color,
                        b.todo.priority,
                        ui ?? null,
                      ) ||
                      KIND_COLORS[b.todo.spaces?.kind || "other"] ||
                      "#5cb88a";
                    const widthPct = 100 / b.laneCount;
                    const leftPct = b.lane * widthPct;
                    return (
                      <button
                        key={`${b.todo.id}-${dayIndex}`}
                        type="button"
                        className="absolute overflow-hidden rounded-md px-1 py-0.5 text-left text-white shadow-sm"
                        style={{
                          top: `${b.startPeriod * rowH + 0.15}rem`,
                          height: `${Math.max(1, b.endPeriod - b.startPeriod) * rowH - 0.3}rem`,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          backgroundColor: color,
                          zIndex: 2 + b.lane,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(b.todo);
                        }}
                      >
                        <div className="truncate text-[10px] font-semibold leading-tight">
                          {b.todo.title}
                        </div>
                        <div className="truncate text-[8px] leading-tight opacity-90">
                          {formatTimeRange(b.todo)}
                        </div>
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        点格子新建 · 点色块编辑 · 节次在「外观设置」里配置
      </p>

      {selected ? (
        <TodoEditor
          todo={selected}
          members={editorMembers}
          canAssign={editorCanAssign}
          open
          onClose={() => setSelected(null)}
        />
      ) : null}

      {createPrefill && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]">
              <div className="w-full max-w-lg rounded-xl border border-[var(--border-muted)] bg-white p-4 shadow-xl">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">新建待办</h2>
                  <button
                    type="button"
                    className="text-sm text-[var(--text-muted)]"
                    onClick={() => setCreatePrefill(null)}
                  >
                    关闭
                  </button>
                </div>
                <QuickCreateTodo
                  spaces={spaces}
                  defaultSpaceId={defaultSpaceId || spaces[0]?.id}
                  bare
                  initialStartLocal={createPrefill.startLocal}
                  initialEndLocal={createPrefill.endLocal}
                  initialIsAllDay={createPrefill.isAllDay}
                  initialStartDate={createPrefill.startDate}
                  onCreated={() => setCreatePrefill(null)}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

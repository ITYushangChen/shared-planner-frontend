"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  REPORT_STATUS_LABEL,
  REPORT_STATUS_ORDER,
  REPORT_TYPE_LABEL,
  REPORT_TYPE_ORDER,
  buildReportText,
  filterReportData,
  reportFileName,
  type ReportDataLike,
  type ReportTask,
  type ReportType,
} from "@/lib/reports";
import { buildReportXlsx } from "@/lib/report-xlsx";
import {
  getOverviewBounds,
  localDateKey,
  type SpaceNavItem,
} from "@/lib/todos";
import { plainTaskDescriptions } from "@/lib/ai-api";
import { chipClass } from "../ui-btn-class";

type Props = {
  spaces: SpaceNavItem[];
  type: ReportType;
  /** 日/周为 YYYY-MM-DD，月为 YYYY-MM */
  input: string;
  selectedSpaceIds: string[];
  viewData: ReportDataLike | null;
  fetchError: string | null;
  /** 任务数量达到查询上限，列表可能不完整 */
  taskLimitReached: boolean;
};

type SpaceMode = "multi" | "single";

const PERIOD_WORD: Record<ReportType, string> = {
  day: "本日",
  week: "本周",
  month: "本月",
};

/** 报告周期边界（本地日期键），用于默认勾选周期内的任务 */
function reportPeriodBounds(
  type: ReportType,
  input: string,
): { startKey: string; endKey: string } | null {
  if (type === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(input);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const start = new Date(y, mo - 1, 1);
    const end = new Date(y, mo, 0, 23, 59, 59, 999);
    return { startKey: localDateKey(start), endKey: localDateKey(end) };
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!d) return null;
  const base = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  const { start, end } = getOverviewBounds(type, base);
  return { startKey: localDateKey(start), endKey: localDateKey(end) };
}

export function ReportWorkspace({
  spaces,
  type,
  input,
  selectedSpaceIds,
  viewData,
  fetchError,
  taskLimitReached,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<SpaceMode>(
    selectedSpaceIds.length > 1 ? "multi" : "single",
  );
  const [copied, setCopied] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [aiBusy, setAiBusy] = useState(false);

  const taskKey = useMemo(() => {
    if (!viewData) return "";
    return viewData.spaces.flatMap((g) => g.tasks.map((t) => t.id)).join(",");
  }, [viewData]);

  const periodBounds = useMemo(
    () => reportPeriodBounds(type, input),
    [type, input],
  );
  // 任务列表变化后默认全选，直接展示所有任务
  const [prevTaskKey, setPrevTaskKey] = useState(taskKey);
  if (prevTaskKey !== taskKey) {
    setPrevTaskKey(taskKey);
    setSelectedTaskIds(new Set(taskKey ? taskKey.split(",") : []));
  }

  const filteredData = useMemo(
    () => (viewData ? filterReportData(viewData, selectedTaskIds) : null),
    [viewData, selectedTaskIds],
  );
  const reportText = useMemo(
    () => (filteredData ? buildReportText(filteredData) : ""),
    [filteredData],
  );

  function patchQuery(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  function setSpaces(ids: string[]) {
    patchQuery({ spaces: ids.length > 0 ? ids.join(",") : null });
  }

  function setType(next: ReportType) {
    const patch: Record<string, string> = { type: next };
    if (next === "month") {
      const m = /^(\d{4})-(\d{2})/.exec(input);
      patch.date = m ? `${m[1]}-${m[2]}` : "";
    } else {
      const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
      patch.date = d ? `${d[1]}-${d[2]}-${d[3]}` : "";
    }
    patchQuery(patch);
  }

  function switchMode(next: SpaceMode) {
    setMode(next);
    if (next === "single" && selectedSpaceIds.length > 1) {
      setSpaces([selectedSpaceIds[0]]);
    } else if (next === "single" && selectedSpaceIds.length === 0 && spaces[0]) {
      setSpaces([spaces[0].id]);
    }
  }

  function toggleSpace(id: string) {
    if (selectedSpaceIds.includes(id)) {
      setSpaces(selectedSpaceIds.filter((x) => x !== id));
    } else {
      setSpaces([...selectedSpaceIds, id]);
    }
  }

  function toggleTask(id: string) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllTasks() {
    setSelectedTaskIds(new Set(taskKey ? taskKey.split(",") : []));
  }

  function selectPeriodTasks() {
    const ids: string[] = [];
    if (viewData) {
      for (const group of viewData.spaces) {
        for (const task of group.tasks) {
          if (
            !periodBounds ||
            (task.date_iso &&
              task.date_iso >= periodBounds.startKey &&
              task.date_iso <= periodBounds.endKey)
          ) {
            ids.push(task.id);
          }
        }
      }
    }
    setSelectedTaskIds(new Set(ids));
  }

  function clearTasks() {
    setSelectedTaskIds(new Set());
  }

  async function copyReport() {
    const text = reportText;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("复制失败，请手动选择文本复制。");
    }
  }

  async function exportExcel() {
    if (!filteredData) return;
    setAiBusy(true);
    try {
      // 接入 AI：把任务名称改写成大白话（失败时自动回退规则生成）
      let plainMap: Record<string, string> = {};
      const tasks = filteredData.spaces.flatMap((g) => g.tasks);
      try {
        const res = await plainTaskDescriptions(
          tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            category: t.category,
          })),
        );
        plainMap = Object.fromEntries(
          (res.items ?? [])
            .filter((it) => it?.id && it?.text)
            .map((it) => [it.id, it.text]),
        );
      } catch {
        plainMap = {};
      }

      const buffer = await buildReportXlsx(filteredData, {
        taskPlainText: plainMap,
      });
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = reportFileName(filteredData);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setAiBusy(false);
    }
  }

  const allSelected = selectedSpaceIds.length === 0;
  const spaceLabel = allSelected
    ? "全部空间"
    : selectedSpaceIds.length === 1
      ? (spaces.find((s) => s.id === selectedSpaceIds[0])?.name ??
        "1 个空间")
      : `已选 ${selectedSpaceIds.length} 个空间`;
  const allTasksCount = taskKey ? taskKey.split(",").length : 0;

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-[var(--border-muted)] bg-white/80 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/开拓隆海logo.png"
            alt="开拓隆海"
            className="h-9 w-auto shrink-0"
          />
          <div
            className="flex items-center gap-1.5 rounded-full border border-[var(--border-muted)] bg-white p-1"
            role="group"
            aria-label="报告类型"
          >
            {REPORT_TYPE_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                className={chipClass(type === t)}
                onClick={() => setType(t)}
              >
                {REPORT_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span className="shrink-0">
              {type === "month" ? "月份" : "日期"}
            </span>
            <input
              type={type === "month" ? "month" : "date"}
              value={input}
              onChange={(e) => patchQuery({ date: e.target.value || null })}
              className="rounded-lg border border-[var(--border-muted)] bg-white px-2 py-1.5 text-sm text-[var(--brand-ink)] outline-none focus:border-brand"
            />
          </label>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div
              className="flex items-center overflow-hidden rounded-full border border-[var(--border-muted)] bg-white text-xs"
              role="group"
              aria-label="空间选择方式"
            >
              {(
                [
                  ["single", "单选"],
                  ["multi", "多选"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={mode === key}
                  className={[
                    "px-3 py-1.5 font-medium transition-colors",
                    mode === key
                      ? "bg-zinc-900 text-white"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)]",
                  ].join(" ")}
                  onClick={() => switchMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <SpacePicker
              spaces={spaces}
              mode={mode}
              allSelected={allSelected}
              selectedSpaceIds={selectedSpaceIds}
              label={spaceLabel}
              onSelectAll={() => setSpaces([])}
              onToggle={toggleSpace}
              onPickSingle={(id) => setSpaces([id])}
            />

            <button
              type="button"
              disabled={!viewData || allTasksCount === 0}
              className={[
                "rounded-full border border-[#2f5f8f]/55 bg-white px-4 py-2 text-sm font-medium text-[#2f5f8f]",
                "transition-all duration-200 hover:bg-[#e8f0f7] active:scale-[0.98]",
                "disabled:cursor-not-allowed disabled:opacity-50",
              ].join(" ")}
              onClick={copyReport}
            >
              {copied ? "已复制 ✓" : "复制报告"}
            </button>
            <button
              type="button"
              disabled={
                aiBusy ||
                !filteredData ||
                filteredData.spaces.length === 0
              }
              className={[
                "rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white",
                "transition-all duration-200 hover:bg-zinc-800 active:scale-[0.98]",
                "disabled:cursor-not-allowed disabled:opacity-50",
              ].join(" ")}
              onClick={exportExcel}
            >
              {aiBusy ? "AI 生成中…" : "导出 Excel"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
        {fetchError ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            加载任务失败：{fetchError}
          </p>
        ) : null}

        {spaces.length === 0 ? (
          <EmptyState
            title="暂无空间"
            description="加入或创建一个空间后，即可按周期生成报告。"
          />
        ) : !viewData || allTasksCount === 0 ? (
          <EmptyState
            title="所选空间暂无任务"
            description="试试勾选其他空间，或先在空间里创建任务，再来生成报告。"
          />
        ) : viewData ? (
          <>
            {taskLimitReached ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                任务数量较多，仅展示最近一部分（进行中/未开始 2000 条、已完成 1000
                条），可在上方缩小空间范围。
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-base font-semibold text-[var(--brand-ink)]">
                {REPORT_TYPE_LABEL[viewData.type]}
              </h1>
              <p className="text-sm text-[var(--text-muted)]">
                {viewData.rangeLabel} · {viewData.selectedSpacesLabel}
              </p>
              <div className="ml-auto flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <button
                  type="button"
                  className="rounded-full border border-[var(--border-muted)] bg-white px-3 py-1.5 font-medium text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
                  onClick={selectAllTasks}
                >
                  全选
                </button>
                <button
                  type="button"
                  className="rounded-full border border-[var(--border-muted)] bg-white px-3 py-1.5 font-medium text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
                  onClick={selectPeriodTasks}
                >
                  勾选{PERIOD_WORD[type]}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-[var(--border-muted)] bg-white px-3 py-1.5 font-medium text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
                  onClick={clearTasks}
                >
                  清空
                </button>
                <span>
                  已选 {selectedTaskIds.size} / {allTasksCount} 项任务
                </span>
              </div>
            </div>
            <SummaryCards data={viewData} />
            <div className="flex flex-col gap-4">
              {viewData.spaces.map((group) => (
                <SpaceReportCard
                  key={group.space_id}
                  group={group}
                  selectedTaskIds={selectedTaskIds}
                  onToggleTask={toggleTask}
                  onOpenDetail={(task) =>
                    router.push(`/app/reports/task/${task.id}`)
                  }
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

function SpacePicker({
  spaces,
  mode,
  allSelected,
  selectedSpaceIds,
  label,
  onSelectAll,
  onToggle,
  onPickSingle,
}: {
  spaces: SpaceNavItem[];
  mode: SpaceMode;
  allSelected: boolean;
  selectedSpaceIds: string[];
  label: string;
  onSelectAll: () => void;
  onToggle: (id: string) => void;
  onPickSingle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="max-w-[12rem] truncate rounded-full border border-[var(--border-muted)] bg-white px-4 py-2 text-sm font-medium text-[var(--brand-ink)] outline-none hover:border-brand"
      >
        {label}
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="关闭空间选择"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-[var(--border-muted)] bg-white py-1 shadow-lg">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
              onClick={() => {
                onSelectAll();
                setOpen(false);
              }}
            >
              <input
                type={mode === "single" ? "radio" : "checkbox"}
                readOnly
                checked={allSelected}
                className="pointer-events-none accent-zinc-900"
              />
              全部空间
            </button>
            {spaces.map((s) => {
              const checked = allSelected || selectedSpaceIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
                >
                  <input
                    type={mode === "single" ? "radio" : "checkbox"}
                    name="report-space"
                    checked={checked}
                    className="accent-zinc-900"
                    onChange={() => {
                      if (mode === "single") {
                        onPickSingle(s.id);
                      } else {
                        onToggle(s.id);
                      }
                      setOpen(false);
                    }}
                  />
                  <span className="min-w-0 truncate">{s.name}</span>
                </label>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--border-muted)] bg-white/60 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-[var(--brand-ink)]">{title}</p>
      <p className="text-xs text-[var(--text-muted)]">{description}</p>
    </div>
  );
}

function SummaryCards({ data }: { data: ReportDataLike }) {
  const items = [
    { label: "任务总数", value: data.totals.total, tone: "zinc" },
    { label: REPORT_STATUS_LABEL.done, value: data.totals.done, tone: "green" },
    {
      label: REPORT_STATUS_LABEL.in_progress,
      value: data.totals.in_progress,
      tone: "blue",
    },
    { label: REPORT_STATUS_LABEL.todo, value: data.totals.todo, tone: "red" },
  ] as const;

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col gap-1 rounded-xl border border-[var(--border-muted)] bg-white px-4 py-3"
        >
          <span className="text-xs text-[var(--text-muted)]">{item.label}</span>
          <span
            className={[
              "text-2xl font-bold leading-none",
              toneText(item.tone),
            ].join(" ")}
          >
            {item.value}
          </span>
        </div>
      ))}
    </section>
  );
}

function toneText(tone: "zinc" | "green" | "blue" | "red") {
  if (tone === "green") return "text-emerald-600";
  if (tone === "blue") return "text-sky-600";
  if (tone === "red") return "text-rose-600";
  return "text-zinc-900";
}

function SpaceReportCard({
  group,
  selectedTaskIds,
  onToggleTask,
  onOpenDetail,
}: {
  group: ReportDataLike["spaces"][number];
  selectedTaskIds: Set<string>;
  onToggleTask: (id: string) => void;
  onOpenDetail: (task: ReportTask) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border-muted)] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-muted)] bg-[var(--surface-muted)]/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
          <h2 className="truncate text-sm font-semibold text-[var(--brand-ink)]">
            {group.space_name}
          </h2>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          {group.total} 项 · 完成 {group.counts.done} · 进行中{" "}
          {group.counts.in_progress} · 未开始 {group.counts.todo}
        </p>
      </header>

      <div className="divide-y divide-[var(--border-muted)]">
        {REPORT_STATUS_ORDER.map((status) => {
          const tasks = group.tasks.filter((t) => t.status === status);
          if (tasks.length === 0) return null;
          return (
            <div key={status} className="px-4 py-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-ink)]">
                <span className={statusDot(status)} />
                {REPORT_STATUS_LABEL[status]}
                <span className="font-normal text-[var(--text-muted)]">
                  {tasks.length}
                </span>
              </p>
              <ul className="flex flex-col gap-1">
                {tasks.map((task) => {
                  const checked = selectedTaskIds.has(task.id);
                  return (
                    <li
                      key={task.id}
                      className={[
                        "flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm",
                        checked
                          ? "bg-[var(--surface-muted)]/70"
                          : "hover:bg-[var(--surface-muted)]",
                      ].join(" ")}
                    >
                      <label className="mt-1 flex shrink-0 cursor-pointer items-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleTask(task.id)}
                          className="accent-zinc-900"
                        />
                      </label>
                      <button
                        type="button"
                        title="查看任务明细"
                        onClick={() => onOpenDetail(task)}
                        className="group flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                      >
                        <span className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          {task.priority === "high" ? (
                            <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">
                              重要
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1 truncate font-medium text-[var(--brand-ink)] hover:underline">
                            {task.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100">
                            查看明细
                          </span>
                          <span className="shrink-0 text-xs text-[var(--text-muted)]">
                            {task.date_iso
                              ? task.date_iso.slice(5).replace("-", "/")
                              : "待排期"}
                          </span>
                          {task.assignees.length > 0 ? (
                            <span className="shrink-0 text-xs text-[var(--text-muted)]">
                              {task.assignees.join("、")}
                            </span>
                          ) : null}
                        </span>
                        {task.description?.trim() ? (
                          <span className="line-clamp-2 text-xs leading-snug text-[var(--text-muted)]">
                            {task.description.trim()}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function statusDot(status: "done" | "in_progress" | "todo") {
  if (status === "done") return "h-2 w-2 rounded-full bg-emerald-500";
  if (status === "in_progress") return "h-2 w-2 rounded-full bg-sky-500";
  return "h-2 w-2 rounded-full bg-rose-400";
}

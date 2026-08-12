"use client";

import type { DragEvent, ReactNode } from "react";
import type { QuadrantKey } from "@/lib/todos";

export const NOTEBOOK_QUADRANT_ORDER: QuadrantKey[] = [
  "urgent_important",
  "important",
  "urgent_normal",
  "normal",
];

export const NOTEBOOK_QUADRANT_META: Record<
  QuadrantKey,
  { title: string; emptyHint: string }
> = {
  urgent_important: {
    title: "重要且紧急",
    emptyHint: "立刻处理",
  },
  important: {
    title: "重要不紧急",
    emptyHint: "计划后完成",
  },
  urgent_normal: {
    title: "紧急不重要",
    emptyHint: "尽快安排",
  },
  normal: {
    title: "不重要不紧急",
    emptyHint: "可延后",
  },
};

type Props = {
  title: string;
  openCount: number;
  doneCount: number;
  emptyHint: string;
  dragOver?: boolean;
  onCreate?: () => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  children: ReactNode;
  isEmpty?: boolean;
};

/** 笔记本风格四象限卡片（参考稿：粗黑框 + 线圈 + 统计 + 加号） */
export function NotebookQuadrant({
  title,
  openCount,
  doneCount,
  emptyHint,
  dragOver,
  onCreate,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
  isEmpty,
}: Props) {
  return (
    <div
      className={[
        "relative flex min-h-[140px] flex-col rounded-2xl border-[2.5px] border-zinc-900 bg-white transition-shadow",
        dragOver ? "ring-2 ring-brand/40 shadow-md" : "",
      ].join(" ")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* 线圈装饰 */}
      <div
        className="pointer-events-none absolute -left-1.5 top-3 z-10 flex flex-col gap-1.5"
        aria-hidden
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-3 w-3 rounded-full border-[2.5px] border-zinc-900 bg-white"
          />
        ))}
      </div>

      <div className="flex items-center gap-2 border-b-[2.5px] border-zinc-900 py-2.5 pl-5 pr-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-900">
          {title}
        </p>
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-zinc-800"
          title="未完成"
        >
          <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-zinc-900" />
          {openCount}
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-zinc-800"
          title="已完成"
        >
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-zinc-900 text-[9px] text-white">
            ✓
          </span>
          {doneCount}
        </span>
        {onCreate ? (
          <button
            type="button"
            aria-label={`在${title}新建`}
            title="新建待办"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-zinc-900 text-base font-light leading-none text-zinc-900 active:bg-zinc-100"
            onClick={onCreate}
          >
            +
          </button>
        ) : null}
      </div>

      <div className="flex max-h-[min(42vh,380px)] min-h-[88px] flex-1 flex-col gap-1 overflow-y-auto p-2.5 pl-4">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-zinc-500">
            <NotebookEmptyIcon />
            <p className="text-xs">{emptyHint}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function NotebookEmptyIcon() {
  return (
    <svg
      width="48"
      height="40"
      viewBox="0 0 48 40"
      fill="none"
      aria-hidden
      className="text-zinc-400"
    >
      <ellipse cx="24" cy="28" rx="14" ry="6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="24" cy="16" r="9" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="20.5" cy="15" r="1.2" fill="currentColor" />
      <circle cx="27.5" cy="15" r="1.2" fill="currentColor" />
      <path
        d="M21 19c1.2 1.2 4.8 1.2 6 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M14 12l-3-4M34 12l3-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

"use client";

import { useRef, useState, type MouseEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { TODO_DND_MIME } from "@/lib/quadrant-dnd";
import {
  PRIORITY_LABEL,
  formatTodoTimeLabel,
  resolveTodoDurationMinutes,
  type TodoRow,
} from "@/lib/todos";
import { resolveTodoColor } from "@/lib/ui-prefs";
import { useUiPrefsOptional } from "./ui-prefs-provider";

type Props = {
  todo: TodoRow;
  conflicted?: boolean;
  draggable?: boolean;
  importanceDrag?: boolean;
  onToggleImportance?: () => void;
  /** 左侧圆圈标记完成 */
  showComplete?: boolean;
  variant?: "list" | "card";
  layout?: "row" | "stack";
  onOpen?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
};

function subtitleLabel(todo: TodoRow): string {
  return formatTodoTimeLabel(todo);
}

export function CompactTodoCard({
  todo,
  conflicted,
  draggable = false,
  importanceDrag = false,
  onToggleImportance,
  showComplete = false,
  variant = "list",
  layout = "row",
  onOpen,
  onContextMenu,
}: Props) {
  const supabase = createClient();
  const dragMoved = useRef(false);
  const [toggling, setToggling] = useState(false);
  const [doneOptimistic, setDoneOptimistic] = useState<boolean | null>(null);
  const uiPrefs = useUiPrefsOptional()?.globalPrefs;
  const accent = conflicted
    ? "#e85d5d"
    : resolveTodoColor(todo.color, todo.priority, uiPrefs);
  const isDone =
    doneOptimistic !== null ? doneOptimistic : todo.status === "done";
  const timeLabel = subtitleLabel(todo);
  const importanceLabel = PRIORITY_LABEL[todo.priority] ?? "不重要";
  const durationMinutes = resolveTodoDurationMinutes(todo);

  const isCard = variant === "card";
  const htmlDraggable = importanceDrag || draggable;

  async function toggleDone(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (toggling) return;
    setToggling(true);
    const nextDone = !isDone;
    setDoneOptimistic(nextDone);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("todos")
      .update(
        nextDone
          ? {
              status: "done",
              completed_by: user?.id ?? null,
              completed_at: new Date().toISOString(),
            }
          : {
              status: "todo",
              completed_by: null,
              completed_at: null,
            },
      )
      .eq("id", todo.id);
    setToggling(false);
    if (error) {
      setDoneOptimistic(null);
      alert(error.message);
    }
  }

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      draggable={htmlDraggable}
      className={[
        "group flex w-full items-start gap-2 text-left transition-colors duration-200",
        isCard
          ? "rounded-lg border border-zinc-200 bg-white px-2 py-1.5 hover:bg-zinc-50"
          : "border-b border-zinc-100 bg-white px-2 py-1.5 hover:bg-zinc-50",
        conflicted ? "border-red-200 bg-red-50/50" : "",
        draggable ? "fc-external-todo cursor-grab active:cursor-grabbing" : "",
        importanceDrag ? "cursor-grab active:cursor-grabbing" : "",
        onOpen && !htmlDraggable ? "cursor-pointer" : "",
        isDone ? "opacity-70" : "",
      ].join(" ")}
      data-id={todo.id}
      data-title={todo.title}
      data-duration={
        durationMinutes != null ? String(durationMinutes) : undefined
      }
      onDragStart={(e) => {
        if (!importanceDrag && !draggable) return;
        dragMoved.current = true;
        e.dataTransfer.setData(TODO_DND_MIME, todo.id);
        e.dataTransfer.setData("text/plain", todo.id);
        e.dataTransfer.effectAllowed = "move";
        // 隐藏浏览器原生偏影，只留 FullCalendar / 投放目标反馈
        const img = new Image();
        img.src =
          "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        e.dataTransfer.setDragImage(img, 0, 0);
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          dragMoved.current = false;
        }, 0);
      }}
      onClick={(e) => {
        if (!onOpen) return;
        if (dragMoved.current) return;
        const el = e.target as HTMLElement;
        if (el.closest("[data-importance-toggle],[data-complete-toggle]"))
          return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (!onOpen) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={onContextMenu}
    >
      {showComplete ? (
        <button
          type="button"
          data-complete-toggle
          aria-label={isDone ? "标为未完成" : "标为完成"}
          title={isDone ? "标为未完成" : "标为完成"}
          disabled={toggling}
          onClick={toggleDone}
          className={[
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            isDone
              ? "border-zinc-900 bg-zinc-900 text-[10px] text-white"
              : "border-zinc-900 bg-white",
          ].join(" ")}
        >
          {isDone ? "✓" : null}
        </button>
      ) : null}

      <div className={["min-w-0 flex-1", layout === "stack" ? "" : ""].join(" ")}>
        <p
          className={[
            "truncate text-[12px] font-semibold leading-tight",
            isDone ? "text-zinc-400 line-through" : "text-zinc-900",
          ].join(" ")}
        >
          {todo.title}
          {conflicted ? (
            <span className="ml-1 text-[9px] font-medium text-red-600">
              冲突
            </span>
          ) : null}
        </p>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-tight text-zinc-500">
          <span className="min-w-0 truncate tabular-nums" title={timeLabel}>
            {timeLabel}
          </span>
          <span className="shrink-0 text-zinc-300">·</span>
          {onToggleImportance ? (
            <button
              type="button"
              data-importance-toggle
              title="切换重要性"
              onClick={(e) => {
                e.stopPropagation();
                onToggleImportance();
              }}
              className="shrink-0 font-medium active:opacity-70"
              style={{ color: accent }}
            >
              {importanceLabel}
            </button>
          ) : (
            <span className="shrink-0 font-medium" style={{ color: accent }}>
              {importanceLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

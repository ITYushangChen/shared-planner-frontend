"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { Draggable } from "@fullcalendar/interaction";
import { createClient } from "@/lib/supabase/client";
import { emitTodoUpserted } from "@/lib/todo-schedule-events";
import { suppressTodosRealtimeRefresh } from "@/lib/todos-realtime-gate";
import { DEFAULT_DEPARTMENT } from "@/lib/departments";
import {
  durationToFcString,
  type SpaceMemberOption,
  type SpaceNavItem,
  type TodoRow,
} from "@/lib/todos";
import { CompactTodoCard } from "./compact-todo-card";

const TodoEditor = dynamic(
  () => import("./todo-editor").then((m) => ({ default: m.TodoEditor })),
  { ssr: false },
);
const QuickCreateTodo = dynamic(
  () =>
    import("./quick-create-todo").then((m) => ({ default: m.QuickCreateTodo })),
  { ssr: false },
);

type Props = {
  todos: TodoRow[];
  members?: SpaceMemberOption[];
  membersBySpace?: Record<string, SpaceMemberOption[]>;
  canAssignBySpace?: Record<string, boolean>;
  canAssign?: boolean;
  /** 接受从日历拖入以取消排期 */
  acceptCalendarDrop?: boolean;
  /** 紧凑侧栏：隐藏拖拽说明时可改文案 */
  compact?: boolean;
  spaces?: SpaceNavItem[];
  defaultSpaceId?: string;
  allowOverview?: boolean;
};

export function UnscheduledList({
  todos,
  members = [],
  membersBySpace,
  canAssignBySpace,
  canAssign = false,
  acceptCalendarDrop = true,
  compact = false,
  spaces = [],
  defaultSpaceId,
  allowOverview = false,
}: Props) {
  const supabase = createClient();
  const containerRef = useRef<HTMLUListElement>(null);
  const [selected, setSelected] = useState<TodoRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    todo: TodoRow;
  } | null>(null);

  const editorMembers = selected
    ? (membersBySpace?.[selected.space_id] ?? members)
    : members;
  const editorCanAssign = selected
    ? (canAssignBySpace?.[selected.space_id] ?? canAssign)
    : canAssign;

  const canCreate = spaces.length > 0;

  // 仅日历旁挂 FullCalendar Draggable；总览/列表用原生 HTML5 拖到象限
  useEffect(() => {
    if (!acceptCalendarDrop || !containerRef.current) return;
    const draggable = new Draggable(containerRef.current, {
      itemSelector: ".fc-external-todo",
      eventData(eventEl) {
        const raw = eventEl.getAttribute("data-duration");
        const mins = raw ? Number(raw) : NaN;
        return {
          id: eventEl.getAttribute("data-id") || undefined,
          title: eventEl.getAttribute("data-title") || "待办",
          duration:
            Number.isFinite(mins) && mins > 0
              ? durationToFcString(mins)
              : "01:00",
          create: true,
        };
      },
    });
    return () => draggable.destroy();
  }, [todos.length, acceptCalendarDrop]);

  async function copyTodo(todo: TodoRow) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: created, error } = await supabase
      .from("todos")
      .insert({
        space_id: todo.space_id,
        creator_id: user.id,
        title: `${todo.title}（副本）`,
        description: todo.description,
        priority: todo.priority,
        department: todo.department ?? DEFAULT_DEPARTMENT,
        status: "todo",
        start_at: null,
        end_at: null,
        is_all_day: false,
        source: "manual",
      })
      .select("id")
      .single();
    if (error || !created) return;
    await supabase.from("todo_assignees").insert({
      todo_id: created.id,
      user_id: user.id,
    });
    suppressTodosRealtimeRefresh(6000);
    emitTodoUpserted({
      ...todo,
      id: created.id,
      title: `${todo.title}（副本）`,
      status: "todo",
      start_at: null,
      end_at: null,
      is_all_day: false,
      todo_assignees: [{ user_id: user.id }],
    });
    setMenu(null);
  }

  function openCreate() {
    if (!canCreate) return;
    setCreateOpen(true);
  }

  const createModal =
    createOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]"
            onClick={(e) => {
              if (e.target === e.currentTarget) setCreateOpen(false);
            }}
          >
            <div className="w-full max-w-lg rounded-xl border border-[var(--border-muted)] bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--brand-ink)]">
                  创建未排期任务
                </h2>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                  onClick={() => setCreateOpen(false)}
                >
                  关闭
                </button>
              </div>
              <QuickCreateTodo
                spaces={spaces}
                defaultSpaceId={defaultSpaceId}
                members={members}
                membersBySpace={membersBySpace}
                canAssign={canAssign}
                allowOverview={allowOverview}
                bare
                onCreated={() => setCreateOpen(false)}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      id={acceptCalendarDrop ? "unscheduled-drop-zone" : undefined}
      className={
        compact
          ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-muted)]/50 p-2 transition-[box-shadow,background-color,border-color] duration-150"
          : "rounded-xl border border-dashed border-[var(--border-muted)] bg-[var(--surface-muted)] p-3 transition-[box-shadow,background-color,border-color] duration-150 md:p-4"
      }
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[var(--brand-ink)]">
            未排期待办
          </h2>
          <p className="mt-1 text-[11px] text-[var(--text-muted)] opacity-80">
            {compact
              ? acceptCalendarDrop
                ? "拖到日历排期；点击编辑"
                : "点击卡片编辑"
              : acceptCalendarDrop
                ? "拖到日历排期；从日历拖回此处取消排期；点击空白处创建"
                : "拖到左侧象限可设重要度并填写时间；点击空白处创建"}
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            title="创建未排期任务"
            aria-label="创建未排期任务"
            onClick={openCreate}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-muted)] bg-white text-lg font-medium text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
          >
            +
          </button>
        ) : null}
      </div>

      {todos.length === 0 ? (
        <button
          type="button"
          disabled={!canCreate}
          onClick={openCreate}
          className={[
            "mt-3 flex w-full flex-col items-center rounded-lg px-2 text-center transition-colors hover:bg-white/60 disabled:cursor-default disabled:hover:bg-transparent",
            compact ? "py-4" : "py-6 mt-4",
          ].join(" ")}
        >
          <svg
            width="48"
            height="40"
            viewBox="0 0 48 40"
            fill="none"
            aria-hidden
            className="opacity-40"
          >
            <rect
              x="4"
              y="8"
              width="40"
              height="28"
              rx="6"
              stroke="var(--brand)"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            <path
              d="M16 20h16M16 26h10"
              stroke="var(--text-muted)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <p className="mt-2 text-sm text-[var(--text-muted)] opacity-70">
            {canCreate ? "暂无未排期 · 点击创建" : "暂无未排期待办"}
          </p>
        </button>
      ) : (
        <>
          <ul
            ref={containerRef}
            className={[
              "mt-2 flex flex-col gap-2",
              compact ? "min-h-0 flex-1 overflow-y-auto pb-1" : "",
            ].join(" ")}
          >
            {todos.map((t) => (
              <li key={t.id}>
                <CompactTodoCard
                  todo={t}
                  draggable={acceptCalendarDrop}
                  importanceDrag={!acceptCalendarDrop}
                  onOpen={() => setSelected(t)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, todo: t });
                  }}
                />
              </li>
            ))}
          </ul>
          {canCreate ? (
            <button
              type="button"
              onClick={openCreate}
              className="mt-2 w-full shrink-0 rounded-lg border border-dashed border-[var(--border-muted)] py-2 text-xs text-[var(--text-muted)] transition-colors hover:border-[var(--brand)] hover:bg-white hover:text-[var(--brand-ink)]"
            >
              + 创建未排期任务
            </button>
          ) : null}
        </>
      )}

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
            复制一份
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

      {createModal}
    </div>
  );
}

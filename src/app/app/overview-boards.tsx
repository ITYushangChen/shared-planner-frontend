"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { findConflictTodoIds } from "@/lib/conflicts";
import {
  QUADRANT_LABEL,
  QUADRANT_ORDER,
  getOverviewBounds,
  isAssignedToUser,
  todoOverlapsRange,
  todoQuadrant,
  type OverviewRange,
  type QuadrantKey,
  type SpaceMemberOption,
  type SpaceNavItem,
  type TodoRow,
} from "@/lib/todos";
import { CompactTodoCard } from "./compact-todo-card";
import {
  NOTEBOOK_QUADRANT_META,
  NOTEBOOK_QUADRANT_ORDER,
  NotebookQuadrant,
} from "./notebook-quadrant";
import { chipClass } from "./ui-btn-class";
import { useImportanceDrop } from "./use-importance-drop";

const QuickCreateTodo = dynamic(
  () =>
    import("./quick-create-todo").then((m) => ({ default: m.QuickCreateTodo })),
  { ssr: false },
);
const TodoEditor = dynamic(
  () => import("./todo-editor").then((m) => ({ default: m.TodoEditor })),
  { ssr: false },
);

type BoardRange = OverviewRange | "all";
type GroupBy = "none" | "assignee" | "priority";

const UNASSIGNED_KEY = "__unassigned__";

const QUADRANT_HINT: Record<QuadrantKey, string> = {
  urgent_important: "立刻处理",
  urgent_normal: "尽快安排",
  important: "计划推进",
  normal: "可延后",
};

function sortTodosByTime(list: TodoRow[]) {
  return [...list].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const as = a.start_at
      ? new Date(a.start_at).getTime()
      : a.due_at
        ? new Date(a.due_at).getTime()
        : Number.MAX_SAFE_INTEGER;
    const bs = b.start_at
      ? new Date(b.start_at).getTime()
      : b.due_at
        ? new Date(b.due_at).getTime()
        : Number.MAX_SAFE_INTEGER;
    return as - bs;
  });
}

function primaryAssigneeId(todo: TodoRow): string {
  const first = todo.todo_assignees?.[0]?.user_id;
  return first || UNASSIGNED_KEY;
}

type BoardColumn = {
  key: string;
  label: string;
  hint?: string;
  todos: TodoRow[];
  doneCount: number;
  totalCount: number;
};

type Props = {
  todos: TodoRow[];
  completed?: TodoRow[];
  members?: SpaceMemberOption[];
  membersBySpace?: Record<string, SpaceMemberOption[]>;
  canAssign?: boolean;
  canAssignBySpace?: Record<string, boolean>;
  showMineFilter?: boolean;
  mineOnly?: boolean;
  onMineOnlyChange?: (v: boolean) => void;
  currentUserId?: string;
  /** none 列表；assignee 公共空间；priority 四象限 */
  groupBy?: GroupBy;
  /** @deprecated 使用 groupBy="assignee" */
  groupByAssignee?: boolean;
  /** 手机四象限「+」快速创建用 */
  spaces?: SpaceNavItem[];
  /** 日/周/月范围（来自底栏或顶栏） */
  boardRange?: BoardRange;
};

export function OverviewBoards({
  todos,
  completed: completedProp = [],
  members = [],
  membersBySpace,
  canAssign = false,
  canAssignBySpace,
  showMineFilter = false,
  mineOnly = false,
  onMineOnlyChange,
  currentUserId,
  groupBy: groupByProp,
  groupByAssignee = false,
  spaces = [],
  boardRange = "all",
}: Props) {
  const groupBy: GroupBy =
    groupByProp ?? (groupByAssignee ? "assignee" : "none");

  const range = boardRange;
  const [selected, setSelected] = useState<TodoRow | null>(null);
  const [createFor, setCreateFor] = useState<{
    spaceId: string;
    priority: "high" | "low";
  } | null>(null);
  const conflictIds = useMemo(() => findConflictTodoIds(todos), [todos]);

  const completed = useMemo(() => {
    return [...completedProp].sort((a, b) => {
      const ac = a.completed_at ? new Date(a.completed_at).getTime() : 0;
      const bc = b.completed_at ? new Date(b.completed_at).getTime() : 0;
      return bc - ac;
    });
  }, [completedProp]);

  const drop = useImportanceDrop(
    useMemo(() => [todos, completed], [todos, completed]),
  );

  const sourceTodos = useMemo(() => {
    const map = new Map<string, TodoRow>();
    for (const t of todos) map.set(t.id, t);
    for (const t of completed) map.set(t.id, t);
    return drop.applyPriority([...map.values()]);
  }, [completed, todos, drop]);

  const inRange = useMemo(() => {
    if (range === "all") return sortTodosByTime(sourceTodos);
    const { start, end } = getOverviewBounds(range);
    const list = sourceTodos.filter((t) => todoOverlapsRange(t, start, end));
    return sortTodosByTime(list);
  }, [sourceTodos, range]);

  const boardColumns = useMemo((): BoardColumn[] => {
    if (groupBy === "assignee") {
      let columnMembers =
        mineOnly && currentUserId
          ? members.filter((m) => m.user_id === currentUserId)
          : members;
      if (mineOnly && currentUserId && columnMembers.length === 0) {
        columnMembers = [
          {
            user_id: currentUserId,
            display_name: "我",
            email: null,
          },
        ];
      }

      const byId = new Map<string, TodoRow[]>();
      for (const m of columnMembers) byId.set(m.user_id, []);
      if (!mineOnly) byId.set(UNASSIGNED_KEY, []);

      for (const t of inRange) {
        const key = primaryAssigneeId(t);
        if (!byId.has(key)) {
          if (mineOnly) continue;
          byId.set(key, []);
        }
        byId.get(key)!.push(t);
      }

      const cols: BoardColumn[] = columnMembers.map((m) => {
        const active = byId.get(m.user_id) ?? [];
        const done = completed.filter((t) => isAssignedToUser(t, m.user_id));
        return {
          key: m.user_id,
          label: m.display_name || "成员",
          todos: active,
          doneCount: done.length,
          totalCount: active.length + done.length,
        };
      });

      if (!mineOnly) {
        const unassigned = byId.get(UNASSIGNED_KEY) ?? [];
        const unassignedDone = completed.filter(
          (t) => !t.todo_assignees?.length,
        );
        if (
          unassigned.length > 0 ||
          unassignedDone.length > 0 ||
          columnMembers.length === 0
        ) {
          cols.push({
            key: UNASSIGNED_KEY,
            label: "未指派",
            todos: unassigned,
            doneCount: unassignedDone.length,
            totalCount: unassigned.length + unassignedDone.length,
          });
        }
      }
      return cols;
    }

    if (groupBy === "priority") {
      return QUADRANT_ORDER.map((key) => {
        const items = inRange.filter(
          (t) =>
            todoQuadrant(t, Date.now(), {
              includeDone: t.status === "done",
            }) === key,
        );
        return {
          key,
          label: QUADRANT_LABEL[key],
          hint: QUADRANT_HINT[key],
          todos: items,
          doneCount: items.filter((t) => t.status === "done").length,
          totalCount: items.length,
        };
      });
    }

    return [];
  }, [groupBy, members, inRange, completed, mineOnly, currentUserId]);

  const isColumnBoard = groupBy === "assignee" || groupBy === "priority";
  const isQuadrant = groupBy === "priority";

  const editorMembers = selected
    ? (membersBySpace?.[selected.space_id] ?? members)
    : members;
  const editorCanAssign = selected
    ? (canAssignBySpace?.[selected.space_id] ?? canAssign)
    : canAssign;

  return (
    <section className="flex flex-col gap-3">
      {drop.dropError ? (
        <p className="text-xs text-red-600">{drop.dropError}</p>
      ) : null}
      {showMineFilter && onMineOnlyChange ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onMineOnlyChange(!mineOnly)}
            className={chipClass(mineOnly)}
          >
            个人任务
          </button>
        </div>
      ) : null}

      {isQuadrant ? (
        <>
          {/* 手机：笔记本四象限（竖排） */}
          <div className="flex flex-col gap-3 md:hidden">
            {NOTEBOOK_QUADRANT_ORDER.map((key) => {
              const col = boardColumns.find((c) => c.key === key);
              const meta = NOTEBOOK_QUADRANT_META[key];
              const todosIn = col?.todos ?? [];
              const openCount = todosIn.filter((t) => t.status !== "done").length;
              const doneCount = todosIn.filter((t) => t.status === "done").length;
              const important =
                key === "urgent_important" || key === "important";
              return (
                <NotebookQuadrant
                  key={key}
                  title={meta.title}
                  openCount={openCount}
                  doneCount={doneCount}
                  emptyHint={meta.emptyHint}
                  isEmpty={todosIn.length === 0}
                  dragOver={drop.dragOverKey === key}
                  onCreate={
                    spaces[0]?.id
                      ? () =>
                          setCreateFor({
                            spaceId: spaces[0].id,
                            priority: important ? "high" : "low",
                          })
                      : undefined
                  }
                  onDragOver={(e) => drop.onDragOverQuadrant(e, key)}
                  onDragLeave={drop.onDragLeaveQuadrant}
                  onDrop={(e) => void drop.onDropQuadrant(e, key)}
                >
                  {todosIn.map((todo) => (
                    <CompactTodoCard
                      key={todo.id}
                      todo={todo}
                      variant="card"
                      layout="stack"
                      showComplete
                      importanceDrag
                      onToggleImportance={() =>
                        void drop.toggleImportance(todo)
                      }
                      conflicted={conflictIds.has(todo.id)}
                      onOpen={() => setSelected(todo)}
                    />
                  ))}
                </NotebookQuadrant>
              );
            })}
          </div>

          {/* 桌面：原四象限（暂不改） */}
          <div className="hidden grid-cols-1 gap-3 sm:grid-cols-2 md:grid">
            {boardColumns.map((col) => (
              <div
                key={col.key}
                onDragOver={(e) => drop.onDragOverQuadrant(e, col.key)}
                onDragLeave={drop.onDragLeaveQuadrant}
                onDrop={(e) => void drop.onDropQuadrant(e, col.key)}
                className={[
                  "flex min-h-[220px] flex-col rounded-xl border bg-[var(--surface-muted)]/50 transition-colors",
                  col.key.startsWith("urgent")
                    ? "border-red-200/80"
                    : "border-[var(--border-muted)]",
                  drop.dragOverKey === col.key
                    ? "border-brand bg-brand-soft/40 ring-2 ring-brand/30"
                    : "",
                ].join(" ")}
              >
                <div className="border-b border-[var(--border-muted)] bg-white/90 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--brand-ink)]">
                        {col.label}
                      </p>
                      {col.hint ? (
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {col.hint}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                      {col.todos.length}
                    </span>
                  </div>
                </div>
                <div className="flex max-h-[min(50vh,420px)] flex-col gap-2 overflow-y-auto p-2">
                  {col.todos.length === 0 ? (
                    <p className="px-1 py-8 text-center text-xs text-[var(--text-muted)]">
                      空 · 可拖入改为
                      {col.key === "urgent_important" ||
                      col.key === "important"
                        ? "重要"
                        : "不重要"}
                    </p>
                  ) : (
                    col.todos.map((todo) => (
                      <CompactTodoCard
                        key={todo.id}
                        todo={todo}
                        variant="card"
                        layout="stack"
                        importanceDrag
                        onToggleImportance={() =>
                          void drop.toggleImportance(todo)
                        }
                        conflicted={conflictIds.has(todo.id)}
                        onOpen={() => setSelected(todo)}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : isColumnBoard ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {boardColumns.map((col) => {
            const ratio =
              col.totalCount > 0 ? col.doneCount / col.totalCount : 0;
            return (
              <div
                key={col.key}
                className="flex w-[260px] shrink-0 flex-col rounded-xl border border-[var(--border-muted)] bg-[var(--surface-muted)]/60"
              >
                <div className="border-b border-[var(--border-muted)] bg-white/90 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-[var(--brand-ink)]">
                      {col.label}
                    </p>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                      {col.doneCount}/{col.totalCount || col.todos.length}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border-muted)]">
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{
                        width: `${Math.round(ratio * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex max-h-[min(70vh,640px)] flex-col gap-1 overflow-y-auto p-2">
                  {col.todos.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-[var(--text-muted)]">
                      暂无任务
                    </p>
                  ) : (
                    col.todos.map((todo) => (
                      <CompactTodoCard
                        key={todo.id}
                        todo={todo}
                        variant="card"
                        layout="stack"
                        conflicted={conflictIds.has(todo.id)}
                        onOpen={() => setSelected(todo)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-muted)] bg-white/80 p-3 backdrop-blur-[1px]">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium text-[var(--text-secondary)]">
              {range === "all"
                ? `全部（${inRange.length}）`
                : `本${range === "day" ? "日" : range === "week" ? "周" : "月"}任务（${inRange.length}）`}
            </p>
          </div>
          {inRange.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--text-muted)]">
              暂无任务
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {inRange.map((todo) => (
                <CompactTodoCard
                  key={todo.id}
                  todo={todo}
                  variant="card"
                  conflicted={conflictIds.has(todo.id)}
                  onOpen={() => setSelected(todo)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {selected ? (
        <TodoEditor
          todo={selected}
          members={editorMembers}
          canAssign={editorCanAssign}
          open
          onClose={() => setSelected(null)}
        />
      ) : null}

      {createFor && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh] md:hidden">
              <div className="w-full max-w-lg rounded-xl border border-[var(--border-muted)] bg-white p-4 shadow-xl">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[var(--brand-ink)]">
                    快速创建
                  </h2>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-sm text-[var(--text-muted)]"
                    onClick={() => setCreateFor(null)}
                  >
                    关闭
                  </button>
                </div>
                <QuickCreateTodo
                  key={`${createFor.spaceId}-${createFor.priority}`}
                  spaces={spaces}
                  defaultSpaceId={createFor.spaceId}
                  initialPriority={createFor.priority}
                  bare
                  onCreated={() => setCreateFor(null)}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}


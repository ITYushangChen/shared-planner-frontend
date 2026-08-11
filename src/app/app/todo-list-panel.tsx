"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { findConflictTodoIds } from "@/lib/conflicts";
import {
  todoQuadrant,
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
import { QuickCreateTodo } from "./quick-create-todo";
import { TodoEditor } from "./todo-editor";
import { useImportanceDrop } from "./use-importance-drop";

type Props = {
  todos: TodoRow[];
  completed?: TodoRow[];
  /** 供从未排期侧栏拖入象限时查找任务 */
  unscheduledTodos?: TodoRow[];
  members: SpaceMemberOption[];
  title?: string;
  canAssign?: boolean;
  hideTitle?: boolean;
  spaces?: SpaceNavItem[];
  defaultSpaceId?: string;
  /** true：象限内同时展示已完成（四象限）；false：仅未完成（四象限待办） */
  includeDone?: boolean;
};

function sortByTime(list: TodoRow[]) {
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

function isImportantKey(key: QuadrantKey) {
  return key === "urgent_important" || key === "important";
}

const SCHEDULE_HINT =
  "请设置开始与结束时间后再保存，以便出现在日历中。";

export function TodoListPanel({
  todos,
  completed = [],
  unscheduledTodos = [],
  members,
  title = "待办列表",
  canAssign = false,
  hideTitle = false,
  spaces = [],
  defaultSpaceId,
  includeDone = false,
}: Props) {
  const [selected, setSelected] = useState<TodoRow | null>(null);
  const [scheduleHint, setScheduleHint] = useState(false);
  const [createFor, setCreateFor] = useState<{
    priority: "high" | "low";
  } | null>(null);

  const conflictIds = useMemo(() => findConflictTodoIds(todos), [todos]);

  const onUnscheduledDrop = useCallback((todo: TodoRow) => {
    setSelected(todo);
    setScheduleHint(true);
  }, []);

  const drop = useImportanceDrop(
    useMemo(
      () => [todos, completed, unscheduledTodos],
      [todos, completed, unscheduledTodos],
    ),
    useMemo(() => ({ onUnscheduledDrop }), [onUnscheduledDrop]),
  );

  const listed = useMemo(() => {
    const open = drop.applyPriority(todos.filter((t) => t.status !== "done"));
    if (!includeDone) return sortByTime(open);
    const done = drop.applyPriority(
      completed.filter((t) => t.status === "done"),
    );
    return sortByTime([...open, ...done]);
  }, [todos, completed, drop, includeDone]);

  const columns = useMemo(() => {
    return NOTEBOOK_QUADRANT_ORDER.map((key) => {
      const items = listed.filter(
        (t) =>
          todoQuadrant(t, Date.now(), {
            includeDone: t.status === "done",
          }) === key,
      );
      const openCount = items.filter((t) => t.status !== "done").length;
      const doneInQuadrant = includeDone
        ? items.filter((t) => t.status === "done").length
        : completed.filter(
            (t) =>
              t.status === "done" &&
              todoQuadrant(t, Date.now(), { includeDone: true }) === key,
          ).length;
      return {
        key,
        ...NOTEBOOK_QUADRANT_META[key],
        items,
        openCount,
        doneCount: doneInQuadrant,
      };
    });
  }, [listed, completed, includeDone]);

  const createSpaceId = defaultSpaceId || spaces[0]?.id;

  return (
    <div className="flex flex-col gap-3">
      {hideTitle ? null : (
        <h2 className="text-sm font-medium text-zinc-800">{title}</h2>
      )}
      {drop.dropError ? (
        <p className="text-xs text-red-600">{drop.dropError}</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {columns.map((col) => (
          <NotebookQuadrant
            key={col.key}
            title={col.title}
            openCount={col.openCount}
            doneCount={col.doneCount}
            emptyHint={col.emptyHint}
            isEmpty={col.items.length === 0}
            dragOver={drop.dragOverKey === col.key}
            onCreate={
              createSpaceId
                ? () =>
                    setCreateFor({
                      priority: isImportantKey(col.key) ? "high" : "low",
                    })
                : undefined
            }
            onDragOver={(e) => drop.onDragOverQuadrant(e, col.key)}
            onDragLeave={drop.onDragLeaveQuadrant}
            onDrop={(e) => void drop.onDropQuadrant(e, col.key)}
          >
            {col.items.map((t) => (
              <CompactTodoCard
                key={t.id}
                todo={t}
                variant="card"
                layout="stack"
                showComplete
                importanceDrag
                onToggleImportance={() => void drop.toggleImportance(t)}
                conflicted={conflictIds.has(t.id)}
                onOpen={() => {
                  setScheduleHint(false);
                  setSelected(t);
                }}
              />
            ))}
          </NotebookQuadrant>
        ))}
      </div>

      {selected ? (
        <TodoEditor
          todo={selected}
          members={members}
          canAssign={canAssign}
          open
          hintMessage={scheduleHint ? SCHEDULE_HINT : undefined}
          onClose={() => {
            setSelected(null);
            setScheduleHint(false);
          }}
        />
      ) : null}

      {createFor && createSpaceId && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]">
              <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-xl">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900">
                    新建待办
                  </h2>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-sm text-zinc-500"
                    onClick={() => setCreateFor(null)}
                  >
                    关闭
                  </button>
                </div>
                <QuickCreateTodo
                  key={`${createSpaceId}-${createFor.priority}`}
                  spaces={spaces}
                  defaultSpaceId={createSpaceId}
                  members={members}
                  canAssign={canAssign}
                  initialPriority={createFor.priority}
                  bare
                  onCreated={() => setCreateFor(null)}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

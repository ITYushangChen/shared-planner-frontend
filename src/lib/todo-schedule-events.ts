import type { TodoRow } from "@/lib/todos";

/** 日历 ↔ 未排期本地同步（不依赖 router.refresh） */
export const TODO_UNSCHEDULED = "sharetodo:todo-unscheduled";
export const TODO_SCHEDULED = "sharetodo:todo-scheduled";
/** 新建 / 更新后立刻出现在列表与日历 */
export const TODO_UPSERTED = "sharetodo:todo-upserted";
/** 删除后立刻从列表与日历消失 */
export const TODO_DELETED = "sharetodo:todo-deleted";

export type TodoUnscheduledDetail = { todo: TodoRow };
export type TodoScheduledDetail = { todoId: string };
export type TodoUpsertedDetail = { todo: TodoRow };
export type TodoDeletedDetail = { todoId: string };

export function emitTodoUnscheduled(todo: TodoRow) {
  if (typeof window === "undefined") return;
  const payload: TodoRow = {
    ...todo,
    start_at: null,
    end_at: null,
    is_all_day: false,
  };
  window.dispatchEvent(
    new CustomEvent(TODO_UNSCHEDULED, {
      detail: { todo: payload } satisfies TodoUnscheduledDetail,
    }),
  );
}

export function emitTodoScheduled(todoId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TODO_SCHEDULED, {
      detail: { todoId } satisfies TodoScheduledDetail,
    }),
  );
}

export function emitTodoUpserted(todo: TodoRow) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TODO_UPSERTED, {
      detail: { todo } satisfies TodoUpsertedDetail,
    }),
  );
}

export function emitTodoDeleted(todoId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TODO_DELETED, {
      detail: { todoId } satisfies TodoDeletedDetail,
    }),
  );
}

export function applyTodoUpsert(list: TodoRow[], todo: TodoRow): TodoRow[] {
  const i = list.findIndex((t) => t.id === todo.id);
  if (i >= 0) {
    const next = list.slice();
    next[i] = { ...list[i], ...todo };
    return next;
  }
  return [todo, ...list];
}

export function applyTodoDelete(list: TodoRow[], todoId: string): TodoRow[] {
  return list.filter((t) => t.id !== todoId);
}

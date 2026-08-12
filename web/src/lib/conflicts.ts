import type { TodoRow } from "@/lib/todos";

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
) {
  return aStart < bEnd && aEnd > bStart;
}

function assigneeKeys(todo: TodoRow): string[] {
  const ids = (todo.todo_assignees ?? []).map((x) => x.user_id);
  if (ids.length > 0) return ids;
  // 无指派时按创建人时间轴检测，避免漏标红
  if (todo.creator_id) return [todo.creator_id];
  return [`space:${todo.space_id}`];
}

/** 同一指派人（或创建人）时段重叠的待办 id；含全天事件按日重叠 */
export function findConflictTodoIds(todos: TodoRow[]): Set<string> {
  const scheduled = todos.filter(
    (t) => t.start_at && t.status !== "done",
  );
  const conflicted = new Set<string>();

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i];
      const b = scheduled[j];
      // 总览需跨空间监测：同一指派人在任意空间时段重叠都算冲突

      const aStart = new Date(a.start_at!).getTime();
      const aEnd = new Date(
        a.end_at || new Date(aStart + 60 * 60 * 1000).toISOString(),
      ).getTime();
      const bStart = new Date(b.start_at!).getTime();
      const bEnd = new Date(
        b.end_at || new Date(bStart + 60 * 60 * 1000).toISOString(),
      ).getTime();

      if (!rangesOverlap(aStart, aEnd, bStart, bEnd)) continue;

      const aUsers = new Set(assigneeKeys(a));
      const share = assigneeKeys(b).some((id) => aUsers.has(id));
      if (share) {
        conflicted.add(a.id);
        conflicted.add(b.id);
      }
    }
  }
  return conflicted;
}

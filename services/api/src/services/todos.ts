import type { SupabaseClient } from "@supabase/supabase-js";

export type Priority = "high" | "medium" | "low";
export type TodoStatus = "todo" | "in_progress" | "done";

export type ParsedTodo = {
  title: string;
  description?: string | null;
  priority?: Priority;
  assignee_names?: string[];
  start_at?: string | null;
  end_at?: string | null;
  due_at?: string | null;
  is_all_day?: boolean;
};

export type TodoPreview = ParsedTodo & {
  assignee_ids: string[];
};

export async function insertTodosWithAssignees(params: {
  admin: SupabaseClient;
  spaceId: string;
  creatorId: string;
  conversationId?: string | null;
  items: TodoPreview[];
}): Promise<string[]> {
  const todoIds: string[] = [];

  for (const item of params.items) {
    const { data: todo, error } = await params.admin
      .from("todos")
      .insert({
        space_id: params.spaceId,
        creator_id: params.creatorId,
        title: item.title,
        description: item.description ?? null,
        priority: item.priority || "medium",
        status: "todo" as TodoStatus,
        start_at: item.start_at || null,
        end_at: item.end_at || null,
        due_at: item.due_at || null,
        is_all_day: Boolean(item.is_all_day),
        source: "ai",
      })
      .select("id")
      .single();

    if (error || !todo) throw new Error(error?.message || "Failed to insert todo");
    todoIds.push(todo.id);

    const assignees = [...new Set(item.assignee_ids)];
    if (assignees.length > 0) {
      const { error: aerr } = await params.admin.from("todo_assignees").insert(
        assignees.map((user_id) => ({
          todo_id: todo.id,
          user_id,
        })),
      );
      if (aerr) throw new Error(aerr.message);
    }
  }

  const { error: actionError } = await params.admin.from("ai_actions").insert({
    conversation_id: params.conversationId || null,
    space_id: params.spaceId,
    user_id: params.creatorId,
    action_type: "create_todo",
    payload: { items: params.items },
    result_todo_ids: todoIds,
    status: "applied",
  });
  if (actionError) throw new Error(actionError.message);

  return todoIds;
}

export async function checkConflicts(params: {
  admin: SupabaseClient;
  spaceId: string;
  userId: string;
  startAt: string;
  endAt: string;
  excludeTodoId?: string | null;
}) {
  const { data, error } = await params.admin.rpc("check_schedule_conflicts", {
    p_space_id: params.spaceId,
    p_user_id: params.userId,
    p_start_at: params.startAt,
    p_end_at: params.endAt,
    p_exclude_todo_id: params.excludeTodoId ?? null,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export function priorityWeight(p: Priority | string | null | undefined): number {
  if (p === "high") return 3;
  if (p === "low") return 1;
  return 2;
}

export function computeSortScore(todo: {
  priority?: string | null;
  due_at?: string | null;
  start_at?: string | null;
  status?: string | null;
}): number {
  if (todo.status === "done") return -1;
  const now = Date.now();
  let score = priorityWeight(todo.priority) * 1000;

  const due = todo.due_at ? Date.parse(todo.due_at) : NaN;
  if (!Number.isNaN(due)) {
    const hours = (due - now) / 36e5;
    score += Math.max(0, 500 - hours);
  }

  if (!todo.start_at) score += 50; // unscheduled slightly higher urgency to schedule
  return Math.round(score * 100) / 100;
}

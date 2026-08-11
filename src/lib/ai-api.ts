import { createClient } from "@/lib/supabase/client";

export function getApiBaseUrl() {
  let base = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/$/, "");
  if (!base) return "";
  // 漏写协议时浏览器会当成相对路径 → 404；自动补全 https
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }
  return base;
}

export class AiApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function authHeaders() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new AiApiError("请先登录", 401);
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function aiFetch<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new AiApiError(
      "未配置 NEXT_PUBLIC_API_URL，请在 .env.local 填写后端地址",
      0,
    );
  }

  const headers = await authHeaders();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errObj = data as { error?: string } | null;
    throw new AiApiError(
      errObj?.error || `请求失败（${res.status}）`,
      res.status,
    );
  }

  return data as T;
}

export type AiTodoPreview = {
  title: string;
  description?: string | null;
  priority: "high" | "medium" | "low";
  assignee_names?: string[];
  assignee_ids?: string[];
  start_at?: string | null;
  end_at?: string | null;
  due_at?: string | null;
  is_all_day?: boolean;
};

export type CreateTodosPreview = {
  preview: true;
  summary: string | null;
  todos: AiTodoPreview[];
};

export type CreateTodosResult = {
  preview: false;
  summary: string | null;
  todo_ids: string[];
  todos: AiTodoPreview[];
};

export type ScheduleSuggestion = {
  todo_id: string;
  title: string;
  start_at: string;
  end_at: string;
  reason?: string;
};

export type SchedulePreview = {
  preview: true;
  suggestions: ScheduleSuggestion[];
  message?: string;
};

export type ScheduleResult = {
  preview: false;
  applied: string[];
  suggestions: ScheduleSuggestion[];
};

export type ConflictMove = {
  todo_id: string;
  title: string;
  from_start_at: string;
  from_end_at: string;
  to_start_at: string;
  to_end_at: string;
  reason: string;
};

export type ConflictPreview = {
  preview: true;
  conflicts: Array<{ a: string; b: string }>;
  suggestions: ConflictMove[];
  message?: string;
};

export type ConflictResult = {
  preview: false;
  conflicts: Array<{ a: string; b: string }>;
  suggestions: ConflictMove[];
  applied: string[];
};

export type ReorderResult = {
  todos: Array<{
    id: string;
    title: string;
    priority: string;
    status: string;
    due_at: string | null;
    start_at: string | null;
    sort_score: number;
  }>;
};

export type DailySummaryResult = {
  notification_id: string;
  date: string;
  summary: string;
  today_count: number;
};

export function createTodos(params: {
  space_id: string;
  text: string;
  confirm?: boolean;
  timezone?: string;
}) {
  return aiFetch<CreateTodosPreview | CreateTodosResult>("/ai/create-todos", {
    space_id: params.space_id,
    text: params.text,
    confirm: params.confirm ?? false,
    timezone: params.timezone || "Asia/Shanghai",
  });
}

export function scheduleTodos(params: {
  space_id?: string;
  all_spaces?: boolean;
  text?: string;
  confirm?: boolean;
  timezone?: string;
}) {
  return aiFetch<
    SchedulePreview | ScheduleResult | { suggestions: []; message: string }
  >("/ai/schedule", {
    ...(params.all_spaces
      ? { all_spaces: true }
      : { space_id: params.space_id }),
    text: params.text,
    confirm: params.confirm ?? false,
    timezone: params.timezone || "Asia/Shanghai",
  });
}

export function conflictSuggest(params: {
  space_id?: string;
  all_spaces?: boolean;
  confirm?: boolean;
  user_id?: string;
}) {
  return aiFetch<
    | ConflictPreview
    | ConflictResult
    | { conflicts: []; suggestions: []; message: string }
  >("/ai/conflict-suggest", {
    ...(params.all_spaces
      ? { all_spaces: true }
      : { space_id: params.space_id }),
    confirm: params.confirm ?? false,
    user_id: params.user_id,
  });
}

export function reorderTodos(params: {
  space_id?: string;
  all_spaces?: boolean;
  persist?: boolean;
}) {
  return aiFetch<ReorderResult>("/ai/reorder", {
    ...(params.all_spaces
      ? { all_spaces: true }
      : { space_id: params.space_id }),
    persist: params.persist ?? true,
  });
}

export function dailySummary(params: {
  space_id?: string;
  timezone?: string;
}) {
  return aiFetch<DailySummaryResult>("/ai/daily-summary", {
    space_id: params.space_id,
    timezone: params.timezone || "Asia/Shanghai",
  });
}

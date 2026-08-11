/**
 * 空间日历数据内存缓存：切空间先画缓存、hover 预拉、请求去重。
 */
import { createClient } from "@/lib/supabase/client";
import {
  TODO_SELECT_LEAN,
  isAssignedToUser,
  type SpaceMemberOption,
  type TodoRow,
} from "@/lib/todos";

const SCHEDULED_LIMIT = 80;
const UNSCHEDULED_LIMIT = 40;
const COMPLETED_LIMIT = 80;

export type SpaceTodosCache = {
  scheduled: TodoRow[];
  unscheduled: TodoRow[];
};

export type SpaceMemberRow = {
  user_id: string;
  role: string;
  display_name: string;
  email: string | null;
};

export type SpaceMembersCache = {
  options: SpaceMemberOption[];
  rows: SpaceMemberRow[];
};

const todosCache = new Map<string, SpaceTodosCache>();
const completedCache = new Map<string, TodoRow[]>();
const membersCache = new Map<string, SpaceMembersCache>();
const todosInflight = new Map<string, Promise<SpaceTodosCache>>();
const completedInflight = new Map<string, Promise<TodoRow[]>>();
const membersInflight = new Map<string, Promise<SpaceMembersCache>>();

export function getCachedSpaceTodos(spaceId: string): SpaceTodosCache | null {
  return todosCache.get(spaceId) ?? null;
}

export function setCachedSpaceTodos(spaceId: string, data: SpaceTodosCache) {
  todosCache.set(spaceId, data);
}

export function getCachedSpaceMembers(
  spaceId: string,
): SpaceMembersCache | null {
  return membersCache.get(spaceId) ?? null;
}

export function setCachedSpaceMembers(
  spaceId: string,
  data: SpaceMembersCache,
) {
  membersCache.set(spaceId, data);
}

export function filterTodosForViewer(
  data: SpaceTodosCache,
  canAssign: boolean,
  currentUserId?: string,
): SpaceTodosCache {
  if (canAssign || !currentUserId) return data;
  return {
    scheduled: data.scheduled.filter((t) =>
      isAssignedToUser(t, currentUserId),
    ),
    unscheduled: data.unscheduled.filter((t) =>
      isAssignedToUser(t, currentUserId),
    ),
  };
}

function ensureTodosFetch(spaceId: string): Promise<SpaceTodosCache> {
  const existing = todosInflight.get(spaceId);
  if (existing) return existing;

  const promise = (async () => {
    const supabase = createClient();
    const [scheduledRes, unscheduledRes] = await Promise.all([
      supabase
        .from("todos")
        .select(TODO_SELECT_LEAN)
        .eq("space_id", spaceId)
        .neq("status", "done")
        .not("start_at", "is", null)
        .order("start_at", { ascending: true })
        .limit(SCHEDULED_LIMIT),
      supabase
        .from("todos")
        .select(TODO_SELECT_LEAN)
        .eq("space_id", spaceId)
        .neq("status", "done")
        .is("start_at", null)
        .order("created_at", { ascending: false })
        .limit(UNSCHEDULED_LIMIT),
    ]);
    const data: SpaceTodosCache = {
      scheduled: (scheduledRes.data ?? []) as unknown as TodoRow[],
      unscheduled: (unscheduledRes.data ?? []) as unknown as TodoRow[],
    };
    todosCache.set(spaceId, data);
    return data;
  })().finally(() => {
    todosInflight.delete(spaceId);
  });

  todosInflight.set(spaceId, promise);
  return promise;
}

/**
 * 拉取日历待办。有缓存则立刻 onData，并后台刷新后再 onData。
 * onScheduled：scheduled 就绪时先回调（无缓存的首次请求会与 onData 同批）。
 */
export function loadSpaceCalendarTodos(
  spaceId: string,
  opts?: {
    onScheduled?: (scheduled: TodoRow[]) => void;
    onData?: (data: SpaceTodosCache) => void;
  },
): Promise<SpaceTodosCache> {
  const cached = todosCache.get(spaceId);
  if (cached) {
    opts?.onScheduled?.(cached.scheduled);
    opts?.onData?.(cached);
    return ensureTodosFetch(spaceId).then((fresh) => {
      opts?.onScheduled?.(fresh.scheduled);
      opts?.onData?.(fresh);
      return fresh;
    });
  }

  return ensureTodosFetch(spaceId).then((data) => {
    opts?.onScheduled?.(data.scheduled);
    opts?.onData?.(data);
    return data;
  });
}

/** 分阶段：先等 scheduled 再等完整结果（无缓存时日历主区更早有块） */
export async function loadSpaceCalendarTodosStaged(
  spaceId: string,
  opts?: {
    onScheduled?: (scheduled: TodoRow[]) => void;
    onData?: (data: SpaceTodosCache) => void;
  },
): Promise<SpaceTodosCache> {
  const cached = todosCache.get(spaceId);
  if (cached) {
    opts?.onScheduled?.(cached.scheduled);
    opts?.onData?.(cached);
    const fresh = await ensureTodosFetch(spaceId);
    opts?.onScheduled?.(fresh.scheduled);
    opts?.onData?.(fresh);
    return fresh;
  }

  const inflight = todosInflight.get(spaceId);
  if (inflight) {
    const data = await inflight;
    opts?.onScheduled?.(data.scheduled);
    opts?.onData?.(data);
    return data;
  }

  const supabase = createClient();
  const scheduledPromise = supabase
    .from("todos")
    .select(TODO_SELECT_LEAN)
    .eq("space_id", spaceId)
    .neq("status", "done")
    .not("start_at", "is", null)
    .order("start_at", { ascending: true })
    .limit(SCHEDULED_LIMIT);

  const unscheduledPromise = supabase
    .from("todos")
    .select(TODO_SELECT_LEAN)
    .eq("space_id", spaceId)
    .neq("status", "done")
    .is("start_at", null)
    .order("created_at", { ascending: false })
    .limit(UNSCHEDULED_LIMIT);

  const promise = (async () => {
    const scheduledRes = await scheduledPromise;
    const scheduled = (scheduledRes.data ?? []) as unknown as TodoRow[];
    // 先写入部分缓存，切走再回来也有主区数据
    const partial = todosCache.get(spaceId);
    todosCache.set(spaceId, {
      scheduled,
      unscheduled: partial?.unscheduled ?? [],
    });
    opts?.onScheduled?.(scheduled);

    const unscheduledRes = await unscheduledPromise;
    const data: SpaceTodosCache = {
      scheduled,
      unscheduled: (unscheduledRes.data ?? []) as unknown as TodoRow[],
    };
    todosCache.set(spaceId, data);
    opts?.onData?.(data);
    return data;
  })().finally(() => {
    todosInflight.delete(spaceId);
  });

  todosInflight.set(spaceId, promise);
  return promise;
}

/** hover / 侧栏预取，不阻塞 UI */
export function prefetchSpaceCalendarTodos(spaceId: string) {
  if (todosCache.has(spaceId) || todosInflight.has(spaceId)) return;
  void ensureTodosFetch(spaceId);
}

function ensureMembersFetch(spaceId: string): Promise<SpaceMembersCache> {
  const existing = membersInflight.get(spaceId);
  if (existing) return existing;

  const promise = (async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("space_members")
      .select("user_id, role, profiles(display_name, email)")
      .eq("space_id", spaceId);

    const options: SpaceMemberOption[] = [];
    const rows: SpaceMemberRow[] = [];
    for (const m of data ?? []) {
      const raw = m.profiles as unknown;
      const profile = (
        Array.isArray(raw) ? raw[0] : raw
      ) as { display_name: string; email: string | null } | null;
      const display_name = profile?.display_name ?? "成员";
      const email = profile?.email ?? null;
      options.push({
        user_id: m.user_id as string,
        display_name,
        email,
      });
      rows.push({
        user_id: m.user_id as string,
        role: m.role as string,
        display_name,
        email,
      });
    }
    const entry = { options, rows };
    membersCache.set(spaceId, entry);
    return entry;
  })().finally(() => {
    membersInflight.delete(spaceId);
  });

  membersInflight.set(spaceId, promise);
  return promise;
}

export function loadSpaceMembers(
  spaceId: string,
  opts?: { onData?: (data: SpaceMembersCache) => void },
): Promise<SpaceMembersCache> {
  const cached = membersCache.get(spaceId);
  if (cached) {
    opts?.onData?.(cached);
    return ensureMembersFetch(spaceId).then((fresh) => {
      opts?.onData?.(fresh);
      return fresh;
    });
  }
  return ensureMembersFetch(spaceId).then((data) => {
    opts?.onData?.(data);
    return data;
  });
}

export function prefetchSpaceMembers(spaceId: string) {
  if (membersCache.has(spaceId) || membersInflight.has(spaceId)) return;
  void ensureMembersFetch(spaceId);
}

/** 本地变更后同步缓存，避免切回旧数据 */
export function patchCachedSpaceTodo(spaceId: string, todo: TodoRow) {
  const cur = todosCache.get(spaceId);
  if (!cur) return;
  const drop = (list: TodoRow[]) => list.filter((t) => t.id !== todo.id);
  if (todo.start_at) {
    const rest = drop(cur.scheduled);
    todosCache.set(spaceId, {
      scheduled: [todo, ...rest].sort((a, b) =>
        (a.start_at ?? "").localeCompare(b.start_at ?? ""),
      ),
      unscheduled: drop(cur.unscheduled),
    });
  } else {
    todosCache.set(spaceId, {
      scheduled: drop(cur.scheduled),
      unscheduled: [todo, ...drop(cur.unscheduled)],
    });
  }
}

export function removeCachedSpaceTodo(spaceId: string, todoId: string) {
  const cur = todosCache.get(spaceId);
  if (!cur) return;
  todosCache.set(spaceId, {
    scheduled: cur.scheduled.filter((t) => t.id !== todoId),
    unscheduled: cur.unscheduled.filter((t) => t.id !== todoId),
  });
  const done = completedCache.get(spaceId);
  if (done) {
    completedCache.set(
      spaceId,
      done.filter((t) => t.id !== todoId),
    );
  }
}

export function getCachedSpaceCompleted(spaceId: string): TodoRow[] | null {
  return completedCache.get(spaceId) ?? null;
}

export function setCachedSpaceCompleted(spaceId: string, rows: TodoRow[]) {
  completedCache.set(spaceId, rows);
}

function ensureCompletedFetch(spaceId: string): Promise<TodoRow[]> {
  const existing = completedInflight.get(spaceId);
  if (existing) return existing;

  const promise = (async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("todos")
      .select(TODO_SELECT_LEAN)
      .eq("space_id", spaceId)
      .eq("status", "done")
      .order("completed_at", { ascending: false })
      .limit(COMPLETED_LIMIT);
    const rows = (data ?? []) as unknown as TodoRow[];
    completedCache.set(spaceId, rows);
    return rows;
  })().finally(() => {
    completedInflight.delete(spaceId);
  });

  completedInflight.set(spaceId, promise);
  return promise;
}

/** 任务总览 / 列表用：已完成（lean），有缓存先返回再后台刷新 */
export function loadSpaceCompletedTodos(
  spaceId: string,
  opts?: { onData?: (rows: TodoRow[]) => void },
): Promise<TodoRow[]> {
  const cached = completedCache.get(spaceId);
  if (cached) {
    opts?.onData?.(cached);
    return ensureCompletedFetch(spaceId).then((fresh) => {
      opts?.onData?.(fresh);
      return fresh;
    });
  }
  return ensureCompletedFetch(spaceId).then((rows) => {
    opts?.onData?.(rows);
    return rows;
  });
}

export function filterCompletedForViewer(
  rows: TodoRow[],
  canAssign: boolean,
  currentUserId?: string,
): TodoRow[] {
  if (canAssign || !currentUserId) return rows;
  return rows.filter((t) => isAssignedToUser(t, currentUserId));
}

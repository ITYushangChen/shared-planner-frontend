"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  filterCompletedForViewer,
  filterTodosForViewer,
  getCachedSpaceCompleted,
  getCachedSpaceTodos,
  loadSpaceCalendarTodosStaged,
  loadSpaceCompletedTodos,
  patchCachedSpaceTodo,
  removeCachedSpaceTodo,
  setCachedSpaceCompleted,
  setCachedSpaceTodos,
} from "@/lib/space-data-cache";
import {
  TODO_DELETED,
  TODO_SCHEDULED,
  TODO_UNSCHEDULED,
  TODO_UPSERTED,
  applyTodoDelete,
  applyTodoUpsert,
  type TodoDeletedDetail,
  type TodoScheduledDetail,
  type TodoUnscheduledDetail,
  type TodoUpsertedDetail,
} from "@/lib/todo-schedule-events";
import {
  getOverviewBounds,
  isAssignedToUser,
  todoOverlapsRange,
  type OverviewRange,
  type SpaceMemberOption,
  type SpaceNavItem,
  type TodoRow,
} from "@/lib/todos";
const TodoListPanel = dynamic(
  () =>
    import("./todo-list-panel").then((m) => ({ default: m.TodoListPanel })),
  { loading: () => null },
);
const TodosCalendar = dynamic(
  () =>
    import("./todos-calendar").then((m) => ({ default: m.TodosCalendar })),
  { ssr: false, loading: () => <div className="min-h-[420px]" aria-busy /> },
);

type Props = {
  space: SpaceNavItem;
  todos: TodoRow[];
  allTodos: TodoRow[];
  scheduled: TodoRow[];
  unscheduled: TodoRow[];
  completed?: TodoRow[];
  members: SpaceMemberOption[];
  canAssign: boolean;
  currentUserId?: string;
  listTitle?: string;
  /** 壳先出，客户端补拉待办（FAST_SPACE_NAV） */
  deferTodos?: boolean;
  /** 成员客户端补（与 chrome 同步；chrome 会 clone 注入 members） */
  deferMembers?: boolean;
};

type SpaceView = "boards" | "calendar" | "list";

function parseSpaceView(raw: string | null): SpaceView {
  if (raw === "boards" || raw === "list") return raw;
  return "calendar";
}

function parseRange(raw: string | null): OverviewRange | "all" {
  if (raw === "day" || raw === "month" || raw === "week") return raw;
  if (raw === "all") return "all";
  return "week";
}

/** 与总览同一套：四象限(含已完成) / 日历 / 四象限待办(仅未完成) */
export function SpaceWorkspace({
  space,
  todos: todosProp,
  scheduled: scheduledProp,
  unscheduled: unscheduledProp,
  completed: completedProp = [],
  members,
  canAssign,
  currentUserId,
  deferTodos = false,
}: Props) {
  const searchParams = useSearchParams();
  const view = parseSpaceView(searchParams.get("view"));
  const range = parseRange(searchParams.get("range"));
  const assigneeId = searchParams.get("assignee") || "";
  const [unscheduledLocal, setUnscheduledLocal] =
    useState<TodoRow[]>(unscheduledProp);
  const [scheduledLocal, setScheduledLocal] = useState(scheduledProp);
  const [todosLocal, setTodosLocal] = useState(todosProp);
  const [completedLocal, setCompletedLocal] = useState(completedProp);
  const [removedIds, setRemovedIds] = useState(() => new Set<string>());
  const spaceIdRef = useRef(space.id);

  useEffect(() => {
    if (unscheduledProp.length === 0 && deferTodos) return;
    setUnscheduledLocal(unscheduledProp);
  }, [unscheduledProp, deferTodos]);

  useEffect(() => {
    if (scheduledProp.length === 0 && deferTodos) return;
    setScheduledLocal(scheduledProp);
  }, [scheduledProp, deferTodos]);

  useEffect(() => {
    if (todosProp.length === 0 && deferTodos) return;
    setTodosLocal(todosProp);
  }, [todosProp, deferTodos]);

  useEffect(() => {
    if (completedProp.length === 0 && deferTodos) return;
    setCompletedLocal(completedProp);
  }, [completedProp, deferTodos]);

  // SSR 有数据时写入缓存，便于之后软切回来秒开
  useEffect(() => {
    if (deferTodos) return;
    if (scheduledProp.length === 0 && unscheduledProp.length === 0) return;
    setCachedSpaceTodos(space.id, {
      scheduled: scheduledProp,
      unscheduled: unscheduledProp,
    });
  }, [deferTodos, space.id, scheduledProp, unscheduledProp]);

  useEffect(() => {
    if (deferTodos) return;
    if (completedProp.length === 0) return;
    setCachedSpaceCompleted(space.id, completedProp);
  }, [deferTodos, space.id, completedProp]);

  // FAST_SPACE_NAV：三视图共用活跃待办缓存；有缓存先画再刷新
  useEffect(() => {
    spaceIdRef.current = space.id;
    if (!deferTodos) return;

    const cached = getCachedSpaceTodos(space.id);
    if (cached) {
      const filtered = filterTodosForViewer(
        cached,
        canAssign,
        currentUserId,
      );
      setScheduledLocal(filtered.scheduled);
      setUnscheduledLocal(filtered.unscheduled);
      setTodosLocal([...filtered.scheduled, ...filtered.unscheduled]);
    } else {
      setScheduledLocal([]);
      setUnscheduledLocal([]);
      setTodosLocal([]);
    }

    let cancelled = false;
    void loadSpaceCalendarTodosStaged(space.id, {
      onScheduled: (scheduled) => {
        if (cancelled || spaceIdRef.current !== space.id) return;
        const filtered = filterTodosForViewer(
          {
            scheduled,
            unscheduled: getCachedSpaceTodos(space.id)?.unscheduled ?? [],
          },
          canAssign,
          currentUserId,
        );
        setScheduledLocal(filtered.scheduled);
        setTodosLocal([...filtered.scheduled, ...filtered.unscheduled]);
      },
      onData: (data) => {
        if (cancelled || spaceIdRef.current !== space.id) return;
        const filtered = filterTodosForViewer(
          data,
          canAssign,
          currentUserId,
        );
        setScheduledLocal(filtered.scheduled);
        setUnscheduledLocal(filtered.unscheduled);
        setTodosLocal([...filtered.scheduled, ...filtered.unscheduled]);
      },
    });

    return () => {
      cancelled = true;
    };
  }, [deferTodos, space.id, canAssign, currentUserId]);

  // 任务总览 / 列表需要已完成；日历不拉
  useEffect(() => {
    if (!deferTodos) return;
    if (view !== "boards" && view !== "list") return;

    const cached = getCachedSpaceCompleted(space.id);
    if (cached) {
      setCompletedLocal(
        filterCompletedForViewer(cached, canAssign, currentUserId),
      );
    } else {
      setCompletedLocal([]);
    }

    let cancelled = false;
    void loadSpaceCompletedTodos(space.id, {
      onData: (rows) => {
        if (cancelled || spaceIdRef.current !== space.id) return;
        setCompletedLocal(
          filterCompletedForViewer(rows, canAssign, currentUserId),
        );
      },
    });

    return () => {
      cancelled = true;
    };
  }, [deferTodos, view, space.id, canAssign, currentUserId]);

  useEffect(() => {
    function onUnscheduled(ev: Event) {
      const todo = (ev as CustomEvent<TodoUnscheduledDetail>).detail?.todo;
      if (!todo?.id || todo.space_id !== space.id) return;
      patchCachedSpaceTodo(space.id, todo);
      setRemovedIds((prev) => {
        if (!prev.has(todo.id)) return prev;
        const next = new Set(prev);
        next.delete(todo.id);
        return next;
      });
      setUnscheduledLocal((prev) => applyTodoUpsert(prev, todo));
      setScheduledLocal((prev) => applyTodoDelete(prev, todo.id));
      setTodosLocal((prev) => applyTodoUpsert(prev, todo));
    }
    function onScheduled(ev: Event) {
      const todoId = (ev as CustomEvent<TodoScheduledDetail>).detail?.todoId;
      if (!todoId) return;
      setUnscheduledLocal((prev) => applyTodoDelete(prev, todoId));
    }
    function onUpsert(ev: Event) {
      const todo = (ev as CustomEvent<TodoUpsertedDetail>).detail?.todo;
      if (!todo?.id || todo.space_id !== space.id) return;
      setRemovedIds((prev) => {
        if (!prev.has(todo.id)) return prev;
        const next = new Set(prev);
        next.delete(todo.id);
        return next;
      });
      if (todo.status === "done") {
        removeCachedSpaceTodo(space.id, todo.id);
        setCompletedLocal((prev) => applyTodoUpsert(prev, todo));
        setTodosLocal((prev) => applyTodoDelete(prev, todo.id));
        setScheduledLocal((prev) => applyTodoDelete(prev, todo.id));
        setUnscheduledLocal((prev) => applyTodoDelete(prev, todo.id));
        const done = getCachedSpaceCompleted(space.id) ?? [];
        setCachedSpaceCompleted(
          space.id,
          applyTodoUpsert(done, todo),
        );
        return;
      }
      patchCachedSpaceTodo(space.id, todo);
      setCompletedLocal((prev) => applyTodoDelete(prev, todo.id));
      setTodosLocal((prev) => applyTodoUpsert(prev, todo));
      if (todo.start_at) {
        setScheduledLocal((prev) => applyTodoUpsert(prev, todo));
        setUnscheduledLocal((prev) => applyTodoDelete(prev, todo.id));
      } else {
        setUnscheduledLocal((prev) => applyTodoUpsert(prev, todo));
        setScheduledLocal((prev) => applyTodoDelete(prev, todo.id));
      }
    }
    function onDeleted(ev: Event) {
      const todoId = (ev as CustomEvent<TodoDeletedDetail>).detail?.todoId;
      if (!todoId) return;
      removeCachedSpaceTodo(space.id, todoId);
      setRemovedIds((prev) => new Set(prev).add(todoId));
      setUnscheduledLocal((prev) => applyTodoDelete(prev, todoId));
      setScheduledLocal((prev) => applyTodoDelete(prev, todoId));
      setTodosLocal((prev) => applyTodoDelete(prev, todoId));
      setCompletedLocal((prev) => applyTodoDelete(prev, todoId));
    }
    window.addEventListener(TODO_UNSCHEDULED, onUnscheduled);
    window.addEventListener(TODO_SCHEDULED, onScheduled);
    window.addEventListener(TODO_UPSERTED, onUpsert);
    window.addEventListener(TODO_DELETED, onDeleted);
    return () => {
      window.removeEventListener(TODO_UNSCHEDULED, onUnscheduled);
      window.removeEventListener(TODO_SCHEDULED, onScheduled);
      window.removeEventListener(TODO_UPSERTED, onUpsert);
      window.removeEventListener(TODO_DELETED, onDeleted);
    };
  }, [space.id]);

  const unscheduled = useMemo(
    () => unscheduledLocal.filter((t) => !removedIds.has(t.id)),
    [unscheduledLocal, removedIds],
  );
  const scheduled = useMemo(
    () => scheduledLocal.filter((t) => !removedIds.has(t.id)),
    [scheduledLocal, removedIds],
  );
  const todos = useMemo(
    () => todosLocal.filter((t) => !removedIds.has(t.id)),
    [todosLocal, removedIds],
  );

  const filterAssignee = useMemo(() => {
    if (!assigneeId) {
      return <T extends TodoRow>(list: T[]) => list;
    }
    return <T extends TodoRow>(list: T[]) =>
      list.filter((t) => isAssignedToUser(t, assigneeId));
  }, [assigneeId]);

  const filteredTodos = useMemo(
    () => filterAssignee(todos),
    [todos, filterAssignee],
  );
  const filteredScheduled = useMemo(
    () => filterAssignee(scheduled),
    [scheduled, filterAssignee],
  );
  const filteredUnscheduled = useMemo(
    () => filterAssignee(unscheduled),
    [unscheduled, filterAssignee],
  );
  const completed = useMemo(
    () => completedLocal.filter((t) => !removedIds.has(t.id)),
    [completedLocal, removedIds],
  );

  const filteredCompleted = useMemo(
    () => filterAssignee(completed),
    [completed, filterAssignee],
  );

  const boardsOpen = useMemo(() => {
    if (range === "all") return filteredTodos;
    const { start, end } = getOverviewBounds(range);
    return filteredTodos.filter((t) => todoOverlapsRange(t, start, end));
  }, [filteredTodos, range]);

  const boardsDone = useMemo(() => {
    if (range === "all") return filteredCompleted;
    const { start, end } = getOverviewBounds(range);
    return filteredCompleted.filter((t) => todoOverlapsRange(t, start, end));
  }, [filteredCompleted, range]);

  return (
    <div
      className={[
        "flex flex-col",
        view === "calendar" ? "gap-0 md:gap-4" : "gap-4",
      ].join(" ")}
    >
      {view === "boards" ? (
        <TodoListPanel
          todos={boardsOpen.filter((t) => t.start_at)}
          completed={boardsDone.filter((t) => t.start_at)}
          unscheduledTodos={filteredUnscheduled}
          members={members}
          canAssign={canAssign}
          hideTitle
          spaces={[space]}
          defaultSpaceId={space.id}
          includeDone
        />
      ) : null}

      {view === "calendar" ? (
        <TodosCalendar
          todos={filteredScheduled}
          spaces={[space]}
          defaultSpaceId={space.id}
          members={members}
          canAssign={canAssign}
          hideTitle
          mobileDateChrome
          viewRange={range === "all" ? "week" : range}
        />
      ) : null}

      {view === "list" ? (
        <TodoListPanel
          todos={boardsOpen.filter((t) => t.start_at)}
          completed={boardsDone.filter((t) => t.start_at)}
          unscheduledTodos={filteredUnscheduled}
          members={members}
          canAssign={canAssign}
          hideTitle
          spaces={[space]}
          defaultSpaceId={space.id}
        />
      ) : null}
    </div>
  );
}

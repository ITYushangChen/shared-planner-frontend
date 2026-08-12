"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
  TODO_SELECT_LEAN,
  getOverviewBounds,
  isAssignedToUser,
  todoOverlapsRange,
  type OverviewRange,
  type SpaceMemberOption,
  type SpaceNavItem,
  type TodoRow,
} from "@/lib/todos";
// 优先首屏：日历/列表/未排期均拆包
const TodoListPanel = dynamic(
  () =>
    import("./todo-list-panel").then((m) => ({ default: m.TodoListPanel })),
  { loading: () => null },
);
const TodosCalendar = dynamic(
  () =>
    import("./todos-calendar").then((m) => ({ default: m.TodosCalendar })),
  // 占位不闪脉冲：只留高度，避免骨架→日历再晃一下
  { ssr: false, loading: () => <div className="min-h-[420px]" aria-busy /> },
);
type Props = {
  todos: TodoRow[];
  scheduled: TodoRow[];
  unscheduled: TodoRow[];
  completed?: TodoRow[];
  spaces?: SpaceNavItem[];
  membersBySpace: Record<string, SpaceMemberOption[]>;
  canAssignBySpace: Record<string, boolean>;
  /** 日历首屏未带已排期：立即客户端拉取当前窗口 */
  deferScheduled?: boolean;
  /** 日历首屏未带未排期：空闲后客户端补拉 */
  deferUnscheduled?: boolean;
};

const SCHEDULED_CLIENT_LIMIT = 80;
const UNSCHEDULED_CLIENT_LIMIT = 40;

type OverviewTab = "boards" | "calendar" | "list";

function parseTab(raw: string | null): OverviewTab {
  if (raw === "boards") return "boards";
  if (raw === "list") return "list";
  return "calendar";
}

function parseRange(raw: string | null): OverviewRange | "all" {
  if (raw === "day" || raw === "month" || raw === "week") return raw;
  if (raw === "all") return "all";
  return "week"; // 默认周
}

export function OverviewWorkspace({
  todos: todosProp,
  scheduled: scheduledProp,
  unscheduled: unscheduledProp,
  completed = [],
  spaces = [],
  membersBySpace: membersBySpaceProp,
  canAssignBySpace,
  deferScheduled = false,
  deferUnscheduled = false,
}: Props) {
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("view"));
  const range = parseRange(searchParams.get("range"));
  const assigneeId = searchParams.get("assignee") || "";
  const [membersBySpace, setMembersBySpace] = useState(membersBySpaceProp);
  const [scheduledExtra, setScheduledExtra] = useState<TodoRow[]>([]);
  const [unscheduledExtra, setUnscheduledExtra] = useState<TodoRow[]>([]);
  const [unscheduledLocal, setUnscheduledLocal] =
    useState<TodoRow[]>(unscheduledProp);
  const [scheduledRefreshing, setScheduledRefreshing] = useState(false);
  /** 乐观删除：从服务端 props 合并时排除 */
  const [removedIds, setRemovedIds] = useState(() => new Set<string>());
  const rangeFetchKeyRef = useRef<string | null>(null);
  const unschedPropSigRef = useRef("");
  const spaceFilterIds = useMemo(() => {
    const raw = searchParams.get("spaces");
    if (!raw?.trim()) return [] as string[];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [searchParams]);

  // 稳定依赖：避免 RSC refresh 时 spaces/canAssign 新引用触发重拉闪屏
  const spaceIdsKey = useMemo(
    () => spaces.map((s) => s.id).join(","),
    [spaces],
  );
  const canAssignKey = useMemo(
    () =>
      spaces
        .map((s) => `${s.id}:${canAssignBySpace[s.id] ? "1" : "0"}`)
        .join(","),
    [spaces, canAssignBySpace],
  );

  const membersPropSigRef = useRef("");
  // 空对象不覆盖本地成员；同签名跳过，避免 URL 切换无谓 setState
  useEffect(() => {
    const keys = Object.keys(membersBySpaceProp);
    if (keys.length === 0) return;
    const sig = keys
      .sort()
      .map(
        (sid) =>
          `${sid}:${(membersBySpaceProp[sid] ?? [])
            .map((m) => m.user_id)
            .join(",")}`,
      )
      .join("|");
    if (sig === membersPropSigRef.current) return;
    membersPropSigRef.current = sig;
    setMembersBySpace(membersBySpaceProp);
  }, [membersBySpaceProp]);

  // 服务端未排期变化时同步；同 id 集合跳过，避免盖掉本地拖拽结果
  useEffect(() => {
    const sig = unscheduledProp.map((t) => t.id).join(",");
    if (sig === unschedPropSigRef.current) return;
    unschedPropSigRef.current = sig;
    setUnscheduledLocal(unscheduledProp);
  }, [unscheduledProp]);

  // 日历 ↔ 未排期 / 创建删除 本地同步
  useEffect(() => {
    function onUnscheduled(ev: Event) {
      const todo = (ev as CustomEvent<TodoUnscheduledDetail>).detail?.todo;
      if (!todo?.id) return;
      setRemovedIds((prev) => {
        if (!prev.has(todo.id)) return prev;
        const next = new Set(prev);
        next.delete(todo.id);
        return next;
      });
      setUnscheduledLocal((prev) => applyTodoUpsert(prev, todo));
      setScheduledExtra((prev) => applyTodoDelete(prev, todo.id));
    }
    function onScheduled(ev: Event) {
      const todoId = (ev as CustomEvent<TodoScheduledDetail>).detail?.todoId;
      if (!todoId) return;
      setUnscheduledLocal((prev) => applyTodoDelete(prev, todoId));
    }
    function onUpsert(ev: Event) {
      const todo = (ev as CustomEvent<TodoUpsertedDetail>).detail?.todo;
      if (!todo?.id) return;
      setRemovedIds((prev) => {
        if (!prev.has(todo.id)) return prev;
        const next = new Set(prev);
        next.delete(todo.id);
        return next;
      });
      if (todo.start_at) {
        setScheduledExtra((prev) => applyTodoUpsert(prev, todo));
        setUnscheduledLocal((prev) => applyTodoDelete(prev, todo.id));
      } else {
        setUnscheduledLocal((prev) => applyTodoUpsert(prev, todo));
        setScheduledExtra((prev) => applyTodoDelete(prev, todo.id));
      }
    }
    function onDeleted(ev: Event) {
      const todoId = (ev as CustomEvent<TodoDeletedDetail>).detail?.todoId;
      if (!todoId) return;
      setRemovedIds((prev) => new Set(prev).add(todoId));
      setUnscheduledLocal((prev) => applyTodoDelete(prev, todoId));
      setScheduledExtra((prev) => applyTodoDelete(prev, todoId));
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
  }, []);

  // 服务端已带已排期时同步进本地缓存；同内容不 setState，避免 refresh 闪一下
  const scheduledSigRef = useRef("");
  useEffect(() => {
    if (scheduledProp.length === 0) return;
    const sig = scheduledProp
      .map((t) => `${t.id}:${t.start_at}:${t.end_at}:${t.status}`)
      .join("|");
    if (sig === scheduledSigRef.current) return;
    scheduledSigRef.current = sig;
    setScheduledExtra(scheduledProp);
  }, [scheduledProp]);

  // 仅 deferScheduled 且服务端为空时客户端补拉；range 变化才标 refreshing
  useEffect(() => {
    if (!deferScheduled || !spaceIdsKey) return;
    if (scheduledProp.length > 0) return;
    let cancelled = false;
    const calRange: OverviewRange =
      range === "day" || range === "month" || range === "week"
        ? range
        : "week";
    const fetchKey = `${spaceIdsKey}|${calRange}|${canAssignKey}`;
    const rangeChanged =
      rangeFetchKeyRef.current != null &&
      rangeFetchKeyRef.current.split("|")[1] !== calRange;
    rangeFetchKeyRef.current = fetchKey;

    const { start, end } = getOverviewBounds(calRange);
    const windowStart = new Date(start.getTime() - 2 * 24 * 60 * 60 * 1000);
    const supabase = createClient();
    const spaceIds = spaceIdsKey.split(",").filter(Boolean);
    if (rangeChanged) setScheduledRefreshing(true);
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("todos")
        .select(TODO_SELECT_LEAN)
        .in("space_id", spaceIds)
        .neq("status", "done")
        .not("start_at", "is", null)
        .gte("start_at", windowStart.toISOString())
        .lt("start_at", end.toISOString())
        .order("start_at", { ascending: true })
        .limit(SCHEDULED_CLIENT_LIMIT);
      if (cancelled) return;
      const assignMap = Object.fromEntries(
        canAssignKey.split(",").filter(Boolean).map((pair) => {
          const [id, flag] = pair.split(":");
          return [id, flag === "1"];
        }),
      ) as Record<string, boolean>;
      const rows = ((data ?? []) as unknown as TodoRow[]).filter((t) => {
        if (assignMap[t.space_id]) return true;
        if (!user) return false;
        return isAssignedToUser(t, user.id);
      });
      setScheduledExtra(rows);
      setScheduledRefreshing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [deferScheduled, spaceIdsKey, canAssignKey, range, scheduledProp.length]);

  // 日历首屏未带未排期：空闲后补拉（稳定依赖，避免 refresh 重复打）
  useEffect(() => {
    if (!deferUnscheduled || !spaceIdsKey) return;
    if (unscheduledProp.length > 0) return;
    let cancelled = false;
    const spaceIds = spaceIdsKey.split(",").filter(Boolean);
    const assignMap = Object.fromEntries(
      canAssignKey.split(",").filter(Boolean).map((pair) => {
        const [id, flag] = pair.split(":");
        return [id, flag === "1"];
      }),
    ) as Record<string, boolean>;
    const run = () => {
      const supabase = createClient();
      void (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { data } = await supabase
          .from("todos")
          .select(TODO_SELECT_LEAN)
          .in("space_id", spaceIds)
          .neq("status", "done")
          .is("start_at", null)
          .order("created_at", { ascending: false })
          .limit(UNSCHEDULED_CLIENT_LIMIT);
        if (cancelled || !data) return;
        const rows = (data as unknown as TodoRow[]).filter((t) => {
          if (assignMap[t.space_id]) return true;
          if (!user) return false;
          return isAssignedToUser(t, user.id);
        });
        setUnscheduledExtra(rows);
      })();
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(run, { timeout: 900 });
    } else {
      timeoutId = setTimeout(run, 450);
    }
    return () => {
      cancelled = true;
      if (idleId != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [deferUnscheduled, spaceIdsKey, canAssignKey, unscheduledProp.length]);

  // 服务端 + 本地乐观更新合并（本地 upsert 覆盖同 id；removed 立刻隐藏）
  const scheduled = useMemo(() => {
    const map = new Map<string, TodoRow>();
    for (const t of scheduledProp) {
      if (!removedIds.has(t.id)) map.set(t.id, t);
    }
    for (const t of scheduledExtra) {
      if (!removedIds.has(t.id)) map.set(t.id, t);
    }
    return [...map.values()];
  }, [scheduledProp, scheduledExtra, removedIds]);
  const unscheduled = useMemo(() => {
    const map = new Map<string, TodoRow>();
    const base =
      unscheduledLocal.length > 0 || unschedPropSigRef.current !== ""
        ? unscheduledLocal
        : unscheduledExtra;
    for (const t of base) {
      if (!removedIds.has(t.id)) map.set(t.id, t);
    }
    if (base === unscheduledLocal && unscheduledExtra.length > 0) {
      for (const t of unscheduledExtra) {
        if (!removedIds.has(t.id) && !map.has(t.id)) map.set(t.id, t);
      }
    }
    return [...map.values()];
  }, [unscheduledLocal, unscheduledExtra, removedIds]);
  const todos = useMemo(() => {
    const map = new Map<string, TodoRow>();
    for (const t of todosProp) {
      if (!removedIds.has(t.id)) map.set(t.id, t);
    }
    for (const t of scheduled) map.set(t.id, t);
    for (const t of unscheduled) map.set(t.id, t);
    return [...map.values()];
  }, [todosProp, scheduled, unscheduled, removedIds]);

  const membersFetchedForRef = useRef("");
  const hasMembersProp = Object.keys(membersBySpaceProp).length > 0;

  // 仅服务端未带成员时补拉；用 hasMembersProp 布尔依赖，避免 URL 切换反复 cancel
  useEffect(() => {
    if (hasMembersProp || !spaceIdsKey) {
      if (hasMembersProp) membersFetchedForRef.current = spaceIdsKey;
      return;
    }
    if (membersFetchedForRef.current === spaceIdsKey) return;
    let cancelled = false;
    const spaceIds = spaceIdsKey.split(",").filter(Boolean);
    const supabase = createClient();
    void supabase
      .from("space_members")
      .select("user_id, space_id, profiles(display_name, email)")
      .in("space_id", spaceIds)
      .then(({ data }) => {
        if (cancelled || !data) return;
        membersFetchedForRef.current = spaceIdsKey;
        const next: Record<string, SpaceMemberOption[]> = {};
        for (const row of data) {
          const raw = row.profiles as unknown;
          const profile = (
            Array.isArray(raw) ? raw[0] : raw
          ) as { display_name: string; email: string | null } | null | undefined;
          const sid = row.space_id as string;
          if (!next[sid]) next[sid] = [];
          next[sid].push({
            user_id: row.user_id as string,
            display_name: profile?.display_name ?? "成员",
            email: profile?.email ?? null,
          });
        }
        membersPropSigRef.current = spaceIds
          .sort()
          .map(
            (sid) =>
              `${sid}:${(next[sid] ?? []).map((m) => m.user_id).join(",")}`,
          )
          .join("|");
        setMembersBySpace(next);
      });
    return () => {
      cancelled = true;
    };
  }, [hasMembersProp, spaceIdsKey]);

  const flatMembers = useMemo(() => {
    const map = new Map<string, SpaceMemberOption>();
    for (const list of Object.values(membersBySpace)) {
      for (const m of list) map.set(m.user_id, m);
    }
    return [...map.values()];
  }, [membersBySpace]);

  const canAssignAny = Object.values(canAssignBySpace).some(Boolean);

  const filterTodos = useCallback(
    (list: TodoRow[]) => {
      let next = list;
      if (spaceFilterIds.length > 0) {
        const set = new Set(spaceFilterIds);
        next = next.filter((t) => set.has(t.space_id));
      }
      if (assigneeId) {
        next = next.filter((t) => isAssignedToUser(t, assigneeId));
      }
      return next;
    },
    [assigneeId, spaceFilterIds],
  );

  const filteredTodos = useMemo(
    () => filterTodos(todos),
    [todos, filterTodos],
  );
  const filteredScheduled = useMemo(
    () => filterTodos(scheduled),
    [scheduled, filterTodos],
  );
  const filteredUnscheduled = useMemo(
    () => filterTodos(unscheduled),
    [unscheduled, filterTodos],
  );
  const filteredCompleted = useMemo(
    () => filterTodos(completed),
    [completed, filterTodos],
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
        tab === "calendar" ? "gap-0 md:gap-4" : "gap-4",
      ].join(" ")}
    >
      {tab === "boards" ? (
        <TodoListPanel
          todos={boardsOpen.filter((t) => t.start_at)}
          completed={boardsDone.filter((t) => t.start_at)}
          unscheduledTodos={filteredUnscheduled}
          members={flatMembers}
          canAssign={canAssignAny}
          hideTitle
          spaces={spaces}
          defaultSpaceId={spaces[0]?.id}
          includeDone
        />
      ) : null}

      {tab === "calendar" ? (
        <div
          className={
            scheduledRefreshing && filteredScheduled.length > 0
              ? "opacity-70 transition-opacity duration-200"
              : "transition-opacity duration-200"
          }
          aria-busy={scheduledRefreshing || undefined}
        >
          <TodosCalendar
            todos={filteredScheduled}
            spaces={spaces}
            allowOverview
            membersBySpace={membersBySpace}
            canAssignBySpace={canAssignBySpace}
            hideTitle
            mobileDateChrome
            viewRange={range === "all" ? "week" : range}
          />
        </div>
      ) : null}

      {tab === "list" ? (
        <TodoListPanel
          todos={boardsOpen.filter((t) => t.start_at)}
          completed={boardsDone.filter((t) => t.start_at)}
          unscheduledTodos={filteredUnscheduled}
          members={flatMembers}
          canAssign={canAssignAny}
          hideTitle
          spaces={spaces}
          defaultSpaceId={spaces[0]?.id}
        />
      ) : null}
    </div>
  );
}

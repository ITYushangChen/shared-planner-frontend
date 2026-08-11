"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  filterTodosForViewer,
  getCachedSpaceTodos,
  loadSpaceCalendarTodos,
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
  TODO_SELECT_LEAN,
  isAssignedToUser,
  type SpaceMemberOption,
  type SpaceNavItem,
  type TodoRow,
} from "@/lib/todos";

const UnscheduledList = dynamic(
  () =>
    import("./unscheduled-list").then((m) => ({ default: m.UnscheduledList })),
  { ssr: false, loading: () => null },
);

const UNSCHEDULED_LIMIT = 40;
const EMPTY_IDS: string[] = [];

type Props = {
  spaces: SpaceNavItem[];
};

function parseSpacesParam(raw: string | null): string[] {
  if (!raw?.trim()) return EMPTY_IDS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 侧栏未排期：按当前空间 / 总览可见空间拉取，并与日历拖拽事件同步 */
export function SidebarUnscheduled({ spaces }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spaceIdFromPath = pathname.startsWith("/app/spaces/")
    ? pathname.split("/")[3] || null
    : null;
  const onOverview = pathname === "/app";
  const view = searchParams.get("view");
  const isCalendar =
    view === "calendar" ||
    (!view && (onOverview || Boolean(spaceIdFromPath)));

  const spacesParam = searchParams.get("spaces");
  const overviewSpaceFilter = useMemo(
    () => parseSpacesParam(spacesParam),
    [spacesParam],
  );

  const scopeSpaceIds = useMemo(() => {
    if (spaceIdFromPath) return [spaceIdFromPath];
    if (!onOverview) return EMPTY_IDS;
    if (overviewSpaceFilter.length > 0) {
      const allowed = new Set(spaces.map((s) => s.id));
      return overviewSpaceFilter.filter((id) => allowed.has(id));
    }
    return spaces.map((s) => s.id);
  }, [spaceIdFromPath, onOverview, overviewSpaceFilter, spaces]);

  const scopeKey = scopeSpaceIds.join(",");

  const scopeSpaces = useMemo(
    () =>
      scopeKey
        ? spaces.filter((s) => scopeSpaceIds.includes(s.id))
        : [],
    [spaces, scopeKey, scopeSpaceIds],
  );

  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [membersBySpace, setMembersBySpace] = useState<
    Record<string, SpaceMemberOption[]>
  >({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const canAssignBySpace = useMemo(
    () =>
      Object.fromEntries(
        scopeSpaces.map((s) => [
          s.id,
          s.role === "owner" || s.role === "admin",
        ]),
      ),
    [scopeSpaces],
  );

  const canAssignKey = useMemo(
    () =>
      scopeSpaces
        .map((s) => `${s.id}:${s.role === "owner" || s.role === "admin" ? "1" : "0"}`)
        .join(","),
    [scopeSpaces],
  );

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!scopeKey) {
      setTodos((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const ids = scopeKey.split(",");
    let cancelled = false;
    const supabase = createClient();
    const roleBySpace = Object.fromEntries(
      canAssignKey.split(",").filter(Boolean).map((part) => {
        const [id, flag] = part.split(":");
        return [id!, flag === "1"];
      }),
    );

    void (async () => {
      if (ids.length === 1) {
        const sid = ids[0]!;
        const canAssign = !!roleBySpace[sid];
        const cached = getCachedSpaceTodos(sid);
        if (cached) {
          const filtered = filterTodosForViewer(
            cached,
            canAssign,
            currentUserId ?? undefined,
          );
          if (!cancelled) setTodos(filtered.unscheduled);
        }
        const data = await loadSpaceCalendarTodos(sid);
        if (cancelled) return;
        const filtered = filterTodosForViewer(
          data,
          canAssign,
          currentUserId ?? undefined,
        );
        setTodos(filtered.unscheduled);
        return;
      }

      const { data } = await supabase
        .from("todos")
        .select(TODO_SELECT_LEAN)
        .in("space_id", ids)
        .neq("status", "done")
        .is("start_at", null)
        .order("created_at", { ascending: false })
        .limit(UNSCHEDULED_LIMIT);
      if (cancelled) return;
      let rows = (data ?? []) as unknown as TodoRow[];
      if (currentUserId) {
        rows = rows.filter((t) => {
          if (roleBySpace[t.space_id]) return true;
          return isAssignedToUser(t, currentUserId);
        });
      }
      setTodos(rows);
    })();

    return () => {
      cancelled = true;
    };
  }, [scopeKey, currentUserId, canAssignKey]);

  useEffect(() => {
    if (!scopeKey) {
      setMembersBySpace((prev) =>
        Object.keys(prev).length === 0 ? prev : {},
      );
      return;
    }
    const ids = scopeKey.split(",");
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("space_members")
      .select("user_id, space_id, profiles(display_name, email)")
      .in("space_id", ids)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, SpaceMemberOption[]> = {};
        for (const row of data) {
          const sid = row.space_id as string;
          const raw = row.profiles as unknown;
          const profile = (
            Array.isArray(raw) ? raw[0] : raw
          ) as { display_name: string; email: string | null } | null;
          if (!map[sid]) map[sid] = [];
          map[sid].push({
            user_id: row.user_id as string,
            display_name: profile?.display_name ?? "成员",
            email: profile?.email ?? null,
          });
        }
        setMembersBySpace(map);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  useEffect(() => {
    const ids = scopeKey ? scopeKey.split(",") : EMPTY_IDS;
    function onUnscheduled(ev: Event) {
      const todo = (ev as CustomEvent<TodoUnscheduledDetail>).detail?.todo;
      if (!todo?.id || !ids.includes(todo.space_id)) return;
      setTodos((prev) => applyTodoUpsert(prev, todo));
    }
    function onScheduled(ev: Event) {
      const todoId = (ev as CustomEvent<TodoScheduledDetail>).detail?.todoId;
      if (!todoId) return;
      setTodos((prev) => applyTodoDelete(prev, todoId));
    }
    function onUpsert(ev: Event) {
      const todo = (ev as CustomEvent<TodoUpsertedDetail>).detail?.todo;
      if (!todo?.id || !ids.includes(todo.space_id)) return;
      if (todo.status === "done" || todo.start_at) {
        setTodos((prev) => applyTodoDelete(prev, todo.id));
        return;
      }
      setTodos((prev) => applyTodoUpsert(prev, todo));
    }
    function onDeleted(ev: Event) {
      const todoId = (ev as CustomEvent<TodoDeletedDetail>).detail?.todoId;
      if (!todoId) return;
      setTodos((prev) => applyTodoDelete(prev, todoId));
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
  }, [scopeKey]);

  if (scopeSpaces.length === 0) return null;

  const defaultSpaceId = spaceIdFromPath || scopeSpaces[0]?.id;
  const single = scopeSpaces[0];
  const canAssign = single
    ? canAssignBySpace[single.id] ?? false
    : Object.values(canAssignBySpace).some(Boolean);

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--border-muted)]/80">
      <UnscheduledList
        todos={todos}
        members={
          spaceIdFromPath
            ? (membersBySpace[spaceIdFromPath] ?? [])
            : []
        }
        membersBySpace={membersBySpace}
        canAssignBySpace={canAssignBySpace}
        canAssign={!!canAssign}
        acceptCalendarDrop={isCalendar}
        compact
        spaces={scopeSpaces}
        defaultSpaceId={defaultSpaceId}
        allowOverview={onOverview && !spaceIdFromPath}
      />
    </div>
  );
}

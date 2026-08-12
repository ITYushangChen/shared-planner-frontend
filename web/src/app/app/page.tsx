import { Suspense } from "react";
import { getAppAuth, getMySpaceNav, visibleSpaceNav } from "@/lib/app-data";
import {
  TODO_SELECT_LEAN,
  getOverviewBounds,
  type OverviewRange,
  type SpaceMemberOption,
  type TodoRow,
} from "@/lib/todos";
import { DeferredTodosRealtime } from "./deferred-todos-realtime";
import { OverviewPageHeader } from "./overview-page-header";
import { OverviewWorkspace } from "./overview-workspace";

const ACTIVE_TODO_LIMIT = 150;
const SCHEDULED_LIMIT = 80;
const UNSCHEDULED_LIMIT = 40;
const DONE_TODO_LIMIT = 40;

type SearchParams = Promise<{
  view?: string;
  range?: string;
  assignee?: string;
}>;

function parseOverviewView(raw: string | undefined): "boards" | "calendar" | "list" {
  if (raw === "calendar") return "calendar";
  if (raw === "list") return "list";
  if (raw === "boards") return "boards";
  // 无 view 时与登录默认一致：日历
  return "calendar";
}

export default async function AppOverviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const view = parseOverviewView(sp.view);

  const { supabase, user } = await getAppAuth();
  const { spaces: allSpaces } = await getMySpaceNav();
  const spaces = visibleSpaceNav(allSpaces);

  const spaceIds = spaces.map((s) => s.id);
  const canAssignBySpace = Object.fromEntries(
    spaces.map((s) => [
      s.id,
      s.role === "owner" || s.role === "admin",
    ]),
  );

  const emptyMembers = { data: [] as never[] };
  const emptyTodos = { data: [] as never[], error: null };

  let todosError: { message: string } | null = null;
  let todos: TodoRow[] = [];
  let completed: TodoRow[] = [];
  let scheduled: TodoRow[] = [];
  let unscheduled: TodoRow[] = [];

  function visibleToUser(t: TodoRow) {
    if (canAssignBySpace[t.space_id]) return true;
    return (t.todo_assignees ?? []).some((a) => a.user_id === user!.id);
  }

  if (view === "calendar") {
    // 已排期 + 未排期 + 成员并行返回，避免顶栏人员在 URL 切换时被清空闪掉
    const rangeRaw = sp.range;
    const calRange: OverviewRange =
      rangeRaw === "day" || rangeRaw === "month" || rangeRaw === "week"
        ? rangeRaw
        : "week";
    const { start, end } = getOverviewBounds(calRange);
    const windowStart = new Date(start.getTime() - 2 * 24 * 60 * 60 * 1000);
    const membersPromise =
      spaceIds.length > 0
        ? supabase
            .from("space_members")
            .select("user_id, space_id, profiles(display_name, email)")
            .in("space_id", spaceIds)
        : Promise.resolve(emptyMembers);
    const [scheduledRes, unscheduledRes, membersRes] = await Promise.all([
      spaceIds.length > 0
        ? supabase
            .from("todos")
            .select(TODO_SELECT_LEAN)
            .in("space_id", spaceIds)
            .neq("status", "done")
            .not("start_at", "is", null)
            .gte("start_at", windowStart.toISOString())
            .lt("start_at", end.toISOString())
            .order("start_at", { ascending: true })
            .limit(SCHEDULED_LIMIT)
        : Promise.resolve(emptyTodos),
      spaceIds.length > 0
        ? supabase
            .from("todos")
            .select(TODO_SELECT_LEAN)
            .in("space_id", spaceIds)
            .neq("status", "done")
            .is("start_at", null)
            .order("created_at", { ascending: false })
            .limit(UNSCHEDULED_LIMIT)
        : Promise.resolve(emptyTodos),
      membersPromise,
    ]);

    todosError = scheduledRes.error ?? unscheduledRes.error;
    scheduled = ((scheduledRes.data ?? []) as unknown as TodoRow[]).filter(
      visibleToUser,
    );
    unscheduled = (
      (unscheduledRes.data ?? []) as unknown as TodoRow[]
    ).filter(visibleToUser);
    const membersBySpace = mapMembers(membersRes.data ?? []);
    const flatMembers = flattenMembers(membersBySpace);

    return (
      <OverviewShell
        todosError={todosError}
        flatMembers={flatMembers}
        loadMembersClient
        todos={[...scheduled, ...unscheduled]}
        scheduled={scheduled}
        unscheduled={unscheduled}
        completed={[]}
        spaces={spaces}
        membersBySpace={membersBySpace}
        canAssignBySpace={canAssignBySpace}
      />
    );
  }

  const membersPromise =
    spaceIds.length > 0
      ? supabase
          .from("space_members")
          .select("user_id, space_id, profiles(display_name, email)")
          .in("space_id", spaceIds)
      : Promise.resolve(emptyMembers);

  // 看板 / 列表：与日历同级 lean 字段，减轻 SSR（详情编辑时再拉）
  const [membersRes, todosRes, doneRes] = await Promise.all([
    membersPromise,
    spaceIds.length > 0
      ? supabase
          .from("todos")
          .select(TODO_SELECT_LEAN)
          .in("space_id", spaceIds)
          .neq("status", "done")
          .order("created_at", { ascending: false })
          .limit(ACTIVE_TODO_LIMIT)
      : Promise.resolve(emptyTodos),
    spaceIds.length > 0
      ? supabase
          .from("todos")
          .select(TODO_SELECT_LEAN)
          .in("space_id", spaceIds)
          .eq("status", "done")
          .order("completed_at", { ascending: false })
          .limit(DONE_TODO_LIMIT)
      : Promise.resolve(emptyTodos),
  ]);

  todosError = todosRes.error;
  const allTodos = (todosRes.data ?? []) as unknown as TodoRow[];
  todos = allTodos.filter(visibleToUser);
  completed = ((doneRes.data ?? []) as unknown as TodoRow[]).filter(
    visibleToUser,
  );
  scheduled = todos.filter((t) => t.start_at);
  unscheduled = todos.filter((t) => !t.start_at);

  const membersBySpace = mapMembers(membersRes.data ?? []);
  const flatMembers = flattenMembers(membersBySpace);

  return (
    <OverviewShell
      todosError={todosError}
      flatMembers={flatMembers}
      todos={todos}
      scheduled={scheduled}
      unscheduled={unscheduled}
      completed={completed}
      spaces={spaces}
      membersBySpace={membersBySpace}
      canAssignBySpace={canAssignBySpace}
    />
  );
}

function mapMembers(
  rows: {
    user_id: string;
    space_id: string;
    profiles: unknown;
  }[],
): Record<string, SpaceMemberOption[]> {
  const membersBySpace: Record<string, SpaceMemberOption[]> = {};
  for (const m of rows) {
    const profile = m.profiles as {
      display_name: string;
      email: string | null;
    } | null;
    const sid = m.space_id;
    if (!membersBySpace[sid]) membersBySpace[sid] = [];
    membersBySpace[sid].push({
      user_id: m.user_id,
      display_name: profile?.display_name ?? "成员",
      email: profile?.email ?? null,
    });
  }
  return membersBySpace;
}

function flattenMembers(
  membersBySpace: Record<string, SpaceMemberOption[]>,
): SpaceMemberOption[] {
  const map = new Map<string, SpaceMemberOption>();
  for (const list of Object.values(membersBySpace)) {
    for (const m of list) map.set(m.user_id, m);
  }
  return [...map.values()];
}

function OverviewShell({
  todosError,
  flatMembers,
  loadMembersClient = false,
  deferScheduled = false,
  deferUnscheduled = false,
  todos,
  scheduled,
  unscheduled,
  completed,
  spaces,
  membersBySpace,
  canAssignBySpace,
}: {
  todosError: { message: string } | null;
  flatMembers: SpaceMemberOption[];
  loadMembersClient?: boolean;
  deferScheduled?: boolean;
  deferUnscheduled?: boolean;
  todos: TodoRow[];
  scheduled: TodoRow[];
  unscheduled: TodoRow[];
  completed: TodoRow[];
  spaces: Awaited<ReturnType<typeof getMySpaceNav>>["spaces"];
  membersBySpace: Record<string, SpaceMemberOption[]>;
  canAssignBySpace: Record<string, boolean>;
}) {
  return (
    <main className="flex flex-1 flex-col">
      <DeferredTodosRealtime />
      <Suspense fallback={null}>
        <OverviewPageHeader
          members={flatMembers}
          spaces={spaces}
          loadMembersClient={loadMembersClient}
        />
      </Suspense>
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
        {todosError ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            加载待办失败：{todosError.message}
            {todosError.message.includes("kind")
              ? " — 请先执行 spaces.kind 迁移 SQL"
              : ""}
          </p>
        ) : null}

        <Suspense fallback={null}>
          <OverviewWorkspace
            todos={todos}
            scheduled={scheduled}
            unscheduled={unscheduled}
            completed={completed}
            spaces={spaces}
            membersBySpace={membersBySpace}
            canAssignBySpace={canAssignBySpace}
            deferScheduled={deferScheduled}
            deferUnscheduled={deferUnscheduled}
          />
        </Suspense>
      </div>
    </main>
  );
}

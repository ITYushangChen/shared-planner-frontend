import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAppAuth } from "@/lib/app-data";
import { FAST_SPACE_NAV } from "@/lib/nav-perf";
import {
  TODO_SELECT,
  TODO_SELECT_LEAN,
  isAssignedToUser,
  type SpaceMemberOption,
  type SpaceNavItem,
  type TodoRow,
} from "@/lib/todos";
import type { InviteRow } from "@/lib/invites";
import { BackToAppButton } from "../../back-to-app-button";
import { SpaceWorkspace } from "../../space-workspace";
import { DeferredTodosRealtime } from "../../deferred-todos-realtime";
import { SpaceManageChrome } from "./space-manage-chrome";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; assignee?: string; panel?: string }>;
};

const ACTIVE_TODO_LIMIT = 150;
const SCHEDULED_LIMIT = 80;
const UNSCHEDULED_LIMIT = 40;
const DONE_TODO_LIMIT = 80;

function parseSpaceView(raw: string | undefined): "boards" | "calendar" | "list" {
  if (raw === "boards" || raw === "list") return raw;
  return "calendar";
}

export default async function SpaceDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const view = parseSpaceView(sp.view);

  const { supabase, user } = await getAppAuth();

  if (!user) {
    redirect("/login");
  }

  const emptyInvites = { data: [] as InviteRow[] };

  // 成员校验与数据并行（RLS 会挡住无权限的 todos）
  const membershipPromise = supabase
    .from("space_members")
    .select(
      "role, spaces(id, name, description, kind, owner_id, avatar_url, visibility)",
    )
    .eq("space_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const membersPromise = supabase
    .from("space_members")
    .select("user_id, role, profiles(display_name, email)")
    .eq("space_id", id);

  const profilePromise = supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();

  if (FAST_SPACE_NAV) {
    // 日历 / 总览 / 列表：只等成员校验；待办与成员客户端补
    const membershipRes = await membershipPromise;
    const denied = accessDenied(membershipRes.data);
    if (denied) return denied;
    const { membership, space } = deniedOrSpace(membershipRes.data)!;
    return renderSpacePage({
      space,
      membershipRole: membership.role,
      userId: user.id,
      canManage:
        membership.role === "owner" || membership.role === "admin",
      canAssign:
        membership.role === "owner" || membership.role === "admin",
      isOwner:
        membership.role === "owner" || space.owner_id === user.id,
      membersRes: { data: [] },
      profileRes: { data: null },
      invitesRes: emptyInvites,
      active: [],
      completed: [],
      deferTodos: true,
      deferMembers: true,
    });
  }

  if (view === "calendar") {
    // 旧行为：成员 + 已排期/未排期一并 SSR
    const leanMembersPromise = supabase
      .from("space_members")
      .select("user_id, role, profiles(display_name)")
      .eq("space_id", id);

    const [membershipRes, membersRes, scheduledRes, unscheduledRes] =
      await Promise.all([
        membershipPromise,
        leanMembersPromise,
        supabase
          .from("todos")
          .select(TODO_SELECT_LEAN)
          .eq("space_id", id)
          .neq("status", "done")
          .not("start_at", "is", null)
          .order("start_at", { ascending: true })
          .limit(SCHEDULED_LIMIT),
        supabase
          .from("todos")
          .select(TODO_SELECT_LEAN)
          .eq("space_id", id)
          .neq("status", "done")
          .is("start_at", null)
          .order("created_at", { ascending: false })
          .limit(UNSCHEDULED_LIMIT),
      ]);

    const denied = accessDenied(membershipRes.data);
    if (denied) return denied;

    const { membership, space } = deniedOrSpace(membershipRes.data)!;
    const scheduled = (scheduledRes.data ?? []) as unknown as TodoRow[];
    const unscheduled = (unscheduledRes.data ?? []) as unknown as TodoRow[];

    return renderSpacePage({
      space,
      membershipRole: membership.role,
      userId: user.id,
      canManage:
        membership.role === "owner" || membership.role === "admin",
      canAssign:
        membership.role === "owner" || membership.role === "admin",
      isOwner:
        membership.role === "owner" || space.owner_id === user.id,
      membersRes,
      profileRes: { data: null },
      invitesRes: emptyInvites,
      active: [...scheduled, ...unscheduled],
      completed: [],
      deferTodos: false,
      deferMembers: false,
    });
  }

  const [
    membershipRes,
    membersRes,
    activeTodosRes,
    doneTodosRes,
    profileRes,
    invitesRes,
  ] = await Promise.all([
    membershipPromise,
    membersPromise,
    supabase
      .from("todos")
      .select(TODO_SELECT)
      .eq("space_id", id)
      .neq("status", "done")
      .order("created_at", { ascending: false })
      .limit(ACTIVE_TODO_LIMIT),
    supabase
      .from("todos")
      .select(TODO_SELECT)
      .eq("space_id", id)
      .eq("status", "done")
      .order("completed_at", { ascending: false })
      .limit(DONE_TODO_LIMIT),
    profilePromise,
    supabase
      .from("space_invitations")
      .select(
        "id, code, invite_type, max_uses, used_count, expires_at, status, created_at",
      )
      .eq("space_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const denied = accessDenied(membershipRes.data);
  if (denied) return denied;

  const { membership, space } = deniedOrSpace(membershipRes.data)!;
  const canManage =
    membership.role === "owner" || membership.role === "admin";

  return renderSpacePage({
    space,
    membershipRole: membership.role,
    userId: user.id,
    canManage,
    canAssign: canManage,
    isOwner: membership.role === "owner" || space.owner_id === user.id,
    membersRes,
    profileRes,
    invitesRes: canManage ? invitesRes : emptyInvites,
    active: (activeTodosRes.data ?? []) as unknown as TodoRow[],
    completed: (doneTodosRes.data ?? []) as unknown as TodoRow[],
    deferTodos: false,
    deferMembers: false,
  });
}

type MembershipRow = {
  role: string;
  spaces: unknown;
};

type SpaceRow = {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  owner_id: string;
  avatar_url: string | null;
  visibility: string | null;
};

function deniedOrSpace(data: MembershipRow | null) {
  if (!data) return null;
  const space = data.spaces as SpaceRow | null;
  if (!space) return null;
  return { membership: data, space };
}

function accessDenied(data: MembershipRow | null) {
  if (deniedOrSpace(data)) return null;
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-semibold text-zinc-900">无法访问该空间</h1>
      <p className="text-sm text-zinc-600">
        你可能已被移出该空间，或邀请尚未生效。请返回总览或使用邀请码重新加入。
      </p>
      <div className="flex flex-wrap gap-3">
        <BackToAppButton />
        <Link
          href="/app/join"
          className="inline-flex rounded-xl border border-[#2f5f8f]/55 bg-white px-4 py-2 text-sm font-medium text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7]"
        >
          输入邀请码加入
        </Link>
      </div>
    </main>
  );
}

function renderSpacePage({
  space,
  membershipRole,
  userId,
  canManage,
  canAssign,
  isOwner,
  membersRes,
  profileRes,
  invitesRes,
  active,
  completed,
  deferTodos = false,
  deferMembers = false,
}: {
  space: SpaceRow;
  membershipRole: string;
  userId: string;
  canManage: boolean;
  canAssign: boolean;
  isOwner: boolean;
  membersRes: { data: unknown[] | null };
  profileRes: { data: { timezone: string | null } | null };
  invitesRes: { data: InviteRow[] | null | InviteRow[] };
  active: TodoRow[];
  completed: TodoRow[];
  /** true：壳先出，待办客户端补（见 FAST_SPACE_NAV） */
  deferTodos?: boolean;
  /** true：成员列表客户端补 */
  deferMembers?: boolean;
}) {
  const membersRaw = (membersRes.data ?? []) as {
    user_id: string;
    role: string;
    profiles: unknown;
  }[];

  const memberOptions: SpaceMemberOption[] = membersRaw.map((m) => {
    const profile = m.profiles as {
      display_name: string;
      email: string | null;
    } | null;
    return {
      user_id: m.user_id,
      display_name: profile?.display_name ?? "成员",
      email: profile?.email ?? null,
    };
  });

  const memberRows = membersRaw.map((m) => {
    const profile = m.profiles as {
      display_name: string;
      email: string | null;
    } | null;
    return {
      user_id: m.user_id,
      role: m.role,
      display_name: profile?.display_name ?? "成员",
      email: profile?.email ?? null,
    };
  });

  const invites = (invitesRes.data ?? []) as InviteRow[];

  let filteredActive = active;
  let filteredCompleted = completed;
  if (!canManage) {
    filteredActive = active.filter((t) => isAssignedToUser(t, userId));
    filteredCompleted = completed.filter((t) => isAssignedToUser(t, userId));
  }

  const todos = [...filteredActive, ...filteredCompleted];
  const scheduled = filteredActive.filter((t) => t.start_at);
  const unscheduled = filteredActive.filter((t) => !t.start_at);

  const spaceNav: SpaceNavItem = {
    id: space.id,
    name: space.name,
    kind: space.kind,
    role: membershipRole,
    visibility: space.visibility ?? "private",
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <DeferredTodosRealtime spaceId={space.id} />

      <Suspense fallback={null}>
        <SpaceManageChrome
          space={space}
          spaceNav={spaceNav}
          memberOptions={memberOptions}
          memberRows={memberRows}
          invites={invites}
          canManage={canManage}
          canAssign={canAssign}
          isOwner={isOwner}
          currentUserId={userId}
          currentRole={membershipRole}
          timezone={profileRes.data?.timezone ?? undefined}
          deferMembers={deferMembers}
        >
          <SpaceWorkspace
            space={spaceNav}
            todos={filteredActive}
            allTodos={todos}
            scheduled={scheduled}
            unscheduled={unscheduled}
            completed={filteredCompleted}
            members={memberOptions}
            canAssign={canAssign}
            currentUserId={userId}
            deferTodos={deferTodos}
            deferMembers={deferMembers}
            listTitle={
              canManage
                ? "待办列表（筛选 / 排序）"
                : "我的待办（仅显示指派给我的）"
            }
          />
        </SpaceManageChrome>
      </Suspense>
    </main>
  );
}

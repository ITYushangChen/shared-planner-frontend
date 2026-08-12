"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getCachedSpaceMembers,
  loadSpaceMembers,
  setCachedSpaceMembers,
} from "@/lib/space-data-cache";
import type { InviteRow } from "@/lib/invites";
import type { SpaceMemberOption, SpaceNavItem } from "@/lib/todos";
import { EditSpaceForm } from "./edit-space-form";
import { SpaceInvites } from "./space-invites";
import { SpaceMembersPanel } from "./space-members-panel";

type Panel = "invites" | "members" | "settings" | "leave" | null;

type MemberRow = {
  user_id: string;
  role: string;
  display_name: string;
  email: string | null;
};

type Props = {
  space: {
    id: string;
    name: string;
    description: string | null;
    kind: string;
    avatar_url: string | null;
    visibility: string | null;
  };
  spaceNav: SpaceNavItem;
  memberOptions: SpaceMemberOption[];
  memberRows: MemberRow[];
  invites: InviteRow[];
  canManage: boolean;
  canAssign: boolean;
  isOwner: boolean;
  currentUserId: string;
  currentRole: string;
  timezone?: string;
  children: ReactNode;
  /** 成员列表为空时客户端补拉 */
  deferMembers?: boolean;
};

const PANEL_TITLE: Record<Exclude<Panel, null>, string> = {
  invites: "邀请成员",
  members: "成员管理",
  settings: "空间设置",
  leave: "离开空间",
};

const PANEL_KEYS = new Set(["invites", "members", "settings", "leave"]);

function parsePanel(
  raw: string | null,
  canManage: boolean,
  isOwner: boolean,
): Panel {
  if (!raw || !PANEL_KEYS.has(raw)) return null;
  if (raw === "leave") return isOwner ? null : "leave";
  if (!canManage) return null;
  return raw as Panel;
}

export function SpaceManageChrome({
  space,
  spaceNav: _spaceNav,
  memberOptions: memberOptionsProp,
  memberRows: memberRowsProp,
  invites,
  canManage,
  canAssign: _canAssign,
  isOwner,
  currentUserId,
  currentRole,
  timezone: _timezone,
  children,
  deferMembers = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [panel, setPanel] = useState<Panel>(() =>
    parsePanel(searchParams.get("panel"), canManage, isOwner),
  );
  const [memberOptions, setMemberOptions] = useState(memberOptionsProp);
  const [memberRows, setMemberRows] = useState(memberRowsProp);
  const isPublic = space.visibility === "public";
  const assignee = searchParams.get("assignee") || "";

  useEffect(() => {
    setPanel(parsePanel(searchParams.get("panel"), canManage, isOwner));
  }, [searchParams, canManage, isOwner]);

  useEffect(() => {
    if (memberOptionsProp.length > 0) setMemberOptions(memberOptionsProp);
  }, [memberOptionsProp]);

  useEffect(() => {
    if (memberRowsProp.length > 0) setMemberRows(memberRowsProp);
  }, [memberRowsProp]);

  useEffect(() => {
    if (!deferMembers || memberOptionsProp.length > 0) return;
    const cached = getCachedSpaceMembers(space.id);
    if (cached) {
      setMemberOptions(cached.options);
      setMemberRows(cached.rows);
    }
    let cancelled = false;
    void loadSpaceMembers(space.id, {
      onData: (data) => {
        if (cancelled) return;
        setMemberOptions(data.options);
        setMemberRows(data.rows);
      },
    });
    return () => {
      cancelled = true;
    };
  }, [deferMembers, memberOptionsProp.length, space.id]);

  useEffect(() => {
    if (memberOptionsProp.length === 0) return;
    setCachedSpaceMembers(space.id, {
      options: memberOptionsProp,
      rows: memberRowsProp,
    });
  }, [space.id, memberOptionsProp, memberRowsProp]);

  function closePanel() {
    setPanel(null);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("panel");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  function setAssignee(userId: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (!userId) next.delete("assignee");
    else next.set("assignee", userId);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  return (
    <>
      {isPublic ? (
        <header className="flex flex-wrap items-center gap-2">
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-500">
            <span className="shrink-0">人员</span>
            <select
              className="max-w-[9rem] rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 outline-none focus:border-brand sm:max-w-[12rem]"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">全部人员</option>
              {memberOptions.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
        </header>
      ) : null}

      {panel ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePanel();
          }}
        >
          <div
            className={[
              "flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl",
              panel === "settings"
                ? "h-[90vh] max-h-[90vh] sm:h-auto sm:max-h-[90vh]"
                : "max-h-[90vh]",
            ].join(" ")}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3">
              <h2 className="text-base font-semibold text-zinc-900">
                {PANEL_TITLE[panel]}
              </h2>
              <button
                type="button"
                onClick={closePanel}
                className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
              >
                关闭
              </button>
            </div>
            {panel === "settings" && canManage ? (
              <EditSpaceForm
                spaceId={space.id}
                initialName={space.name}
                initialKind={space.kind}
                initialDescription={space.description}
                initialVisibility={space.visibility ?? "private"}
                canEdit
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {panel === "invites" && canManage ? (
                  <SpaceInvites
                    spaceId={space.id}
                    canManage
                    initialInvites={invites}
                  />
                ) : null}
                {panel === "members" && canManage ? (
                  <SpaceMembersPanel
                    spaceId={space.id}
                    members={memberRows}
                    currentUserId={currentUserId}
                    currentRole={currentRole}
                    isOwner={isOwner}
                  />
                ) : null}
                {panel === "leave" && !isOwner ? (
                  <div>
                    <p className="mb-3 text-sm text-zinc-500">
                      你是该空间成员。离开后将无法再访问此空间的待办。
                    </p>
                    <SpaceMembersPanel
                      spaceId={space.id}
                      members={memberRows}
                      currentUserId={currentUserId}
                      currentRole={currentRole}
                      isOwner={false}
                      leaveOnly
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(
              child as ReactElement<{ members?: SpaceMemberOption[] }>,
              { members: memberOptions },
            )
          : child,
      )}
    </>
  );
}

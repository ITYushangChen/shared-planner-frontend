"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { InviteRow } from "@/lib/invites";
import type { SpaceNavItem } from "@/lib/todos";
import { SpaceInvites } from "./spaces/[id]/space-invites";
import {
  SpaceMembersPanel,
  type MemberRow,
} from "./spaces/[id]/space-members-panel";

type Mode = "invites" | "members";

type Props = {
  mode: Mode;
  spaces: SpaceNavItem[];
  initialSpaceId?: string | null;
  onClose: () => void;
};

export function SpacePanelModal({
  mode,
  spaces,
  initialSpaceId,
  onClose,
}: Props) {
  const manageable = useMemo(
    () => spaces.filter((s) => s.role === "owner" || s.role === "admin"),
    [spaces],
  );
  const [spaceId, setSpaceId] = useState(
    () =>
      manageable.find((s) => s.id === initialSpaceId)?.id ??
      manageable[0]?.id ??
      "",
  );
  const [currentUserId, setCurrentUserId] = useState("");
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const space = manageable.find((s) => s.id === spaceId) ?? null;
  const canManage = Boolean(
    space && (space.role === "owner" || space.role === "admin"),
  );
  const isOwner = space?.role === "owner";

  useEffect(() => {
    if (!manageable.some((s) => s.id === spaceId) && manageable[0]) {
      setSpaceId(manageable[0].id);
    }
  }, [manageable, spaceId]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    async function load() {
      if (!spaceId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr("");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setErr("请先登录");
          setLoading(false);
        }
        return;
      }
      if (!cancelled) setCurrentUserId(user.id);

      if (mode === "invites") {
        const { data, error } = await supabase
          .from("space_invitations")
          .select(
            "id, code, invite_type, max_uses, used_count, expires_at, status, created_at",
          )
          .eq("space_id", spaceId)
          .order("created_at", { ascending: false });
        if (cancelled) return;
        if (error) {
          setErr(error.message);
          setInvites([]);
        } else {
          setInvites((data ?? []) as InviteRow[]);
        }
      } else {
        const { data, error } = await supabase
          .from("space_members")
          .select("user_id, role, profiles(display_name, email)")
          .eq("space_id", spaceId);
        if (cancelled) return;
        if (error) {
          setErr(error.message);
          setMembers([]);
        } else {
          setMembers(
            (data ?? []).map((m) => {
              const profile = m.profiles as unknown as {
                display_name: string;
                email: string | null;
              } | null;
              return {
                user_id: m.user_id as string,
                role: m.role as string,
                display_name: profile?.display_name ?? "成员",
                email: profile?.email ?? null,
              };
            }),
          );
        }
      }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [spaceId, mode]);

  if (typeof document === "undefined") return null;

  const title = mode === "invites" ? "邀请成员" : "成员管理";

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[6vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-muted)] bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--brand-ink)]">
            {title}
          </h2>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        {manageable.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            暂无可管理的空间（需所有者或管理员）
          </p>
        ) : (
          <>
            <label className="mb-3 block text-xs text-[var(--text-muted)]">
              选择空间
              <select
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm"
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
              >
                {manageable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            {loading ? (
              <p className="text-sm text-[var(--text-muted)]">加载中…</p>
            ) : err ? (
              <p className="text-sm text-red-600">{err}</p>
            ) : mode === "invites" && space ? (
              <SpaceInvites
                key={spaceId}
                spaceId={spaceId}
                canManage={canManage}
                initialInvites={invites}
                bare
                onInvitesChange={setInvites}
              />
            ) : mode === "members" && space ? (
              <SpaceMembersPanel
                key={spaceId}
                spaceId={spaceId}
                members={members}
                currentUserId={currentUserId}
                currentRole={space.role}
                isOwner={Boolean(isOwner)}
                bare
              />
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

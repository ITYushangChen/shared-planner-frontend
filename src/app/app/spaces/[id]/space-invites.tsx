"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { generateInviteCode, type InviteRow } from "@/lib/invites";

const INVITE_SELECT =
  "id, code, invite_type, max_uses, used_count, expires_at, status, created_at";

type Props = {
  spaceId: string;
  canManage: boolean;
  initialInvites: InviteRow[];
  /** 弹窗内去掉外框标题 */
  bare?: boolean;
  onInvitesChange?: (invites: InviteRow[]) => void;
};

export function SpaceInvites({
  spaceId,
  canManage,
  initialInvites,
  bare = false,
  onInvitesChange,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [invites, setInvites] = useState(initialInvites);
  const [fetching, setFetching] = useState(true);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [maxUses, setMaxUses] = useState<"1" | "5" | "unlimited">("5");
  const [expireDays, setExpireDays] = useState<"7" | "30" | "never">("7");

  function commitInvites(next: InviteRow[]) {
    setInvites(next);
    onInvitesChange?.(next);
  }

  async function loadInvites() {
    setFetching(true);
    const { data, error } = await supabase
      .from("space_invitations")
      .select(INVITE_SELECT)
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false });
    setFetching(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    commitInvites((data ?? []) as InviteRow[]);
  }

  useEffect(() => {
    let cancelled = false;
    const client = createClient();
    setFetching(true);
    void (async () => {
      const { data, error } = await client
        .from("space_invitations")
        .select(INVITE_SELECT)
        .eq("space_id", spaceId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setFetching(false);
      if (error) {
        setMsg(error.message);
        return;
      }
      const rows = (data ?? []) as InviteRow[];
      setInvites(rows);
      onInvitesChange?.(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId, onInvitesChange]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;

    const hasPending = invites.some((i) => i.status === "pending");
    if (hasPending) {
      setMsg("已有有效邀请码，请先撤销后再生成");
      return;
    }

    setLoading(true);
    setMsg("生成中…");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setMsg("请先登录");
      return;
    }

    const code = generateInviteCode(8);
    const expires_at =
      expireDays === "never"
        ? null
        : new Date(
            Date.now() + Number(expireDays) * 24 * 60 * 60 * 1000,
          ).toISOString();
    const max_uses = maxUses === "unlimited" ? null : Number(maxUses);

    const { data: row, error } = await supabase
      .from("space_invitations")
      .insert({
        space_id: spaceId,
        inviter_id: user.id,
        code,
        invite_type: "code",
        max_uses,
        expires_at,
        status: "pending",
      })
      .select(INVITE_SELECT)
      .single();

    setLoading(false);
    if (error) {
      const dup =
        error.code === "23505" ||
        /unique|duplicate|one_pending/i.test(error.message);
      setMsg(
        dup ? "已有有效邀请码，请先撤销后再生成" : error.message,
      );
      if (dup) void loadInvites();
      return;
    }
    setMsg("邀请码已生成");
    if (row) {
      commitInvites([row as InviteRow, ...invites]);
    } else {
      void loadInvites();
    }
    router.refresh();
  }

  async function onRevoke(id: string) {
    if (!confirm("撤销该邀请码？")) return;
    const { error } = await supabase
      .from("space_invitations")
      .update({ status: "revoked" })
      .eq("id", id);
    if (error) {
      setMsg(error.message);
      return;
    }
    setMsg("邀请码已撤销");
    commitInvites(
      invites.map((i) =>
        i.id === id ? { ...i, status: "revoked" as const } : i,
      ),
    );
    router.refresh();
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setMsg(`已复制：${code}`);
    } catch {
      setMsg(code);
    }
  }

  const pending = invites.filter((i) => i.status === "pending");
  const active = pending[0] ?? null;
  const hasPending = Boolean(active);

  return (
    <section
      className={bare ? "" : "rounded-xl border border-zinc-200 p-5"}
    >
      {bare ? null : (
        <h2 className="text-sm font-medium text-zinc-500">邀请成员</h2>
      )}

      {fetching ? (
        <p className="mt-3 text-sm text-zinc-400">加载邀请码…</p>
      ) : active ? (
        <div className="mt-3 rounded-lg bg-zinc-50 px-3 py-3">
          <p className="text-xs text-zinc-500">当前邀请码</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <code className="text-xl font-semibold tracking-widest text-zinc-900">
              {active.code}
            </code>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs text-zinc-600 underline"
                onClick={() => copyCode(active.code)}
              >
                复制
              </button>
              {canManage ? (
                <button
                  type="button"
                  className="text-xs text-red-600 underline"
                  onClick={() => onRevoke(active.id)}
                >
                  撤销
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            已用 {active.used_count}
            {active.max_uses != null ? ` / ${active.max_uses}` : " / ∞"}
            {active.expires_at
              ? ` · 到期 ${new Date(active.expires_at).toLocaleDateString()}`
              : " · 不过期"}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            分享路径：/app/join?code={active.code}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-400">暂无有效邀请码</p>
      )}

      {canManage ? (
        <form
          onSubmit={onCreate}
          className="mt-3 flex flex-col gap-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-zinc-500">
              可用次数
              <select
                className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm disabled:opacity-50"
                value={maxUses}
                disabled={hasPending || loading || fetching}
                onChange={(e) =>
                  setMaxUses(e.target.value as typeof maxUses)
                }
              >
                <option value="1">一次性</option>
                <option value="5">5 次</option>
                <option value="unlimited">不限</option>
              </select>
            </label>
            <label className="text-xs text-zinc-500">
              有效期
              <select
                className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm disabled:opacity-50"
                value={expireDays}
                disabled={hasPending || loading || fetching}
                onChange={(e) =>
                  setExpireDays(e.target.value as typeof expireDays)
                }
              >
                <option value="7">7 天</option>
                <option value="30">30 天</option>
                <option value="never">不过期</option>
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={loading || hasPending || fetching}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading
              ? "生成中…"
              : hasPending
                ? "请先撤销当前邀请码"
                : "生成邀请码"}
          </button>
          {hasPending ? (
            <p className="text-[11px] text-zinc-400">
              每个空间同时只能有一个有效邀请码，撤销后可再生成
            </p>
          ) : null}
        </form>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">仅所有者/管理员可生成邀请</p>
      )}

      {msg ? <p className="mt-2 text-xs text-zinc-500">{msg}</p> : null}
    </section>
  );
}

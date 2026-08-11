"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type MemberRow = {
  user_id: string;
  role: string;
  display_name: string;
  email: string | null;
};

type Props = {
  spaceId: string;
  members: MemberRow[];
  currentUserId: string;
  currentRole: string;
  isOwner: boolean;
  /** 仅显示退出（普通成员） */
  leaveOnly?: boolean;
  /** 弹窗内去掉外框标题 */
  bare?: boolean;
};

const roleLabel: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
};

export function SpaceMembersPanel({
  spaceId,
  members,
  currentUserId,
  currentRole,
  isOwner,
  leaveOnly = false,
  bare = false,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [transferTo, setTransferTo] = useState("");

  const canManage =
    !leaveOnly && (currentRole === "owner" || currentRole === "admin");
  const transferCandidates = members.filter(
    (m) => m.user_id !== currentUserId && m.role !== "owner",
  );

  async function removeMember(userId: string, name: string) {
    if (!confirm(`确定将「${name}」移出空间？`)) return;
    setLoading(true);
    setMsg("");
    const { error } = await supabase
      .from("space_members")
      .delete()
      .eq("space_id", spaceId)
      .eq("user_id", userId);
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    router.refresh();
  }

  async function leaveSpace() {
    if (isOwner) {
      setMsg("所有者须先转让所有权，才能退出空间");
      return;
    }
    if (!confirm("确定退出该空间？")) return;
    setLoading(true);
    setMsg("");
    const { error } = await supabase
      .from("space_members")
      .delete()
      .eq("space_id", spaceId)
      .eq("user_id", currentUserId);
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    startTransition(() => {
      router.push("/app?view=calendar&range=week");
      router.refresh();
    });
  }

  async function transferOwnership() {
    if (!transferTo) {
      setMsg("请选择新所有者");
      return;
    }
    const target = members.find((m) => m.user_id === transferTo);
    if (!confirm(`确定将所有权转让给「${target?.display_name}」？`)) return;
    setLoading(true);
    setMsg("转让中…");
    const { error } = await supabase.rpc("transfer_space_ownership", {
      p_space_id: spaceId,
      p_new_owner_id: transferTo,
    });
    setLoading(false);
    if (error) {
      setMsg(mapTransferError(error.message));
      return;
    }
    setMsg("已转让所有权");
    setTransferTo("");
    router.refresh();
  }

  if (leaveOnly) {
    return (
      <div>
        <button
          type="button"
          disabled={loading}
          onClick={leaveSpace}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600"
        >
          退出空间
        </button>
        {msg ? <p className="mt-2 text-sm text-zinc-500">{msg}</p> : null}
      </div>
    );
  }

  return (
    <section
      className={bare ? "" : "rounded-xl border border-zinc-200 p-5"}
    >
      {bare ? null : (
        <h2 className="text-sm font-medium text-zinc-500">成员管理</h2>
      )}
      <ul className="mt-3 space-y-2 text-sm text-zinc-800">
        {members.map((m) => {
          const isSelf = m.user_id === currentUserId;
          const canRemove =
            canManage &&
            !isSelf &&
            m.role !== "owner" &&
            !(currentRole === "admin" && m.role === "admin");

          return (
            <li
              key={m.user_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2"
            >
              <span>
                {m.display_name}
                {isSelf ? (
                  <span className="text-zinc-400">（我）</span>
                ) : null}
                {m.email ? (
                  <span className="text-zinc-400"> · {m.email}</span>
                ) : null}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">
                  {roleLabel[m.role] ?? m.role}
                </span>
                {canRemove ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => removeMember(m.user_id, m.display_name)}
                    className="text-xs text-red-600 underline disabled:opacity-50"
                  >
                    移除
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {isOwner ? (
        <div className="mt-4 rounded-lg border border-zinc-200 p-3">
          <p className="text-sm font-medium text-zinc-800">转让所有权</p>
          <p className="mt-1 text-xs text-zinc-400">
            退出前须先将所有权转让给其他成员
          </p>
          {transferCandidates.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-400">
              暂无其他成员可接收所有权
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className="min-w-[10rem] flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
              >
                <option value="">选择新所有者</option>
                {transferCandidates.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={loading || !transferTo}
                onClick={transferOwnership}
                className="rounded-xl bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                确认转让
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          disabled={loading || isOwner}
          onClick={leaveSpace}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
          title={isOwner ? "请先转让所有权" : undefined}
        >
          {isOwner ? "退出空间（请先转让所有权）" : "退出空间"}
        </button>
      </div>

      {msg ? <p className="mt-2 text-sm text-zinc-500">{msg}</p> : null}
    </section>
  );
}

function mapTransferError(message: string) {
  if (message.includes("only owner can transfer")) return "仅所有者可转让";
  if (message.includes("new owner must be a space member"))
    return "新所有者必须是空间成员";
  return message;
}

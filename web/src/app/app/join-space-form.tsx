"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  initialCode?: string;
  compact?: boolean;
  onJoined?: (spaceId: string) => void;
};

export function JoinSpaceForm({
  initialCode = "",
  compact = false,
  onJoined,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [code, setCode] = useState(initialCode);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setMsg("请输入邀请码");
      return;
    }
    setLoading(true);
    setMsg("加入中…");

    const { data, error } = await supabase.rpc("accept_invitation", {
      p_code: trimmed,
    });

    setLoading(false);
    if (error) {
      setMsg(mapInviteError(error.message));
      return;
    }

    const spaceId = data as string;
    setMsg("已加入空间");
    onJoined?.(spaceId);
    router.push(`/app/spaces/${spaceId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      {!compact ? (
        <p className="text-sm text-zinc-500">输入邀请码加入他人空间</p>
      ) : null}
      <input
        className="rounded-lg border border-zinc-200 px-3 py-2 text-sm uppercase tracking-wider outline-none focus:border-zinc-400"
        placeholder="邀请码"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? "加入中…" : "加入空间"}
      </button>
      {msg ? <p className="text-xs text-zinc-500">{msg}</p> : null}
    </form>
  );
}

function mapInviteError(message: string) {
  if (message.includes("invalid invite")) return "邀请码无效或已失效";
  if (message.includes("invite expired")) return "邀请已过期";
  if (message.includes("invite exhausted")) return "邀请次数已用完";
  if (message.includes("not authenticated")) return "请先登录";
  return message;
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { generateInviteCode } from "@/lib/invites";
import {
  SPACE_KINDS,
  SPACE_VISIBILITIES,
  type SpaceKind,
  type SpaceVisibility,
} from "@/lib/spaces";

type Props = {
  onCreated?: (spaceId: string) => void;
  compact?: boolean;
  defaultVisibility?: SpaceVisibility;
};

export function CreateSpaceForm({
  onCreated,
  compact,
  defaultVisibility = "private",
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SpaceKind>("work");
  const [visibility, setVisibility] =
    useState<SpaceVisibility>(defaultVisibility);
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [createdSpaceId, setCreatedSpaceId] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMsg("请填写空间名称");
      return;
    }

    setLoading(true);
    setMsg("创建中…");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setLoading(false);
      setMsg("请先登录");
      return;
    }

    const { data: space, error: spaceError } = await supabase
      .from("spaces")
      .insert({
        name: trimmed,
        description: description.trim() || null,
        owner_id: user.id,
        kind,
        visibility,
      })
      .select("id")
      .single();

    if (spaceError || !space) {
      setLoading(false);
      setMsg(
        spaceError?.message.includes("visibility")
          ? "创建失败：请先在 Supabase 执行 spaces.visibility 迁移 SQL"
          : spaceError?.message.includes("kind")
            ? "创建失败：请先执行 spaces.kind 迁移 SQL"
            : spaceError?.message || "创建空间失败",
      );
      return;
    }

    const { error: memberError } = await supabase.from("space_members").insert({
      space_id: space.id,
      user_id: user.id,
      role: "owner",
    });

    if (memberError) {
      setLoading(false);
      setMsg(memberError.message);
      return;
    }

    let code: string | null = null;
    if (visibility === "public") {
      code = generateInviteCode(8);
      const { error: invErr } = await supabase.from("space_invitations").insert({
        space_id: space.id,
        inviter_id: user.id,
        code,
        invite_type: "code",
        max_uses: 20,
        expires_at: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        status: "pending",
      });
      if (invErr) {
        setLoading(false);
        setMsg(`空间已创建，但邀请码失败：${invErr.message}`);
        setCreatedSpaceId(space.id);
        return;
      }
    }

    setLoading(false);
    setName("");
    setDescription("");
    setCreatedSpaceId(space.id);

    if (code) {
      setInviteCode(code);
      setMsg("公共空间已创建，请复制邀请码");
    } else {
      setMsg("创建成功");
      onCreated?.(space.id);
      router.push(`/app/spaces/${space.id}`);
      router.refresh();
    }
  }

  async function copyInvite() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setMsg(`已复制：${inviteCode}`);
    } catch {
      setMsg(inviteCode);
    }
  }

  function closeInviteAndGo() {
    const id = createdSpaceId;
    setInviteCode(null);
    if (id) {
      onCreated?.(id);
      router.push(`/app/spaces/${id}`);
      router.refresh();
    }
  }

  if (inviteCode) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h3 className="text-base font-semibold text-zinc-900">邀请码已生成</h3>
        <p className="text-sm text-zinc-500">
          公共空间可分享此码邀请成员加入
        </p>
        <code className="rounded-lg bg-zinc-100 px-3 py-3 text-center text-xl font-semibold tracking-widest text-zinc-900">
          {inviteCode}
        </code>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyInvite}
            className="flex-1 rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800"
          >
            复制
          </button>
          <button
            type="button"
            onClick={closeInviteAndGo}
            className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          >
            关闭
          </button>
        </div>
        {msg ? <p className="text-xs text-zinc-500">{msg}</p> : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={
        compact
          ? "flex flex-col gap-3"
          : "mt-4 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4"
      }
    >
      {!compact ? (
        <>
          <h3 className="text-sm font-medium text-zinc-800">新建空间</h3>
          <p className="text-xs text-zinc-500">
            可选择私人或公共；公共空间创建后可生成邀请码
          </p>
        </>
      ) : null}

      <label className="text-sm text-zinc-700">
        名称
        <input
          className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 outline-none focus:border-zinc-400"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：产品研发 / 家庭日程"
          maxLength={100}
          required
        />
      </label>

      <fieldset className="rounded-lg border border-zinc-200 bg-white p-3">
        <legend className="px-1 text-sm text-zinc-700">空间性质</legend>
        <div className="flex gap-3">
          {SPACE_VISIBILITIES.map((v) => (
            <label
              key={v.value}
              className="flex items-center gap-2 text-sm text-zinc-700"
            >
              <input
                type="radio"
                name="visibility"
                checked={visibility === v.value}
                onChange={() => setVisibility(v.value)}
              />
              {v.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">
          {visibility === "public"
            ? "公共：创建后自动生成邀请码（可复制 / 关闭）"
            : "私人：仅成员可见，可稍后在空间内生成邀请码"}
        </p>
      </fieldset>

      <label className="text-sm text-zinc-700">
        类型（kind）
        <select
          className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 outline-none focus:border-zinc-400"
          value={kind}
          onChange={(e) => setKind(e.target.value as SpaceKind)}
        >
          {SPACE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm text-zinc-700">
        描述（可选）
        <textarea
          className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 outline-none focus:border-zinc-400"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="这个空间用来做什么"
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? "创建中…" : "创建空间"}
      </button>

      {msg ? <p className="text-sm text-zinc-600">{msg}</p> : null}
    </form>
  );
}

"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  email: string;
  initialDisplayName: string;
  initialTimezone: string;
  initialAvatarUrl?: string;
};

const TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
];

export function ProfileForm({
  email,
  initialDisplayName,
  initialTimezone,
  initialAvatarUrl = "",
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function onUploadFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg("请选择图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMsg("图片需小于 5MB");
      return;
    }

    setUploading(true);
    setMsg("上传中…");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploading(false);
      setMsg("请先登录");
      return;
    }

    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : file.type === "image/gif"
            ? "gif"
            : "jpg";
    const path = `${user.id}/avatar/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("backgrounds")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upErr) {
      setUploading(false);
      setMsg(
        upErr.message.includes("Bucket not found")
          ? "未找到 backgrounds 存储桶，请先执行 storage 迁移 SQL"
          : upErr.message,
      );
      return;
    }

    const { data } = supabase.storage.from("backgrounds").getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
    setUploading(false);
    setMsg("图片已上传，请点保存生效");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg("保存中…");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setMsg("请先登录");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim() || email.split("@")[0] || "User",
        email: email || user.email,
        timezone,
        avatar_url: avatarUrl.trim() || null,
      })
      .eq("id", user.id);

    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setMsg("已保存");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="rounded-lg bg-zinc-50 px-3 py-2">
        <p className="text-xs text-zinc-500">账号绑定</p>
        <p className="mt-1 text-sm font-medium text-zinc-900">
          {displayName.trim() || "未设置昵称"}
          {email ? (
            <span className="font-normal text-zinc-500"> · {email}</span>
          ) : null}
        </p>
        <p className="mt-1 text-[11px] text-zinc-400">
          昵称用于空间内显示；邮箱为登录账号，不可在此修改
        </p>
      </div>

      <label className="text-sm text-zinc-700">
        昵称
        <input
          className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-zinc-400"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={email.split("@")[0] || "昵称"}
          required
        />
      </label>

      <div className="space-y-2">
        <p className="text-sm text-zinc-700">头像</p>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand hover:text-white">
            {uploading ? "上传中…" : "选择本地图片"}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              disabled={uploading || loading}
              onChange={(e) => void onUploadFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {avatarUrl ? (
            <button
              type="button"
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-50"
              onClick={() => setAvatarUrl("")}
              disabled={uploading || loading}
            >
              清除图片
            </button>
          ) : null}
        </div>
        <label className="block text-sm text-zinc-700">
          或粘贴图片 URL
          <input
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-zinc-400"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://… 或留空"
          />
        </label>
        {avatarUrl.trim() ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl.trim()}
            alt="头像预览"
            className="h-14 w-14 rounded-full border border-zinc-200 object-cover"
          />
        ) : null}
      </div>

      <label className="text-sm text-zinc-700">
        绑定邮箱
        <input
          className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-600"
          value={email}
          readOnly
          disabled
        />
      </label>

      <label className="text-sm text-zinc-700">
        时区
        <select
          className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={loading || uploading}
        className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
      >
        保存
      </button>
      {msg ? <p className="text-sm text-zinc-500">{msg}</p> : null}
    </form>
  );
}

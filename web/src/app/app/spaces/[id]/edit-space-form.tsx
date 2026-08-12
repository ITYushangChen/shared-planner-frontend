"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  SPACE_KINDS,
  SPACE_VISIBILITIES,
  type SpaceKind,
  type SpaceVisibility,
  isSpaceKind,
} from "@/lib/spaces";
import {
  BG_POSITION_OPTIONS,
  BG_SIZE_OPTIONS,
  DEFAULT_BG_OPACITY,
  DEFAULT_BG_POSITION,
  DEFAULT_BG_SIZE,
  parseUiPrefs,
} from "@/lib/ui-prefs";
import { useUiPrefs } from "../../ui-prefs-provider";

type Props = {
  spaceId: string;
  initialName: string;
  initialKind: string;
  initialDescription: string | null;
  initialVisibility?: string;
  canEdit: boolean;
};

export function EditSpaceForm({
  spaceId,
  initialName,
  initialKind,
  initialDescription,
  initialVisibility = "private",
  canEdit,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { spacePrefsById } = useUiPrefs();
  const prefs = spacePrefsById[spaceId];
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<SpaceKind>(
    isSpaceKind(initialKind) ? initialKind : "other",
  );
  const [visibility, setVisibility] = useState<SpaceVisibility>(
    initialVisibility === "public" ? "public" : "private",
  );
  const [description, setDescription] = useState(initialDescription ?? "");
  const [bgImageUrl, setBgImageUrl] = useState(
    prefs?.bgImageUrl?.trim() ?? "",
  );
  const [bgOpacity, setBgOpacity] = useState(
    typeof prefs?.bgOpacity === "number" && !Number.isNaN(prefs.bgOpacity)
      ? prefs.bgOpacity
      : DEFAULT_BG_OPACITY,
  );
  const [bgSize, setBgSize] = useState(
    prefs?.bgSize?.trim() || DEFAULT_BG_SIZE,
  );
  const [bgPosition, setBgPosition] = useState(
    prefs?.bgPosition?.trim() || DEFAULT_BG_POSITION,
  );
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  if (!canEdit) {
    return (
      <p className="mt-4 text-sm text-zinc-500">
        仅空间所有者或管理员可修改名称与类型。
      </p>
    );
  }

  async function onUploadFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg("请选择图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMsg("图片请小于 5MB");
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
    const path = `${user.id}/${spaceId}/${Date.now()}.${ext}`;

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
    setBgImageUrl(data.publicUrl);
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
      setMsg("未登录");
      return;
    }

    const { error: spaceError } = await supabase
      .from("spaces")
      .update({
        name: name.trim(),
        kind,
        visibility,
        description: description.trim() || null,
      })
      .eq("id", spaceId);

    if (spaceError) {
      setLoading(false);
      setMsg(
        spaceError.message.includes("visibility")
          ? "请先执行 spaces.visibility 迁移 SQL"
          : spaceError.message,
      );
      return;
    }

    const { data: memberRow } = await supabase
      .from("space_members")
      .select("ui_prefs")
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    const hasBg = Boolean(bgImageUrl.trim());
    const nextPrefs = {
      ...parseUiPrefs(memberRow?.ui_prefs),
      bgImageUrl: hasBg ? bgImageUrl.trim() : null,
      bgOpacity: hasBg ? bgOpacity : null,
      bgSize: hasBg ? bgSize.trim() || DEFAULT_BG_SIZE : null,
      bgPosition: hasBg ? bgPosition.trim() || DEFAULT_BG_POSITION : null,
    };

    const { error: prefsError } = await supabase
      .from("space_members")
      .update({ ui_prefs: nextPrefs })
      .eq("space_id", spaceId)
      .eq("user_id", user.id);

    setLoading(false);
    if (prefsError) {
      setMsg(prefsError.message);
      return;
    }
    setMsg("已保存");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          <label className="text-sm text-zinc-700">
            名称
            <input
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-zinc-400"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <div className="space-y-2">
            <p className="text-sm text-zinc-700">背景图片</p>
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
              {bgImageUrl ? (
                <button
                  type="button"
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => setBgImageUrl("")}
                >
                  清除图片
                </button>
              ) : null}
            </div>
            <label className="block text-sm text-zinc-700">
              或粘贴图片 URL
              <input
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-zinc-400"
                value={bgImageUrl}
                onChange={(e) => setBgImageUrl(e.target.value)}
                placeholder="https://… 或留空"
              />
            </label>
            {bgImageUrl.trim() ? (
              <div
                className="relative h-28 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100"
                style={{
                  backgroundImage: `url(${bgImageUrl.trim()})`,
                  backgroundSize: bgSize,
                  backgroundPosition: bgPosition,
                  backgroundRepeat: "no-repeat",
                  opacity: bgOpacity,
                }}
                role="img"
                aria-label="空间背景预览"
              />
            ) : null}
            <label className="block text-sm text-zinc-700">
              图片透明度 {Math.round(bgOpacity * 100)}%
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                className="mt-1 w-full accent-[var(--brand)]"
                value={bgOpacity}
                onChange={(e) => setBgOpacity(Number(e.target.value))}
                disabled={!bgImageUrl.trim()}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm text-zinc-700">
                图片大小
                <select
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm disabled:opacity-50"
                  value={bgSize}
                  onChange={(e) => setBgSize(e.target.value)}
                  disabled={!bgImageUrl.trim()}
                >
                  {BG_SIZE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-zinc-700">
                图片位置
                <select
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm disabled:opacity-50"
                  value={bgPosition}
                  onChange={(e) => setBgPosition(e.target.value)}
                  disabled={!bgImageUrl.trim()}
                >
                  {BG_POSITION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <fieldset className="rounded-lg border border-zinc-200 p-3">
            <legend className="px-1 text-sm text-zinc-700">私人 / 公共</legend>
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
          </fieldset>

          <label className="text-sm text-zinc-700">
            类型（kind）
            <select
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-zinc-400"
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
            描述
            <textarea
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-zinc-400"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {msg ? <p className="mb-2 text-sm text-zinc-600">{msg}</p> : null}
        <button
          type="submit"
          disabled={loading || uploading}
          className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          保存修改
        </button>
      </div>
    </form>
  );
}

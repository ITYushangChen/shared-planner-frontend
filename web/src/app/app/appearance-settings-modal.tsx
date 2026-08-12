"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BG_POSITION_OPTIONS,
  BG_SIZE_OPTIONS,
  DEFAULT_BG_COLOR,
  DEFAULT_BG_OPACITY,
  DEFAULT_BG_POSITION,
  DEFAULT_BG_SIZE,
  DEFAULT_PRIORITY_COLORS,
  DEFAULT_TASK_OPACITY,
  mergePriorityColors,
  parseUiPrefs,
  resolveTaskOpacity,
  type UiPrefs,
} from "@/lib/ui-prefs";
import type { SpaceNavItem } from "@/lib/todos";
import { primaryBtnClass } from "./ui-btn-class";

type Scope = "global" | string;

type Props = {
  spaces: SpaceNavItem[];
  initialGlobalPrefs?: unknown;
  initialSpacePrefsById?: Record<string, unknown>;
  /** 左侧图标轨触发 */
  rail?: boolean;
  className?: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function AppearanceSettingsModal({
  spaces,
  initialGlobalPrefs,
  initialSpacePrefsById = {},
  rail = false,
  className,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("global");
  const [bgColor, setBgColor] = useState(DEFAULT_BG_COLOR);
  const [bgImageUrl, setBgImageUrl] = useState("");
  const [bgOpacity, setBgOpacity] = useState(DEFAULT_BG_OPACITY);
  const [bgSize, setBgSize] = useState(DEFAULT_BG_SIZE);
  const [bgPosition, setBgPosition] = useState(DEFAULT_BG_POSITION);
  const [high, setHigh] = useState(DEFAULT_PRIORITY_COLORS.high);
  const [medium, setMedium] = useState(DEFAULT_PRIORITY_COLORS.medium);
  const [low, setLow] = useState(DEFAULT_PRIORITY_COLORS.low);
  const [taskOpacity, setTaskOpacity] = useState(DEFAULT_TASK_OPACITY);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  function loadIntoForm(prefs: UiPrefs, includePriority: boolean) {
    setBgColor(prefs.bgColor?.trim() || DEFAULT_BG_COLOR);
    setBgImageUrl(prefs.bgImageUrl?.trim() || "");
    setBgOpacity(
      typeof prefs.bgOpacity === "number"
        ? prefs.bgOpacity
        : DEFAULT_BG_OPACITY,
    );
    setBgSize(prefs.bgSize?.trim() || DEFAULT_BG_SIZE);
    setBgPosition(prefs.bgPosition?.trim() || DEFAULT_BG_POSITION);
    if (includePriority) {
      const pc = mergePriorityColors(prefs);
      setHigh(pc.high);
      setMedium(pc.medium);
      setLow(pc.low);
      setTaskOpacity(resolveTaskOpacity(prefs));
    }
  }

  useEffect(() => {
    if (!open) return;
    if (scope === "global") {
      loadIntoForm(parseUiPrefs(initialGlobalPrefs), true);
    } else {
      loadIntoForm(parseUiPrefs(initialSpacePrefsById[scope]), false);
    }
  }, [open, scope, initialGlobalPrefs, initialSpacePrefsById]);

  async function onUploadFile(file: File | null) {
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      setMsg("仅支持 JPG / PNG / WebP / GIF");
      return;
    }
    if (file.size > MAX_BYTES) {
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
    const folder = scope === "global" ? "global" : scope;
    const path = `${user.id}/${folder}/${Date.now()}.${ext}`;

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

  async function onSave(e: FormEvent) {
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

    const bgPatch: UiPrefs = {
      bgColor: bgColor.trim() || null,
      bgImageUrl: bgImageUrl.trim() || null,
      bgOpacity,
      bgSize: bgSize.trim() || DEFAULT_BG_SIZE,
      bgPosition: bgPosition.trim() || DEFAULT_BG_POSITION,
    };

    if (scope === "global") {
      const next: UiPrefs = {
        ...parseUiPrefs(initialGlobalPrefs),
        ...bgPatch,
        priorityColors: { high, medium, low },
        taskOpacity,
      };
      const { error } = await supabase
        .from("profiles")
        .update({ ui_prefs: next })
        .eq("id", user.id);
      setLoading(false);
      if (error) {
        setMsg(error.message);
        return;
      }
    } else {
      const next: UiPrefs = {
        ...parseUiPrefs(initialSpacePrefsById[scope]),
        ...bgPatch,
      };
      const { error } = await supabase
        .from("space_members")
        .update({ ui_prefs: next })
        .eq("space_id", scope)
        .eq("user_id", user.id);
      setLoading(false);
      if (error) {
        setMsg(error.message);
        return;
      }
    }

    setMsg("已保存");
    router.refresh();
    setTimeout(() => setOpen(false), 400);
  }

  async function onClearSpace() {
    if (scope === "global") return;
    if (!confirm("清除该空间的自定义背景，恢复全局/默认？")) return;
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { error } = await supabase
      .from("space_members")
      .update({ ui_prefs: {} })
      .eq("space_id", scope)
      .eq("user_id", user.id);
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setBgImageUrl("");
    setMsg("已清除空间背景");
    router.refresh();
  }

  const overlay =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <form
              onSubmit={onSave}
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--brand-ink)]">
                外观设置
              </h2>
              <button
                type="button"
                className="text-sm text-[var(--text-muted)] hover:text-brand"
                onClick={() => setOpen(false)}
              >
                关闭
              </button>
            </div>

            <label className="block text-xs text-[var(--text-muted)]">
              应用范围
              <select
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm"
                value={scope}
                onChange={(e) => setScope(e.target.value as Scope)}
              >
                <option value="global">全部空间（全局默认）</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    仅「{s.name}」
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              背景图会铺在整页（含左侧栏）；侧栏半透明以透出图片
            </p>

            <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
              <label className="text-xs text-[var(--text-muted)]">
                背景颜色（图片下层）
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  placeholder={DEFAULT_BG_COLOR}
                />
              </label>
              <input
                type="color"
                className="h-10 w-12 cursor-pointer rounded border border-[var(--border-muted)]"
                value={
                  /^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor : DEFAULT_BG_COLOR
                }
                onChange={(e) => setBgColor(e.target.value)}
              />
            </div>

            <div className="mt-3 space-y-2">
              <p className="text-xs text-[var(--text-muted)]">背景图片</p>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand hover:text-white">
                  {uploading ? "上传中…" : "选择本地图片"}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={uploading || loading}
                    onChange={(e) =>
                      void onUploadFile(e.target.files?.[0] ?? null)
                    }
                  />
                </label>
                {bgImageUrl ? (
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border-muted)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"
                    onClick={() => setBgImageUrl("")}
                  >
                    清除图片
                  </button>
                ) : null}
              </div>
              <label className="block text-xs text-[var(--text-muted)]">
                或粘贴图片 URL
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm"
                  value={bgImageUrl}
                  onChange={(e) => setBgImageUrl(e.target.value)}
                  placeholder="https://… 或留空"
                />
              </label>

              {bgImageUrl ? (
                <div
                  className="relative mt-1 h-28 overflow-hidden rounded-lg border border-[var(--border-muted)]"
                  style={{ backgroundColor: bgColor }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <div
                    className="absolute inset-0"
                    style={{
                      opacity: bgOpacity,
                      backgroundImage: `url(${bgImageUrl})`,
                      backgroundSize: bgSize,
                      backgroundPosition: bgPosition,
                      backgroundRepeat: "no-repeat",
                    }}
                  />
                </div>
              ) : null}

              <label className="block text-xs text-[var(--text-muted)]">
                图片透明度 {Math.round(bgOpacity * 100)}%
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  className="mt-1 w-full accent-[var(--brand)]"
                  value={bgOpacity}
                  onChange={(e) => setBgOpacity(Number(e.target.value))}
                  disabled={!bgImageUrl}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-[var(--text-muted)]">
                  图片大小
                  <select
                    className="mt-1 w-full rounded-lg border border-[var(--border-muted)] px-2 py-1.5 text-sm disabled:opacity-50"
                    value={bgSize}
                    onChange={(e) => setBgSize(e.target.value)}
                    disabled={!bgImageUrl}
                  >
                    {BG_SIZE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)]">
                  图片位置
                  <select
                    className="mt-1 w-full rounded-lg border border-[var(--border-muted)] px-2 py-1.5 text-sm disabled:opacity-50"
                    value={bgPosition}
                    onChange={(e) => setBgPosition(e.target.value)}
                    disabled={!bgImageUrl}
                  >
                    {BG_POSITION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                支持 JPG/PNG/WebP/GIF，最大 5MB；调整后需点「保存」
              </p>
            </div>

            {scope === "global" ? (
              <>
              <div className="mt-4 space-y-2 rounded-xl border border-[var(--border-muted)] p-3">
                <p className="text-xs font-medium text-[var(--brand-ink)]">
                  默认优先级颜色（创建/编辑可再改单条）
                </p>
                {(
                  [
                    ["重要", high, setHigh],
                    ["中（兼容）", medium, setMedium],
                    ["不重要", low, setLow],
                  ] as const
                ).map(([label, val, set]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-sm text-[var(--text-secondary)]">
                      {label}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="w-24 rounded border border-[var(--border-muted)] px-2 py-1 text-xs"
                        value={val}
                        onChange={(e) => set(e.target.value)}
                      />
                      <input
                        type="color"
                        className="h-8 w-10 cursor-pointer rounded border"
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(val)
                            ? val
                            : DEFAULT_PRIORITY_COLORS.medium
                        }
                        onChange={(e) => set(e.target.value)}
                      />
                    </div>
                  </div>
                ))}
                <label className="mt-2 block text-sm text-[var(--text-secondary)]">
                  任务颜色透明度 {Math.round(taskOpacity * 100)}%
                  <input
                    type="range"
                    min={0.15}
                    max={1}
                    step={0.05}
                    className="mt-1 w-full accent-[var(--brand)]"
                    value={taskOpacity}
                    onChange={(e) => setTaskOpacity(Number(e.target.value))}
                  />
                  <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                    控制日历任务条底色透明度，保存后生效
                  </span>
                </label>
              </div>
              </>
            ) : (
              <button
                type="button"
                className="mt-3 text-xs text-[var(--text-muted)] underline"
                onClick={() => void onClearSpace()}
              >
                清除本空间背景覆盖
              </button>
            )}

            <button
              type="submit"
              disabled={loading || uploading}
              className={`${primaryBtnClass("mt-4 w-full")} disabled:opacity-50`}
            >
              {loading ? "保存中…" : "保存"}
            </button>
            {msg ? (
              <p className="mt-2 text-xs text-[var(--text-muted)]">{msg}</p>
            ) : null}
            </form>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        title="外观设置"
        aria-label="外观设置"
        onClick={() => setOpen(true)}
        className={
          className ??
          (rail
            ? "mb-1 flex h-10 w-10 items-center justify-center rounded-lg text-white transition-colors duration-200 hover:bg-white/15"
            : "w-full rounded-xl border border-[#2f5f8f]/55 bg-white/90 px-3 py-2 text-left text-sm font-medium text-[#2f5f8f] transition-all duration-200 hover:bg-[#e8f0f7]")
        }
      >
        {rail ? <AppearanceGearIcon /> : "外观设置"}
      </button>
      {overlay}
    </>
  );
}

function AppearanceGearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M19.4 13a7.6 7.6 0 0 0 .05-2l2.05-1.6-2-3.46-2.45 1a7.7 7.7 0 0 0-1.73-1L14.9 2h-4l-.42 2.94a7.7 7.7 0 0 0-1.73 1l-2.45-1-2 3.46L6.4 11a7.6 7.6 0 0 0 0 2l-2.05 1.6 2 3.46 2.45-1a7.7 7.7 0 0 0 1.73 1L10.9 22h4l.42-2.94a7.7 7.7 0 0 0 1.73-1l2.45 1 2-3.46L19.4 13Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

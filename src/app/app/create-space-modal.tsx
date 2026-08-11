"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { SpaceVisibility } from "@/lib/spaces";

const CreateSpaceForm = dynamic(
  () =>
    import("./create-space-form").then((m) => ({ default: m.CreateSpaceForm })),
  { ssr: false },
);

type Props = {
  iconOnly?: boolean;
  /** 左侧图标轨：白字图标按钮 */
  rail?: boolean;
  defaultVisibility?: SpaceVisibility;
  /** 隐藏底部全宽按钮时用图标触发 */
  hideDefaultTrigger?: boolean;
  className?: string;
};

export function CreateSpaceModal({
  iconOnly = false,
  rail = false,
  defaultVisibility = "private",
  hideDefaultTrigger = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  const overlay =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-zinc-900">
                  新建空间
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-zinc-500 hover:text-zinc-800"
                >
                  关闭
                </button>
              </div>
              <CreateSpaceForm
                compact
                defaultVisibility={defaultVisibility}
                onCreated={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  if (rail) {
    return (
      <>
        <button
          type="button"
          title="新建空间"
          aria-label="新建空间"
          onClick={() => setOpen(true)}
          className={
            className ??
            "mb-1 flex h-10 w-10 items-center justify-center rounded-lg text-lg font-medium text-white transition-colors duration-200 hover:bg-white/15"
          }
        >
          +
        </button>
        {overlay}
      </>
    );
  }

  if (iconOnly || hideDefaultTrigger) {
    return (
      <>
        <button
          type="button"
          title="新建空间"
          aria-label="新建空间"
          onClick={() => setOpen(true)}
          className={
            className ??
            "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-muted)] bg-[var(--surface-muted)] text-lg font-medium text-[var(--brand-ink)] transition-colors hover:bg-white"
          }
        >
          +
        </button>
        {overlay}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl bg-zinc-900 px-3 py-2.5 text-left text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 active:scale-[0.99]"
      >
        + 新建空间
      </button>
      {overlay}
    </>
  );
}

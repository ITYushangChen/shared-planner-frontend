"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";

const JoinSpaceForm = dynamic(
  () =>
    import("./join-space-form").then((m) => ({ default: m.JoinSpaceForm })),
  { ssr: false },
);

type Props = {
  /** 手机抽屉：紧凑文字按钮 */
  compact?: boolean;
  /** 左侧图标轨 */
  rail?: boolean;
  className?: string;
};

export function JoinSpaceModal({
  compact = false,
  rail = false,
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
                  加入空间
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-zinc-500 hover:text-zinc-800"
                >
                  关闭
                </button>
              </div>
              <JoinSpaceForm compact onJoined={() => setOpen(false)} />
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        title="输入邀请码加入"
        aria-label="输入邀请码加入"
        onClick={() => setOpen(true)}
        className={
          className ??
          (rail
            ? "mb-1 flex h-10 w-10 items-center justify-center rounded-lg text-white transition-colors duration-200 hover:bg-white/15"
            : compact
              ? "w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[#2f5f8f] transition-colors hover:bg-[#e8f0f7]"
              : "w-full rounded-xl border border-[#2f5f8f]/55 bg-white px-3 py-2 text-left text-sm font-medium text-[#2f5f8f] transition-all duration-200 hover:bg-[#e8f0f7]")
        }
      >
        {rail ? <JoinRailIcon /> : compact ? "加入空间" : "输入邀请码加入"}
      </button>
      {overlay}
    </>
  );
}

function JoinRailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 3h4a2 2 0 0 1 2 2v4M10 14l11-11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

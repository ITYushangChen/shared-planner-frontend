"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { SpaceNavItem } from "@/lib/todos";
import { toggleBtnClass } from "./toggle-btn-class";

const AiAssistant = dynamic(
  () => import("./ai-assistant").then((m) => ({ default: m.AiAssistant })),
  { ssr: false },
);

type Props = {
  spaces: SpaceNavItem[];
  defaultSpaceId?: string;
  timezone?: string;
  buttonClassName?: string;
  label?: string;
};

/** 标题旁「AI 助手」旁路按钮 → 弹层 */
export function AiAssistantButton({
  spaces,
  defaultSpaceId,
  timezone,
  buttonClassName,
  label = "AI 助手",
}: Props) {
  const [open, setOpen] = useState(false);
  const spaceId = defaultSpaceId || spaces[0]?.id || "";

  if (spaces.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClassName ?? toggleBtnClass(open)}
      >
        {label}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  AI 助手
                </h2>
                <p className="text-xs text-zinc-500">
                  按空间创建、排期、检测冲突
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <AiAssistant
                key={spaceId || "none"}
                spaces={spaces}
                defaultSpaceId={spaceId}
                timezone={timezone}
                plain
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

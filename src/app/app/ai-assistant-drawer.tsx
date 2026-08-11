"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { SpaceNavItem } from "@/lib/todos";

const AiAssistant = dynamic(
  () => import("./ai-assistant").then((m) => ({ default: m.AiAssistant })),
  { ssr: false },
);

type Props = {
  spaces: SpaceNavItem[];
  timezone?: string;
  /** 侧栏完整按钮 / 移动底栏紧凑 */
  variant?: "nav" | "mobile";
};

export function AiAssistantDrawer({
  spaces,
  timezone,
  variant = "nav",
}: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const defaultSpaceId = useMemo(() => {
    const m = pathname.match(/^\/app\/spaces\/([^/]+)/);
    return m?.[1] || spaces[0]?.id || "";
  }, [pathname, spaces]);

  return (
    <>
      {variant === "mobile" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-1 py-3 text-center text-sm text-zinc-500"
        >
          AI
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 w-full rounded-xl bg-white px-3 py-2.5 text-left text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 transition hover:bg-zinc-100"
        >
          AI 助手
          <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
            按空间创建 / 排期 / 冲突
          </span>
        </button>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex justify-end bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  AI 助手
                </h2>
                <p className="text-xs text-zinc-500">
                  选择空间后可创建、排期、检测冲突
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <AiAssistant
                key={defaultSpaceId || "none"}
                spaces={spaces}
                defaultSpaceId={defaultSpaceId}
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

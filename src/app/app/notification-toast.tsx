"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { newId } from "@/lib/id";
import { createClient } from "@/lib/supabase/client";
import {
  NOTIFICATION_TOAST,
  type NotificationToastDetail,
} from "@/lib/notify-events";

type ToastItem = {
  id: string;
  title: string;
  body: string | null;
};

/** 新通知到达时顶部弹出（本机事件 + Realtime） */
export function NotificationToast() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const supabase = createClient();
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const lastKeyRef = useRef<string>("");
  const lastAtRef = useRef(0);

  function showToast(item: ToastItem) {
    if (pathnameRef.current.startsWith("/app/notifications")) return;
    const key = `${item.title}|${item.body ?? ""}`;
    const now = Date.now();
    // 本机事件与 Realtime 可能连发，2 秒内去重
    if (key === lastKeyRef.current && now - lastAtRef.current < 2000) return;
    lastKeyRef.current = key;
    lastAtRef.current = now;
    setToast(item);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 6000);
  }

  // 本机立刻弹出（冲突检测等，不依赖 Realtime / 延迟挂载）
  useEffect(() => {
    function onLocal(ev: Event) {
      if (document.visibilityState === "hidden") return;
      const detail = (ev as CustomEvent<NotificationToastDetail>).detail;
      if (!detail?.title) return;
      showToast({
        id: detail.id ?? `local-${Date.now()}`,
        title: detail.title,
        body: detail.body ?? null,
      });
    }
    window.addEventListener(NOTIFICATION_TOAST, onLocal);
    return () => window.removeEventListener(NOTIFICATION_TOAST, onLocal);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let userId: string | null = null;

    async function setup() {
      if (document.visibilityState === "hidden") return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      userId = user.id;

      const name = `notifications-toast-${user.id}-${newId()}`;
      const ch = supabase
        .channel(name)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (document.visibilityState === "hidden") return;
            const row = payload.new as {
              id: string;
              title: string;
              body: string | null;
            };
            showToast({
              id: row.id,
              title: row.title,
              body: row.body,
            });
          },
        );

      if (cancelled) {
        void supabase.removeChannel(ch);
        return;
      }
      channel = ch;
      ch.subscribe();
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        if (channel) {
          void supabase.removeChannel(channel);
          channel = null;
        }
        return;
      }
      if (!channel) void setup();
    }

    // Realtime 稍晚再连，减轻首屏；本机 Toast 事件不受影响
    delayTimer = setTimeout(() => {
      void setup();
    }, 2000);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (delayTimer) clearTimeout(delayTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (channel) void supabase.removeChannel(channel);
      void userId;
    };
  }, [supabase]);

  if (!toast) return null;

  return (
    <div className="fixed inset-x-3 top-14 z-[80] mx-auto max-w-md md:inset-x-auto md:right-4 md:top-4 md:left-auto">
      <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-xl ring-1 ring-black/5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-zinc-500">新消息</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-900">
              {toast.title}
            </p>
            {toast.body ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">
                {toast.body}
              </p>
            ) : null}
            <Link
              href="/app/notifications"
              prefetch
              className="mt-2 inline-block text-xs font-medium text-sky-700 underline"
              onClick={() => setToast(null)}
            >
              查看消息中心
            </Link>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-lg text-zinc-400 hover:bg-zinc-100"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

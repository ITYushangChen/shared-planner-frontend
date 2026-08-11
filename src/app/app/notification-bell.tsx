"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  NOTIFICATIONS_CHANGED,
  type NotificationsChangedDetail,
} from "@/lib/notify-events";

type BellProps = {
  iconOnly?: boolean;
  /** 青绿图标栏内：仅图标+角标，外层自行包 Link */
  rail?: boolean;
  /** 是否订阅 Realtime（多实例时只开一个，默认 true） */
  subscribe?: boolean;
};

/** 侧栏/顶栏：未读通知 + 待处理冲突角标 */
export function NotificationBell({
  iconOnly = false,
  rail = false,
  subscribe = true,
}: BellProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const [unread, setUnread] = useState(0);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [notesRes, conflictsRes] = await Promise.all([
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false),
      supabase
        .from("conflict_resolutions")
        .select("id", { count: "exact", head: true })
        .or(`user_id.eq.${user.id},creator_id.eq.${user.id}`)
        .in("status", ["pending", "escalated"]),
    ]);

    const noteCount = notesRes.count ?? 0;
    const conflictCount = conflictsRes.count ?? 0;
    setUnread(noteCount + conflictCount);
  }, [supabase]);

  loadRef.current = load;

  useEffect(() => {
    void load();
  }, [load, pathname]);

  useEffect(() => {
    let verifyTimer: ReturnType<typeof setTimeout> | null = null;
    function onChanged(ev: Event) {
      const detail = (ev as CustomEvent<NotificationsChangedDetail>).detail;
      // 仅「通知已全部已读」时用 notesUnread=0 乐观更新，冲突数仍要查库
      if (detail?.notesCleared) {
        if (verifyTimer) clearTimeout(verifyTimer);
        void loadRef.current();
        return;
      }
      if (typeof detail?.unread === "number") {
        setUnread(detail.unread);
        if (verifyTimer) clearTimeout(verifyTimer);
        verifyTimer = setTimeout(() => {
          void loadRef.current();
        }, 200);
        return;
      }
      void loadRef.current();
    }
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
      if (verifyTimer) clearTimeout(verifyTimer);
    };
  }, []);

  useEffect(() => {
    if (!subscribe) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;

    async function setup() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const name = `notifications-bell-${user.id}-${rail ? "rail" : "mobile"}`;
      const ch = supabase
        .channel(name)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void loadRef.current();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conflict_resolutions",
          },
          () => {
            void loadRef.current();
          },
        );

      if (cancelled) {
        void supabase.removeChannel(ch);
        return;
      }
      channel = ch;
      ch.subscribe();
    }

    delayTimer = setTimeout(() => {
      void setup();
    }, 500);

    return () => {
      cancelled = true;
      if (delayTimer) clearTimeout(delayTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, subscribe, rail]);

  const icon = (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9"
      />
    </svg>
  );

  const badge =
    unread > 0 ? (
      <span
        className={
          iconOnly || rail
            ? "absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white"
            : "ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white"
        }
      >
        {unread > 9 ? "9+" : unread}
      </span>
    ) : null;

  if (rail) {
    return (
      <span className="relative inline-flex text-white" aria-hidden>
        {icon}
        {badge}
      </span>
    );
  }

  return (
    <Link
      href="/app/notifications"
      aria-label="消息中心"
      prefetch
      className={
        iconOnly
          ? "relative flex h-9 w-9 items-center justify-center rounded-full border border-brand/30 bg-white text-brand transition-colors duration-200 hover:bg-brand-soft"
          : "relative block w-full rounded-xl border border-brand/30 bg-white px-3 py-2 text-left text-sm font-medium text-brand transition-colors duration-200 hover:bg-brand-soft"
      }
    >
      {iconOnly ? icon : "消息"}
      {badge}
    </Link>
  );
}

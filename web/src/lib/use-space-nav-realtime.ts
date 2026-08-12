"use client";

import { startTransition, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * 菜单栏空间导航实时同步：
 * 订阅当前用户在 space_members 上的变更（加入、退出、被移出、空间删除的级联删除），
 * 防抖后刷新 RSC，让侧边栏的空间列表动态更新，无需整页刷新。
 */
const SUBSCRIBE_DELAY_MS = 800;
const REFRESH_DEBOUNCE_MS = 400;

type SpaceMembersPayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: { space_id?: string | null } | null;
  old?: { space_id?: string | null } | null;
};

export function useSpaceNavRealtime() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function setup() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const ch = supabase
        .channel(`space-nav-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "space_members",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (cancelled) return;
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              if (cancelled) return;

              const p = payload as unknown as SpaceMembersPayload;
              const spaceId = p.old?.space_id ?? p.new?.space_id;
              startTransition(() => {
                if (
                  p.eventType === "DELETE" &&
                  spaceId &&
                  pathname.startsWith(`/app/spaces/${spaceId}`)
                ) {
                  // 正在查看被移出/被删除的空间：先跳回总览
                  router.replace("/app?view=calendar&range=week");
                }
                router.refresh();
              });
            }, REFRESH_DEBOUNCE_MS);
          },
        )
        .subscribe();

      if (cancelled) {
        void supabase.removeChannel(ch);
        return;
      }
      channel = ch;
    }

    delayTimer = setTimeout(() => {
      void setup();
    }, SUBSCRIBE_DELAY_MS);

    return () => {
      cancelled = true;
      if (delayTimer) clearTimeout(delayTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router, supabase, pathname]);
}

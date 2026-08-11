"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { isTodosRealtimeRefreshSuppressed } from "@/lib/todos-realtime-gate";

/** 轻量同步信号：默认不整页 refresh，避免拖拽后闪屏 */
export const TODOS_REALTIME_CHANGED = "sharetodo:todos-realtime-changed";

/** 首屏稳定后再订阅 */
const SUBSCRIBE_DELAY_MS = 2500;

/**
 * 订阅待办变更。
 * 不再 router.refresh()——整页 RSC 重拉是拖任务数秒后闪屏的主因。
 * 需要同步的 UI 可监听 TODOS_REALTIME_CHANGED。
 */
export function useTodosRealtime(spaceId?: string) {
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const emit = () => {
      if (cancelled) return;
      if (isTodosRealtimeRefreshSuppressed()) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      window.dispatchEvent(new CustomEvent(TODOS_REALTIME_CHANGED));
    };

    const schedule = () => {
      if (isTodosRealtimeRefreshSuppressed()) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        emit();
      }, 400);
    };

    delayTimer = setTimeout(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`todos-realtime-${spaceId || "all"}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "todos",
            ...(spaceId ? { filter: `space_id=eq.${spaceId}` } : {}),
          },
          schedule,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "todo_assignees" },
          schedule,
        )
        .subscribe();
    }, SUBSCRIBE_DELAY_MS);

    return () => {
      cancelled = true;
      if (delayTimer) clearTimeout(delayTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, spaceId]);
}

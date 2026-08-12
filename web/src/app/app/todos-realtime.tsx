"use client";

import { useTodosRealtime } from "@/lib/use-todos-realtime";

/** 挂在页面上订阅待办变更（不再 router.refresh，避免拖拽后整页闪） */
export function TodosRealtime({ spaceId }: { spaceId?: string }) {
  useTodosRealtime(spaceId);
  return null;
}

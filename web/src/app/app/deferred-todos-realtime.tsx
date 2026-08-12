"use client";

import { useEffect, useState } from "react";
import { TodosRealtime } from "./todos-realtime";

/** 首屏后再挂 Realtime，减轻登录后瞬时连接 */
export function DeferredTodosRealtime({ spaceId }: { spaceId?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 1200);
    return () => window.clearTimeout(t);
  }, []);
  if (!ready) return null;
  return <TodosRealtime spaceId={spaceId} />;
}

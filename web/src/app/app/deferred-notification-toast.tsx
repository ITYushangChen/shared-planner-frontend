"use client";

import dynamic from "next/dynamic";

const NotificationToast = dynamic(
  () =>
    import("./notification-toast").then((m) => ({
      default: m.NotificationToast,
    })),
  { ssr: false },
);

/** 客户端挂载 Toast：本机冲突提示立刻可用；Realtime 在组件内延迟订阅 */
export function DeferredNotificationToast() {
  return <NotificationToast />;
}

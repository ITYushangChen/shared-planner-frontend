/** 跨组件同步未读角标（一键已读 / 新消息 / 冲突） */
export const NOTIFICATIONS_CHANGED = "sharetodo:notifications-changed";

/** 本机立刻弹出顶部 Toast（不必等 Realtime） */
export const NOTIFICATION_TOAST = "sharetodo:notification-toast";

export type NotificationsChangedDetail = {
  /** 传入则铃铛立刻采用该数；否则再查库 */
  unread?: number;
  /** 通知已全部标已读：立刻重查（未读通知+待处理冲突） */
  notesCleared?: boolean;
};

export type NotificationToastDetail = {
  title: string;
  body?: string | null;
  id?: string;
};

export function emitNotificationsChanged(detail?: NotificationsChangedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(NOTIFICATIONS_CHANGED, { detail: detail ?? {} }),
  );
}

export function emitNotificationToast(detail: NotificationToastDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(NOTIFICATION_TOAST, { detail }),
  );
}

/** 本地改期/拖拽后静音 Realtime 整页 refresh（挂 window，避免双模块） */

const MUTE_KEY = "__sharetodoRealtimeMuteUntil";

type GateWindow = Window & { [MUTE_KEY]?: number };

function win(): GateWindow | null {
  if (typeof window === "undefined") return null;
  return window as GateWindow;
}

/** 静音期内不 schedule / 不 flush refresh */
export function suppressTodosRealtimeRefresh(ms = 8000) {
  const w = win();
  if (!w) return;
  const until = Date.now() + ms;
  if (until > (w[MUTE_KEY] ?? 0)) w[MUTE_KEY] = until;
}

export function isTodosRealtimeRefreshSuppressed() {
  return Date.now() < (win()?.[MUTE_KEY] ?? 0);
}

export function todosRealtimeSuppressRemainingMs() {
  return Math.max(0, (win()?.[MUTE_KEY] ?? 0) - Date.now());
}

"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SpaceMemberOption, SpaceNavItem } from "@/lib/todos";
import dynamic from "next/dynamic";
import { CreateSpaceModal } from "./create-space-modal";
import { JoinSpaceModal } from "./join-space-modal";
import { NotificationBell } from "./notification-bell";
import { SpaceKindNav } from "./space-kind-nav";
import { SpaceNavRow } from "./space-nav-row";
import { createClient } from "@/lib/supabase/client";
import { prefetchAppRoutes } from "@/lib/soft-nav";
import { useSpaceNavRealtime } from "@/lib/use-space-nav-realtime";

const AiAssistant = dynamic(
  () => import("./ai-assistant").then((m) => ({ default: m.AiAssistant })),
  { ssr: false },
);
const QuickCreateTodo = dynamic(
  () =>
    import("./quick-create-todo").then((m) => ({ default: m.QuickCreateTodo })),
  { ssr: false },
);
const SpacePanelModal = dynamic(
  () =>
    import("./space-panel-modal").then((m) => ({ default: m.SpacePanelModal })),
  { ssr: false },
);
const AppearanceSettingsModal = dynamic(
  () =>
    import("./appearance-settings-modal").then((m) => ({
      default: m.AppearanceSettingsModal,
    })),
  { ssr: false },
);
const SidebarUnscheduled = dynamic(
  () =>
    import("./sidebar-unscheduled").then((m) => ({
      default: m.SidebarUnscheduled,
    })),
  { ssr: false },
);

type Props = {
  spaces: SpaceNavItem[];
  displayName?: string | null;
  avatarUrl?: string | null;
  globalUiPrefs?: unknown;
  spacePrefsById?: Record<string, unknown>;
  timezone?: string;
};

export function AppSidebar({
  spaces,
  displayName,
  avatarUrl,
  globalUiPrefs,
  spacePrefsById,
  timezone,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [spaceToast, setSpaceToast] = useState<"private" | "public" | null>(
    null,
  );
  const [focusSpaceId, setFocusSpaceId] = useState<string | null>(
    spaces[0]?.id ?? null,
  );
  const [quickSpaceId, setQuickSpaceId] = useState<string | null>(null);
  const [quickMembers, setQuickMembers] = useState<SpaceMemberOption[]>([]);
  const [aiSpace, setAiSpace] = useState<SpaceNavItem | null>(null);
  const [panelMode, setPanelMode] = useState<"invites" | "members" | null>(
    null,
  );
  /** 外观设置体积大，空闲后再挂载 */
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [privOpen, setPrivOpen] = useState(true);
  const [pubsOpen, setPubsOpen] = useState(true);
  /** 桌面二级空间栏收起（保留最左图标栏） */
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  useSpaceNavRealtime();

  useEffect(() => {
    try {
      const a = localStorage.getItem("sharetodo-nav-priv-open");
      const b = localStorage.getItem("sharetodo-nav-pubs-open");
      const c = localStorage.getItem("sharetodo-sidebar-collapsed");
      if (a === "0") setPrivOpen(false);
      if (b === "0") setPubsOpen(false);
      if (c === "1") setPanelCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  function togglePrivOpen() {
    setPrivOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("sharetodo-nav-priv-open", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function togglePubsOpen() {
    setPubsOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("sharetodo-nav-pubs-open", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function togglePanelCollapsed() {
    setPanelCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(
          "sharetodo-sidebar-collapsed",
          next ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  const overviewViewRaw = searchParams.get("view");
  const overviewView =
    overviewViewRaw === "boards"
      ? "boards"
      : overviewViewRaw === "list"
        ? "list"
        : "calendar";
  const onOverviewPage = pathname === "/app";
  const privateSpaces = spaces.filter((s) => s.visibility !== "public");
  const publicSpaces = spaces.filter((s) => s.visibility === "public");
  const name = displayName || "用户";
  const quickSpace =
    spaces.find((s) => s.id === quickSpaceId) ?? spaces[0] ?? null;
  const quickCanAssign =
    quickSpace?.role === "owner" || quickSpace?.role === "admin";

  // 侧栏快速创建：拉取成员，owner/admin 可指派他人（含公共空间）
  useEffect(() => {
    if (!quickSpaceId) {
      setQuickMembers([]);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("space_members")
      .select("user_id, profiles(display_name, email)")
      .eq("space_id", quickSpaceId)
      .then(({ data }) => {
        if (cancelled) return;
        setQuickMembers(
          (data ?? []).map((m) => {
            const profile = m.profiles as unknown as {
              display_name: string;
              email: string | null;
            } | null;
            return {
              user_id: m.user_id as string,
              display_name: profile?.display_name?.trim() || "成员",
              email: profile?.email ?? null,
            };
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [quickSpaceId]);

  const filter = (list: SpaceNavItem[]) => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((s) => s.name.toLowerCase().includes(t));
  };

  const priv = useMemo(() => filter(privateSpaces), [privateSpaces, q]);
  const pubs = useMemo(() => filter(publicSpaces), [publicSpaces, q]);
  const searching = q.trim().length > 0;
  const searchHits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [] as SpaceNavItem[];
    return spaces.filter((s) => s.name.toLowerCase().includes(t));
  }, [spaces, q]);

  const onOverview = pathname === "/app";
  const onReports =
    pathname === "/app/reports" || pathname.startsWith("/app/reports/");
  const onNotify = pathname === "/app/notifications";
  const onProfile = pathname === "/app/profile";
  const onSpaces = pathname.startsWith("/app/spaces");

  const spaceIdFromPath = pathname.startsWith("/app/spaces/")
    ? pathname.split("/")[3] || null
    : null;

  const spaceViewRaw = searchParams.get("view");
  const spaceView =
    spaceViewRaw === "boards" || spaceViewRaw === "list"
      ? spaceViewRaw
      : "calendar";

  useEffect(() => {
    setDrawerOpen(false);
    setSpaceToast(null);
  }, [pathname]);

  useEffect(() => {
    if (drawerOpen) setAppearanceReady(true);
  }, [drawerOpen]);

  useEffect(() => {
    const t = window.setTimeout(() => setAppearanceReady(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!focusSpaceId && spaces[0]) setFocusSpaceId(spaces[0].id);
  }, [spaces, focusSpaceId]);

  useEffect(() => {
    if (spaceIdFromPath) setFocusSpaceId(spaceIdFromPath);
  }, [spaceIdFromPath]);

  const focusSpace =
    spaces.find((s) => s.id === focusSpaceId) ?? spaces[0] ?? null;
  const canManageAny = spaces.some(
    (s) => s.role === "owner" || s.role === "admin",
  );

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    prefetchAppRoutes(
      (href) => router.prefetch(href),
      spaces.map((s) => s.id),
    );
  }, [router, spaces]);

  function softPush(href: string, opts?: { refresh?: boolean }) {
    startTransition(() => {
      router.push(href);
      if (opts?.refresh) router.refresh();
    });
  }

  /** 在空间页则切该空间视图；否则进总览 */
  function goAppView(view: "boards" | "calendar" | "list") {
    setDrawerOpen(false);
    if (spaceIdFromPath) {
      const params = new URLSearchParams();
      const assignee = searchParams.get("assignee");
      const range = searchParams.get("range");
      if (assignee) params.set("assignee", assignee);
      if (range) params.set("range", range);
      else params.set("range", "week");
      params.set("view", view);
      softPush(`/app/spaces/${spaceIdFromPath}?${params.toString()}`);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    if (!params.get("range")) params.set("range", "week");
    const q = params.toString();
    softPush(q ? `/app?${q}` : "/app");
  }

  function goOverviewRange(key: "day" | "week" | "month") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", key);
    if (!params.get("view")) params.set("view", "calendar");
    const q = params.toString();
    // 空间页内切换日周月，留在当前空间
    if (spaceIdFromPath) {
      softPush(`/app/spaces/${spaceIdFromPath}?${q}`);
      return;
    }
    softPush(q ? `/app?${q}` : "/app");
  }

  /** 无 range 时默认周 */
  const overviewRange =
    searchParams.get("range") === "day" ||
    searchParams.get("range") === "month"
      ? searchParams.get("range")
      : "week";

  return (
    <>
      {/* 最左图标栏（半透明，透出整页背景图） */}
      <aside className="hidden h-dvh w-14 shrink-0 sticky top-0 flex-col items-center gap-0.5 bg-[var(--brand-rail)]/80 py-3 backdrop-blur-md md:flex">
        <Link
          href="/app/profile"
          title="我的"
          prefetch
          className={railIconClass(onProfile)}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="h-8 w-8 rounded-full border-2 border-white/40 object-cover"
            />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-semibold text-white">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </Link>
        <Link
          href="/app?view=calendar&range=week"
          title="总览工作区"
          prefetch
          className={railIconClass(onOverview)}
        >
          <RailIconOverview />
        </Link>
        <Link
          href="/app/notifications"
          title="消息"
          prefetch
          className={railIconClass(onNotify)}
        >
          <NotificationBell iconOnly rail subscribe />
        </Link>

        <div
          className="mt-2 flex flex-col items-center gap-0.5 border-t border-white/15 pt-2"
          role="group"
          aria-label="日周月"
        >
          {(
            [
              ["day", "日"],
              ["week", "周"],
              ["month", "月"],
            ] as const
          ).map(([key, label]) => {
            const active =
              (onOverviewPage || Boolean(spaceIdFromPath)) &&
              overviewRange === key;
            return (
              <button
                key={key}
                type="button"
                title={label === "日" ? "日视图" : label === "周" ? "周视图" : "月视图"}
                aria-label={label === "日" ? "日视图" : label === "周" ? "周视图" : "月视图"}
                aria-pressed={active}
                onClick={() => goOverviewRange(key)}
                className={railIconClass(active)}
              >
                <span className="text-[11px] font-bold tracking-wide">
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="mt-2 flex flex-col items-center gap-0.5 border-t border-white/15 pt-2"
          role="group"
          aria-label="视图"
        >
          {(
            [
              ["boards", "象", "四象限"],
              ["calendar", "历", "日历"],
              ["list", "待", "四象限待办"],
            ] as const
          ).map(([view, short, title]) => {
            const current = spaceIdFromPath ? spaceView : overviewView;
            const active =
              (onOverviewPage || Boolean(spaceIdFromPath)) && current === view;
            return (
              <button
                key={view}
                type="button"
                title={title}
                aria-label={title}
                aria-pressed={active}
                onClick={() => goAppView(view)}
                className={railIconClass(active)}
              >
                <span className="text-[11px] font-bold tracking-wide">
                  {short}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="mt-2 flex flex-col items-center gap-0.5 border-t border-white/15 pt-2"
          role="group"
          aria-label="报告"
        >
          <Link
            href="/app/reports"
            title="报告中心"
            aria-label="报告中心"
            prefetch
            className={railIconClass(onReports)}
          >
            <span className="text-[11px] font-bold tracking-wide">报</span>
          </Link>
        </div>

        <div className="mt-auto flex flex-col items-center gap-0.5">
          <button
            type="button"
            title={panelCollapsed ? "展开空间列表" : "收起空间列表"}
            aria-label={panelCollapsed ? "展开空间列表" : "收起空间列表"}
            aria-pressed={panelCollapsed}
            onClick={togglePanelCollapsed}
            className={railIconClass(false)}
          >
            <RailIconPanelToggle collapsed={panelCollapsed} />
          </button>
          <button
            type="button"
            title="AI 助手"
            aria-label="AI 助手"
            disabled={spaces.length === 0}
            onClick={() => {
              const target = focusSpace ?? spaces[0];
              if (target) setAiSpace(target);
            }}
            className={railIconClass(false) + " disabled:opacity-40"}
          >
            <span className="text-[11px] font-bold tracking-wide">AI</span>
          </button>
          <CreateSpaceModal rail />
          <JoinSpaceModal rail />
          {appearanceReady ? (
            <AppearanceSettingsModal
              rail
              spaces={spaces}
              initialGlobalPrefs={globalUiPrefs}
              initialSpacePrefsById={spacePrefsById}
            />
          ) : (
            <button
              type="button"
              title="外观设置"
              aria-label="外观设置"
              className={railIconClass(false)}
              onClick={() => setAppearanceReady(true)}
            >
              <RailIconGear />
            </button>
          )}
        </div>
      </aside>

      {/* 二级导航（半透明）；可收起，不拖拽改宽 */}
      <aside
        className={[
          "hidden h-dvh sticky top-0 shrink-0 flex-col border-r border-[var(--border-muted)]/80 bg-white/75 backdrop-blur-md transition-[width,opacity] duration-200 md:flex",
          panelCollapsed
            ? "w-0 overflow-hidden border-r-0 opacity-0 pointer-events-none"
            : "w-64 opacity-100",
        ].join(" ")}
        aria-hidden={panelCollapsed}
      >
        <div className="shrink-0 border-b border-[var(--border-muted)]/80 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-[var(--brand-ink)]">空间</p>
            <button
              type="button"
              title="收起空间列表"
              aria-label="收起空间列表"
              onClick={togglePanelCollapsed}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--brand-ink)]"
            >
              <RailIconPanelToggle collapsed={false} />
            </button>
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索空间"
            className="mt-2 w-full rounded-lg border border-[var(--border-muted)] bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand"
          />
        </div>

        <nav className="flex max-h-[42%] min-h-0 shrink-0 flex-col overflow-y-auto p-2">
          <Link
            href="/app?view=calendar&range=week"
            prefetch
            className={spaceNavClass(onOverview && !onSpaces)}
          >
            <span className="block truncate font-medium">总览工作区</span>
            <span className="block text-[11px] text-[var(--text-muted)]">
              全部空间日程
            </span>
          </Link>
          <Link
            href="/app/reports"
            prefetch
            className={spaceNavClass(onReports)}
          >
            <span className="block truncate font-medium">报告中心</span>
            <span className="block text-[11px] text-[var(--text-muted)]">
              日报 · 周报 · 月报
            </span>
          </Link>

          {searching ? (
            <div className="mt-3 space-y-0.5">
              <p className="px-2 text-[11px] font-semibold text-[var(--text-muted)]">
                搜索结果
              </p>
              {searchHits.length === 0 ? (
                <p className="px-2 py-2 text-xs text-[var(--text-muted)]">
                  无匹配空间
                </p>
              ) : (
                searchHits.map((s) => (
                  <SpaceNavRow
                    key={s.id}
                    space={s}
                    hideSubtitle
                    onQuickCreate={setQuickSpaceId}
                  />
                ))
              )}
            </div>
          ) : (
            <>
              <div className="mb-1 mt-4 flex w-full items-center gap-0.5">
                <button
                  type="button"
                  onClick={togglePrivOpen}
                  className="flex min-w-0 flex-1 items-center rounded-lg px-2 py-1 text-left text-sm font-semibold tracking-wide text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
                  aria-expanded={privOpen}
                >
                  <span>我的空间</span>
                </button>
                <CreateSpaceModal
                  defaultVisibility="private"
                  hideDefaultTrigger
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base font-medium text-[var(--brand-ink)] transition-colors hover:bg-[var(--surface-muted)]"
                />
                <button
                  type="button"
                  onClick={togglePrivOpen}
                  className="shrink-0 rounded-lg px-1.5 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                  aria-expanded={privOpen}
                >
                  {privOpen ? "收起" : "展开"}
                </button>
              </div>
              {privOpen ? (
                <div className="ml-2 border-l border-[var(--border-muted)] pl-2">
                  <SpaceKindNav
                    spaces={priv}
                    storagePrefix="sharetodo-nav-priv-kind"
                    emptyText="暂无私人空间"
                    flat
                    hideSubtitle
                    onQuickCreate={setQuickSpaceId}
                  />
                </div>
              ) : null}

              <div className="mb-1 mt-4 flex w-full items-center gap-0.5">
                <button
                  type="button"
                  onClick={togglePubsOpen}
                  className="flex min-w-0 flex-1 items-center rounded-lg px-2 py-1 text-left text-sm font-semibold tracking-wide text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
                  aria-expanded={pubsOpen}
                >
                  <span>公共空间</span>
                </button>
                <CreateSpaceModal
                  defaultVisibility="public"
                  hideDefaultTrigger
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base font-medium text-[var(--brand-ink)] transition-colors hover:bg-[var(--surface-muted)]"
                />
                <button
                  type="button"
                  onClick={togglePubsOpen}
                  className="shrink-0 rounded-lg px-1.5 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                  aria-expanded={pubsOpen}
                >
                  {pubsOpen ? "收起" : "展开"}
                </button>
              </div>
              {pubsOpen ? (
                <div className="ml-2 border-l border-[var(--border-muted)] pl-2">
                  <SpaceKindNav
                    spaces={pubs}
                    storagePrefix="sharetodo-nav-pubs-kind"
                    emptyText="暂无公共空间"
                    flat
                    hideSubtitle
                    onQuickCreate={setQuickSpaceId}
                  />
                </div>
              ) : null}
            </>
          )}
        </nav>
        {!panelCollapsed ? <SidebarUnscheduled spaces={spaces} /> : null}
      </aside>

      {/* 移动端顶栏：菜单 + 消息铃铛 + 标题 */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-2 border-b border-[var(--border-muted)] bg-white/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md md:hidden">
        <button
          type="button"
          title="打开菜单"
          aria-label="打开菜单"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
          onClick={() => setDrawerOpen(true)}
        >
          <MobileMenuIcon />
        </button>
        <NotificationBell iconOnly subscribe />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--brand-ink)]">
          {onOverviewPage || spaceIdFromPath
            ? (spaceIdFromPath ? spaceView : overviewView) === "calendar"
              ? "日历"
              : (spaceIdFromPath ? spaceView : overviewView) === "list"
                ? "四象限待办"
                : "四象限"
            : onSpaces
              ? "空间"
              : onNotify
                ? "消息"
                : onProfile
                  ? "我的"
                  : onReports
                    ? "报告"
                  : "ShareTodo"}
        </p>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--border-muted)] bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {(
          [
            ["day", "日"],
            ["week", "周"],
            ["month", "月"],
          ] as const
        ).map(([key, label]) => {
          const active =
            (onOverviewPage || Boolean(spaceIdFromPath)) &&
            overviewRange === key;
          return (
            <button
              key={key}
              type="button"
              className={mobileNavClass(active)}
              onClick={() => goOverviewRange(key)}
            >
              {label}
            </button>
          );
        })}
        <Link
          href="/app/profile"
          prefetch
          className={mobileNavClass(onProfile)}
        >
          我的
        </Link>
      </nav>

      {drawerOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[70] md:hidden">
              <button
                type="button"
                aria-label="关闭"
                className="absolute inset-0 bg-black/40"
                onClick={() => setDrawerOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-[var(--border-muted)] px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
                  <p className="text-base font-bold text-[var(--brand-ink)]">
                    菜单
                  </p>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                    onClick={() => setDrawerOpen(false)}
                  >
                    关闭
                  </button>
                </div>

                {/* 顶部分览：在空间内则切该空间视图，否则总览 */}
                <div className="flex items-center justify-around gap-1 border-b border-[var(--border-muted)] px-2 py-3">
                  <button
                    type="button"
                    onClick={() => goAppView("boards")}
                    className={drawerViewBtn(
                      spaceIdFromPath
                        ? spaceView === "boards"
                        : onOverviewPage && overviewView === "boards",
                    )}
                  >
                    <DrawerIconBoards />
                    <span>四象限</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => goAppView("calendar")}
                    className={drawerViewBtn(
                      spaceIdFromPath
                        ? spaceView === "calendar"
                        : onOverviewPage && overviewView === "calendar",
                    )}
                  >
                    <DrawerIconCalendar />
                    <span>日历</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => goAppView("list")}
                    className={drawerViewBtn(
                      spaceIdFromPath
                        ? spaceView === "list"
                        : onOverviewPage && overviewView === "list",
                    )}
                  >
                    <DrawerIconList />
                    <span>四象限待办</span>
                  </button>
                </div>

                <div className="border-b border-[var(--border-muted)] px-3 py-2">
                  <button
                    type="button"
                    className={[
                      "mb-2 w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold",
                      onOverviewPage
                        ? "bg-brand-soft text-brand"
                        : "text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]",
                    ].join(" ")}
                    onClick={() => {
                      setDrawerOpen(false);
                      softPush("/app?view=calendar&range=week");
                    }}
                  >
                    总览工作区
                  </button>
                  <button
                    type="button"
                    className={[
                      "mb-2 w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold",
                      onReports
                        ? "bg-brand-soft text-brand"
                        : "text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]",
                    ].join(" ")}
                    onClick={() => {
                      setDrawerOpen(false);
                      softPush("/app/reports");
                    }}
                  >
                    报告中心
                  </button>
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜索空间"
                    className="w-full rounded-xl border border-[var(--border-muted)] bg-white px-3 py-2.5 text-sm outline-none focus:border-brand"
                  />
                </div>

                <div className="relative min-h-0 flex-1 overflow-y-auto px-2 py-2 pb-4">
                  <div className="flex w-full items-center gap-0.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
                      onClick={() =>
                        setSpaceToast((v) =>
                          v === "private" ? null : "private",
                        )
                      }
                    >
                      <span>我的空间</span>
                    </button>
                    <CreateSpaceModal
                      defaultVisibility="private"
                      hideDefaultTrigger
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-medium text-[var(--brand-ink)] transition-colors hover:bg-[var(--surface-muted)]"
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-xl px-2 py-2.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                      onClick={() =>
                        setSpaceToast((v) =>
                          v === "private" ? null : "private",
                        )
                      }
                    >
                      {spaceToast === "private" ? "收起" : "展开"}
                    </button>
                  </div>

                  <div className="mt-1 flex w-full items-center gap-0.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
                      onClick={() =>
                        setSpaceToast((v) =>
                          v === "public" ? null : "public",
                        )
                      }
                    >
                      <span>公共空间</span>
                    </button>
                    <CreateSpaceModal
                      defaultVisibility="public"
                      hideDefaultTrigger
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-medium text-[var(--brand-ink)] transition-colors hover:bg-[var(--surface-muted)]"
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-xl px-2 py-2.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                      onClick={() =>
                        setSpaceToast((v) =>
                          v === "public" ? null : "public",
                        )
                      }
                    >
                      {spaceToast === "public" ? "收起" : "展开"}
                    </button>
                  </div>

                  {spaceToast ? (
                    <div className="absolute left-2 right-2 top-24 z-20 max-h-[50vh] overflow-y-auto rounded-2xl border border-[var(--border-muted)] bg-white p-2 shadow-xl">
                      <p className="px-2 pb-1 text-[11px] text-[var(--text-muted)]">
                        {spaceToast === "private" ? "我的空间" : "公共空间"} ·
                        点名称进入
                      </p>
                      <SpaceKindNav
                        spaces={spaceToast === "private" ? priv : pubs}
                        storagePrefix={
                          spaceToast === "private"
                            ? "sharetodo-nav-priv-kind"
                            : "sharetodo-nav-pubs-kind"
                        }
                        emptyText="暂无空间"
                        flat
                        hideSubtitle
                        actionsPlacement="stacked"
                        onQuickCreate={(id) => {
                          setQuickSpaceId(id);
                          setDrawerOpen(false);
                          setSpaceToast(null);
                        }}
                        onNavigate={() => {
                          setDrawerOpen(false);
                          setSpaceToast(null);
                        }}
                      />
                    </div>
                  ) : null}

                  <div className="mt-4 flex items-center gap-2 border-t border-[var(--border-muted)] pt-3">
                    <CreateSpaceModal iconOnly />
                    <div className="min-w-0 flex-1">
                      <JoinSpaceModal compact />
                    </div>
                  </div>

                  <div className="mt-3 min-h-[12rem] border-t border-[var(--border-muted)] pt-2">
                    <SidebarUnscheduled spaces={spaces} />
                  </div>

                  {/* 原 ··· 能力：作用于当前选中空间 */}
                  <div className="mt-3 space-y-1.5 border-t border-[var(--border-muted)] pt-3">
                    <p className="px-1 text-[11px] text-[var(--text-muted)]">
                      空间操作
                      {focusSpace ? ` · ${focusSpace.name}` : " · 请先选空间"}
                    </p>
                    <button
                      type="button"
                      disabled={!focusSpace}
                      className={drawerActionBtn}
                      onClick={() => {
                        if (!focusSpace) return;
                        setDrawerOpen(false);
                        setAiSpace(focusSpace);
                      }}
                    >
                      AI 助手
                    </button>
                    <button
                      type="button"
                      disabled={!focusSpace}
                      className={drawerActionBtn}
                      onClick={() => {
                        if (!focusSpace) return;
                        setDrawerOpen(false);
                        setQuickSpaceId(focusSpace.id);
                      }}
                    >
                      快速创建
                    </button>
                    {canManageAny ? (
                      <>
                        <button
                          type="button"
                          className={drawerActionBtn}
                          onClick={() => {
                            setDrawerOpen(false);
                            setPanelMode("invites");
                          }}
                        >
                          邀请成员
                        </button>
                        {focusSpace?.role === "owner" ? (
                          <button
                            type="button"
                            className={`${drawerActionBtn} text-red-600`}
                            onClick={() => {
                              if (!focusSpace) return;
                              if (
                                !confirm(
                                  `确定删除空间「${focusSpace.name}」？成员与待办将一并删除，且不可恢复。`,
                                )
                              ) {
                                return;
                              }
                              void (async () => {
                                const supabase = createClient();
                                const { error } = await supabase
                                  .from("spaces")
                                  .delete()
                                  .eq("id", focusSpace.id);
                                if (error) {
                                  alert(error.message || "删除失败");
                                  return;
                                }
                                setDrawerOpen(false);
                                softPush("/app?view=calendar&range=week", {
                                  refresh: true,
                                });
                              })();
                            }}
                          >
                            删除空间
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={drawerActionBtn}
                          onClick={() => {
                            setDrawerOpen(false);
                            setPanelMode("members");
                          }}
                        >
                          成员管理
                        </button>
                      </>
                    ) : null}
                    {(focusSpace?.role === "owner" ||
                      focusSpace?.role === "admin") && (
                      <button
                        type="button"
                        className={drawerActionBtn}
                        onClick={() => {
                          if (!focusSpace) return;
                          setDrawerOpen(false);
                          softPush(
                            `/app/spaces/${focusSpace.id}?panel=settings`,
                          );
                        }}
                      >
                        空间设置
                      </button>
                    )}
                    {focusSpace && focusSpace.role !== "owner" ? (
                      <button
                        type="button"
                        className={drawerActionBtn}
                        onClick={() => {
                          setDrawerOpen(false);
                          softPush(
                            `/app/spaces/${focusSpace.id}?panel=leave`,
                          );
                        }}
                      >
                        离开空间
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

            </div>,
            document.body,
          )
        : null}

      {quickSpaceId && quickSpace && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]">
              <div className="w-full max-w-lg rounded-xl border border-[var(--border-muted)] bg-white p-4 shadow-xl">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[var(--brand-ink)]">
                    快速创建
                  </h2>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                    onClick={() => setQuickSpaceId(null)}
                  >
                    关闭
                  </button>
                </div>
                <QuickCreateTodo
                  key={quickSpace.id}
                  spaces={spaces}
                  defaultSpaceId={quickSpace.id}
                  members={quickMembers}
                  canAssign={quickCanAssign}
                  bare
                  onCreated={() => setQuickSpaceId(null)}
                />
              </div>
            </div>,
            document.body,
          )
        : null}

      {panelMode ? (
        <SpacePanelModal
          mode={panelMode}
          spaces={spaces}
          initialSpaceId={focusSpaceId}
          onClose={() => setPanelMode(null)}
        />
      ) : null}

      {aiSpace && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[6vh]"
              onClick={(e) => {
                if (e.target === e.currentTarget) setAiSpace(null);
              }}
            >
              <div className="w-full max-w-2xl rounded-xl border border-[var(--border-muted)] bg-white p-4 shadow-xl">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[var(--brand-ink)]">
                    AI 助手 · {aiSpace.name}
                  </h2>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                    onClick={() => setAiSpace(null)}
                  >
                    关闭
                  </button>
                </div>
                <AiAssistant
                  key={aiSpace.id}
                  spaces={spaces}
                  defaultSpaceId={aiSpace.id}
                  timezone={timezone}
                  plain
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function railIconClass(active: boolean) {
  return [
    "mb-1 flex h-10 w-10 items-center justify-center rounded-lg text-white transition-colors duration-200",
    active ? "bg-black/15" : "hover:bg-white/15",
  ].join(" ");
}

function spaceNavClass(active: boolean, nested = false) {
  return [
    "block py-2 text-sm transition-colors duration-200",
    nested ? "rounded-r-lg pl-2.5 pr-2" : "rounded-lg px-2.5",
    active
      ? "border-l-[3px] border-brand bg-brand-soft font-medium text-brand"
      : "border-l-[3px] border-transparent text-[var(--brand-ink)] hover:bg-white",
  ].join(" ");
}

function mobileNavClass(active: boolean) {
  return [
    "flex-1 py-3 text-center text-sm transition-colors duration-200",
    active
      ? "font-bold text-zinc-950"
      : "font-medium text-[var(--text-muted)]",
  ].join(" ");
}

function drawerViewBtn(active: boolean) {
  return [
    "flex flex-1 flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 text-[11px] font-medium transition-colors",
    active
      ? "bg-zinc-900 text-white"
      : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)]",
  ].join(" ");
}

const drawerActionBtn =
  "w-full rounded-xl border border-[#2f5f8f]/40 bg-white px-3 py-2.5 text-left text-sm font-medium text-[#2f5f8f] transition-colors hover:bg-[#e8f0f7] disabled:cursor-not-allowed disabled:opacity-40";

/** 三线+圆点，打开左侧抽屉 */
function MobileMenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="5" cy="7" r="1.5" fill="currentColor" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="5" cy="17" r="1.5" fill="currentColor" />
      <path
        d="M9 7h11M9 12h11M9 17h11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DrawerIconBoards() {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-100 text-orange-600">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    </span>
  );
}

function DrawerIconList() {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-100 text-sky-600">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M8 7h12M8 12h12M8 17h12"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <circle cx="4.5" cy="7" r="1.2" fill="currentColor" />
        <circle cx="4.5" cy="12" r="1.2" fill="currentColor" />
        <circle cx="4.5" cy="17" r="1.2" fill="currentColor" />
      </svg>
    </span>
  );
}

function DrawerIconCalendar() {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-100 text-violet-600">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect
          x="3"
          y="5"
          width="18"
          height="16"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path d="M3 10h18" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M8 3v4M16 3v4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** collapsed=true：面板已收起，图标示意「向右展开」 */
function RailIconPanelToggle({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="1.6" />
      <path
        d={collapsed ? "M14 9l3 3-3 3" : "M16 9l-3 3 3 3"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RailIconOverview() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1v-9.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RailIconGear() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M19.4 13a7.6 7.6 0 0 0 .05-2l2.05-1.6-2-3.46-2.45 1a7.7 7.7 0 0 0-1.73-1L14.9 2h-4l-.42 2.94a7.7 7.7 0 0 0-1.73 1l-2.45-1-2 3.46L6.4 11a7.6 7.6 0 0 0 0 2l-2.05 1.6 2 3.46 2.45-1a7.7 7.7 0 0 0 1.73 1L10.9 22h4l.42-2.94a7.7 7.7 0 0 0 1.73-1l2.45 1 2-3.46L19.4 13Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

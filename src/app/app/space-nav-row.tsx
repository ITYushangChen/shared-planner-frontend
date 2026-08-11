"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  prefetchSpaceCalendarTodos,
  prefetchSpaceMembers,
} from "@/lib/space-data-cache";
import { createClient } from "@/lib/supabase/client";
import { spaceKindLabel } from "@/lib/spaces";
import type { SpaceNavItem } from "@/lib/todos";

type Props = {
  space: SpaceNavItem;
  subtitle?: string;
  onQuickCreate?: (spaceId: string) => void;
  /** 点击进入空间后回调（如关闭移动端抽屉） */
  onNavigate?: () => void;
  /**
   * stacked：手机抽屉——标题同行 ··· / +，不显示 kind 副标题
   * inline：桌面侧栏——标题同行操作，下方显示 kind（个人空间/工作区等）
   */
  actionsPlacement?: "inline" | "stacked";
  /** 隐藏标题下的 kind 副标题（个人空间/工作区等） */
  hideSubtitle?: boolean;
};

function canManage(s: SpaceNavItem) {
  return s.role === "owner" || s.role === "admin";
}

export function SpaceNavRow({
  space,
  subtitle,
  onQuickCreate,
  onNavigate,
  actionsPlacement = "inline",
  hideSubtitle = false,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const href = `/app/spaces/${space.id}`;
  const routeActive = pathname === href || pathname.startsWith(`${href}/`);
  /** 点击后立刻高亮，等路由追上再交给 pathname */
  const [pendingActive, setPendingActive] = useState(false);
  const active = routeActive || pendingActive;
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const manage = canManage(space);
  const isOwner = space.role === "owner";
  const stacked = actionsPlacement === "stacked";
  const showSubtitle = !hideSubtitle && !stacked;

  useEffect(() => {
    setPendingActive(false);
  }, [pathname]);

  function prefetchSpace() {
    router.prefetch(href);
    prefetchSpaceCalendarTodos(space.id);
    prefetchSpaceMembers(space.id);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  function goPanel(panel: "invites" | "members" | "settings" | "leave") {
    setMenuOpen(false);
    onNavigate?.();
    startTransition(() => {
      router.push(`${href}?panel=${panel}`);
    });
  }

  async function deleteSpace() {
    if (
      !confirm(
        `确定删除空间「${space.name}」？成员与待办将一并删除，且不可恢复。`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setMenuOpen(false);
    const { error } = await supabase.from("spaces").delete().eq("id", space.id);
    setDeleting(false);
    if (error) {
      alert(error.message || "删除失败（仅所有者可删除）");
      return;
    }
    onNavigate?.();
    startTransition(() => {
      router.push("/app?view=calendar&range=week");
      router.refresh();
    });
  }

  const iconBtn = stacked
    ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--brand-ink)]"
    : "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)] opacity-70 transition-colors hover:bg-white hover:text-[var(--brand-ink)] hover:opacity-100";

  const menu = menuOpen ? (
    <div
      className={[
        "absolute z-50 w-36 overflow-hidden rounded-lg border border-[var(--border-muted)] bg-white py-1 shadow-lg",
        stacked ? "left-2 top-full mt-1" : "right-1 top-7",
      ].join(" ")}
    >
      {manage ? (
        <>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
            onClick={() => goPanel("invites")}
          >
            邀请成员
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
            onClick={() => goPanel("members")}
          >
            成员管理
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
            onClick={() => goPanel("settings")}
          >
            空间设置
          </button>
          {isOwner ? (
            <button
              type="button"
              disabled={deleting}
              className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              onClick={() => void deleteSpace()}
            >
              {deleting ? "删除中…" : "删除空间"}
            </button>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          className="block w-full px-3 py-1.5 text-left text-sm text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
          onClick={() => goPanel("leave")}
        >
          离开空间
        </button>
      )}
    </div>
  ) : null;

  const moreBtn = (
    <button
      type="button"
      title="更多"
      aria-label="更多"
      className={iconBtn}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen((v) => !v);
      }}
    >
      ···
    </button>
  );

  const plusBtn = onQuickCreate ? (
    <button
      type="button"
      title="快速创建"
      aria-label="快速创建"
      className={iconBtn}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onQuickCreate(space.id);
      }}
    >
      +
    </button>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={[
        "relative rounded-r-lg border-l-[3px] py-1.5 pl-2 pr-1 text-sm transition-colors duration-200",
        active
          ? "border-brand bg-brand-soft font-medium text-brand"
          : "border-transparent text-[var(--brand-ink)] hover:bg-white",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <Link
          href={href}
          prefetch
          className={[
            "min-w-0 flex-1 truncate py-1",
            stacked ? "font-medium" : "",
          ].join(" ")}
          title={space.name}
          onMouseEnter={prefetchSpace}
          onFocus={prefetchSpace}
          onClick={() => {
            setPendingActive(true);
            prefetchSpace();
            onNavigate?.();
          }}
        >
          {space.name}
        </Link>
        {moreBtn}
        {plusBtn}
      </div>
      {showSubtitle ? (
        <Link
          href={href}
          prefetch
          className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]"
          onMouseEnter={prefetchSpace}
          onFocus={prefetchSpace}
          onClick={() => {
            setPendingActive(true);
            prefetchSpace();
            onNavigate?.();
          }}
        >
          {subtitle ?? spaceKindLabel(space.kind)}
        </Link>
      ) : null}
      {menu}
    </div>
  );
}

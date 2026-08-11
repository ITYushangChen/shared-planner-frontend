"use client";

import { useEffect, useMemo, useState } from "react";
import { SPACE_KINDS, spaceKindLabel } from "@/lib/spaces";
import type { SpaceNavItem } from "@/lib/todos";
import { SpaceNavRow } from "./space-nav-row";

type Props = {
  spaces: SpaceNavItem[];
  storagePrefix: string;
  subtitleFor?: (s: SpaceNavItem) => string;
  onQuickCreate?: (spaceId: string) => void;
  onNavigate?: () => void;
  actionsPlacement?: "inline" | "stacked";
  /** 不按 kind 分组，直接列出空间（手机抽屉：不显示「工作区/个人空间」等标题） */
  flat?: boolean;
  hideSubtitle?: boolean;
  emptyText?: string;
};

function groupByKind(list: SpaceNavItem[]) {
  const map = new Map<string, SpaceNavItem[]>();
  for (const s of list) {
    const k = s.kind || "other";
    const arr = map.get(k) ?? [];
    arr.push(s);
    map.set(k, arr);
  }
  const order = SPACE_KINDS.map((k) => k.value);
  const keys = [
    ...order.filter((k) => map.has(k)),
    ...[...map.keys()].filter(
      (k) => !order.includes(k as (typeof order)[number]),
    ),
  ];
  return keys.map((kind) => ({ kind, spaces: map.get(kind)! }));
}

export function SpaceKindNav({
  spaces,
  storagePrefix,
  subtitleFor,
  onQuickCreate,
  onNavigate,
  actionsPlacement = "inline",
  flat = false,
  hideSubtitle = false,
  emptyText = "暂无空间",
}: Props) {
  const groups = useMemo(() => groupByKind(spaces), [spaces]);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (flat) return;
    const next: Record<string, boolean> = {};
    for (const g of groups) {
      const key = `${storagePrefix}-${g.kind}`;
      try {
        const stored = localStorage.getItem(key);
        if (stored === "0") next[g.kind] = false;
        else if (stored === "1") next[g.kind] = true;
        else next[g.kind] = false; // 默认收起：先只看到工作区/家庭区等标题
      } catch {
        next[g.kind] = false;
      }
    }
    setOpenMap(next);
  }, [groups, storagePrefix, flat]);

  function toggleKind(kind: string) {
    setOpenMap((prev) => {
      const nextOpen = !(prev[kind] ?? false);
      try {
        localStorage.setItem(
          `${storagePrefix}-${kind}`,
          nextOpen ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
      return { ...prev, [kind]: nextOpen };
    });
  }

  if (spaces.length === 0) {
    return (
      <p className="px-1 py-1 text-xs text-[var(--text-muted)]">{emptyText}</p>
    );
  }

  if (flat) {
    return (
      <div className="space-y-0.5">
        {spaces.map((s) => (
          <SpaceNavRow
            key={s.id}
            space={s}
            subtitle={subtitleFor?.(s)}
            onQuickCreate={onQuickCreate}
            onNavigate={onNavigate}
            actionsPlacement={actionsPlacement}
            hideSubtitle={hideSubtitle || actionsPlacement === "stacked"}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {groups.map(({ kind, spaces: list }) => {
        const open = openMap[kind] ?? false;
        const label = spaceKindLabel(kind);
        return (
          <div key={kind} className="space-y-0.5">
            <button
              type="button"
              onClick={() => toggleKind(kind)}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-[11px] font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--brand-ink)]"
              aria-expanded={open}
            >
              <span>{label}</span>
              <span className="font-medium">{open ? "收起" : "展开"}</span>
            </button>
            {open
              ? list.map((s) => (
                  <SpaceNavRow
                    key={s.id}
                    space={s}
                    subtitle={subtitleFor?.(s) ?? label}
                    onQuickCreate={onQuickCreate}
                    onNavigate={onNavigate}
                    actionsPlacement={actionsPlacement}
                    hideSubtitle={hideSubtitle}
                  />
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}

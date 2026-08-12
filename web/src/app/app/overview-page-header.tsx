"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SpaceMemberOption, SpaceNavItem } from "@/lib/todos";

type Props = {
  members: SpaceMemberOption[];
  spaces?: SpaceNavItem[];
  /** 首屏未带成员时，客户端再拉（日历加速） */
  loadMembersClient?: boolean;
};

function parseSpaceIds(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 总览顶栏：人员 + 空间筛选（无标题；日/周/月在侧栏） */
export function OverviewPageHeader({
  members: membersProp,
  spaces = [],
  loadMembersClient = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [members, setMembers] = useState(membersProp);
  const assignee = searchParams.get("assignee") || "";
  const selectedSpaceIds = parseSpaceIds(searchParams.get("spaces"));
  const membersSigRef = useRef("");
  const spaceIdsKey = spaces.map((s) => s.id).join(",");
  const fetchedForSpacesRef = useRef("");

  // 服务端有成员才同步；空数组不覆盖本地（避免 URL 切换 RSC 闪掉人员下拉）
  useEffect(() => {
    if (membersProp.length === 0) return;
    const sig = membersProp.map((m) => m.user_id).join(",");
    if (sig === membersSigRef.current) return;
    membersSigRef.current = sig;
    setMembers(membersProp);
  }, [membersProp]);

  useEffect(() => {
    if (!loadMembersClient || membersProp.length > 0 || !spaceIdsKey) {
      return;
    }
    // 已为当前空间集拉过则跳过，避免 URL 切换时重复请求 / 取消竞态
    if (fetchedForSpacesRef.current === spaceIdsKey) return;
    let cancelled = false;
    const supabase = createClient();
    const spaceIds = spaceIdsKey.split(",").filter(Boolean);
    void (async () => {
      const { data } = await supabase
        .from("space_members")
        .select("user_id, space_id, profiles(display_name, email)")
        .in("space_id", spaceIds);
      if (cancelled || !data) return;
      const map = new Map<string, SpaceMemberOption>();
      for (const row of data) {
        const raw = row.profiles as unknown;
        const profile = (
          Array.isArray(raw) ? raw[0] : raw
        ) as { display_name: string; email: string | null } | null | undefined;
        if (map.has(row.user_id)) continue;
        map.set(row.user_id, {
          user_id: row.user_id,
          display_name: profile?.display_name ?? "成员",
          email: profile?.email ?? null,
        });
      }
      const next = [...map.values()];
      fetchedForSpacesRef.current = spaceIdsKey;
      membersSigRef.current = next.map((m) => m.user_id).join(",");
      setMembers(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMembersClient, membersProp.length, spaceIdsKey]);

  function patchQuery(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  function setSelectedSpaces(ids: string[]) {
    patchQuery({
      spaces: ids.length > 0 ? ids.join(",") : null,
    });
  }

  const spaceLabel =
    selectedSpaceIds.length === 0
      ? "全部空间"
      : selectedSpaceIds.length === 1
        ? (spaces.find((s) => s.id === selectedSpaceIds[0])?.name ?? "1 个空间")
        : `已选 ${selectedSpaceIds.length} 个`;

  const showPeople = members.length > 0;
  const showSpaces = spaces.length > 0;
  if (!showPeople && !showSpaces) return null;

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-muted)] px-4 py-2 md:px-6 md:py-3">
      {showPeople ? (
        <label className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span className="shrink-0">人员</span>
          <select
            className="max-w-[10rem] rounded-lg border border-[var(--border-muted)] bg-white px-2 py-1.5 text-sm text-[var(--brand-ink)] outline-none focus:border-brand sm:max-w-[14rem]"
            value={assignee}
            onChange={(e) =>
              patchQuery({ assignee: e.target.value || null })
            }
          >
            <option value="">全部人员</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {showSpaces ? (
        <label className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span className="shrink-0">空间</span>
          <SpaceMultiSelect
            spaces={spaces}
            selectedIds={selectedSpaceIds}
            label={spaceLabel}
            onChange={setSelectedSpaces}
          />
        </label>
      ) : null}
    </header>
  );
}

function SpaceMultiSelect({
  spaces,
  selectedIds,
  label,
  onChange,
}: {
  spaces: SpaceNavItem[];
  selectedIds: string[];
  label: string;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        className="max-w-[10rem] truncate rounded-lg border border-[var(--border-muted)] bg-white px-2 py-1.5 text-left text-sm text-[var(--brand-ink)] outline-none hover:border-brand sm:max-w-[14rem]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-56 w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-[var(--border-muted)] bg-white py-1 shadow-lg">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
            onClick={() => {
              onChange([]);
              setOpen(false);
            }}
          >
            <span
              className={[
                "flex h-4 w-4 items-center justify-center rounded border text-[10px]",
                selectedIds.length === 0
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300",
              ].join(" ")}
            >
              {selectedIds.length === 0 ? "✓" : ""}
            </span>
            全部空间
          </button>
          {spaces.map((s) => {
            const checked = selectedIds.includes(s.id);
            return (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-[var(--brand-ink)] hover:bg-[var(--surface-muted)]"
              >
                <input
                  type="checkbox"
                  className="rounded border-zinc-300"
                  checked={checked}
                  onChange={() => toggle(s.id)}
                />
                <span className="min-w-0 truncate">{s.name}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

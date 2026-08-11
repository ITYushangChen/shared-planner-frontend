"use client";

import { useEffect } from "react";
import { useUiPrefsOptional } from "./ui-prefs-provider";

/** 侧栏数据到达后写入空间背景等 prefs，不阻塞首屏 */
export function HydrateSpacePrefs({
  spacePrefsByIdRaw,
}: {
  spacePrefsByIdRaw: Record<string, unknown>;
}) {
  const ctx = useUiPrefsOptional();
  const hydrate = ctx?.hydrateSpacePrefs;
  useEffect(() => {
    if (!hydrate || Object.keys(spacePrefsByIdRaw).length === 0) return;
    hydrate(spacePrefsByIdRaw);
  }, [hydrate, spacePrefsByIdRaw]);
  return null;
}

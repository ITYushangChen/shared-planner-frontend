"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  mergePriorityColors,
  parseUiPrefs,
  resolveBackground,
  type PriorityColors,
  type ResolvedBackground,
  type UiPrefs,
} from "@/lib/ui-prefs";

type Ctx = {
  globalPrefs: UiPrefs;
  spacePrefsById: Record<string, UiPrefs>;
  priorityColors: PriorityColors;
  activeSpaceId: string | null;
  resolvedBg: ResolvedBackground;
  /** 侧栏流式到达后补全各空间 ui_prefs */
  hydrateSpacePrefs: (raw: Record<string, unknown>) => void;
};

const UiPrefsContext = createContext<Ctx | null>(null);

export function useUiPrefs() {
  const ctx = useContext(UiPrefsContext);
  if (!ctx) {
    throw new Error("useUiPrefs must be used within UiPrefsProvider");
  }
  return ctx;
}

export function useUiPrefsOptional(): Ctx | null {
  return useContext(UiPrefsContext);
}

type Props = {
  globalPrefsRaw?: unknown;
  spacePrefsByIdRaw?: Record<string, unknown>;
  children: ReactNode;
};

function parseSpacePrefsMap(raw: Record<string, unknown>) {
  const out: Record<string, UiPrefs> = {};
  for (const [id, value] of Object.entries(raw)) {
    out[id] = parseUiPrefs(value);
  }
  return out;
}

export function UiPrefsProvider({
  globalPrefsRaw,
  spacePrefsByIdRaw = {},
  children,
}: Props) {
  const pathname = usePathname();
  const activeSpaceId = useMemo(() => {
    const m = pathname?.match(/^\/app\/spaces\/([^/]+)/);
    return m?.[1] ?? null;
  }, [pathname]);

  const globalPrefs = useMemo(
    () => parseUiPrefs(globalPrefsRaw),
    [globalPrefsRaw],
  );

  const [spacePrefsById, setSpacePrefsById] = useState(() =>
    parseSpacePrefsMap(spacePrefsByIdRaw),
  );

  useEffect(() => {
    setSpacePrefsById(parseSpacePrefsMap(spacePrefsByIdRaw));
  }, [spacePrefsByIdRaw]);

  const hydrateSpacePrefs = useCallback((raw: Record<string, unknown>) => {
    setSpacePrefsById((prev) => ({ ...prev, ...parseSpacePrefsMap(raw) }));
  }, []);

  const spacePrefs = activeSpaceId
    ? spacePrefsById[activeSpaceId]
    : undefined;

  const resolvedBg = useMemo(
    () => resolveBackground(globalPrefs, spacePrefs),
    [globalPrefs, spacePrefs],
  );

  const priorityColors = useMemo(
    () => mergePriorityColors(globalPrefs),
    [globalPrefs],
  );

  const value = useMemo(
    () => ({
      globalPrefs,
      spacePrefsById,
      priorityColors,
      activeSpaceId,
      resolvedBg,
      hydrateSpacePrefs,
    }),
    [
      globalPrefs,
      spacePrefsById,
      priorityColors,
      activeSpaceId,
      resolvedBg,
    ],
  );

  return (
    <UiPrefsContext.Provider value={value}>
      <div
        className="relative isolate flex min-h-dvh min-w-0 flex-1"
        style={
          {
            ["--background"]: resolvedBg.bgColor,
            ["--pri-high"]: priorityColors.high,
            ["--pri-medium"]: priorityColors.medium,
            ["--pri-low"]: priorityColors.low,
          } as CSSProperties
        }
      >
        {/* 底层色：正 z-index，避免被 body 白底盖住 */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ backgroundColor: resolvedBg.bgColor }}
          aria-hidden
        />
        {/* 背景图：铺在侧栏与主区下方 */}
        {resolvedBg.bgImageUrl ? (
          <div
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              opacity: resolvedBg.bgOpacity,
              backgroundImage: `url(${JSON.stringify(resolvedBg.bgImageUrl)})`,
              backgroundSize: resolvedBg.bgSize,
              backgroundPosition: resolvedBg.bgPosition,
              backgroundRepeat: "no-repeat",
            }}
            aria-hidden
          />
        ) : null}
        <div className="relative z-10 flex min-h-dvh min-w-0 flex-1">
          {children}
        </div>
      </div>
    </UiPrefsContext.Provider>
  );
}

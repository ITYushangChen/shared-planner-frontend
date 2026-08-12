export const SPACE_KINDS = [
  { value: "personal", label: "个人空间" },
  { value: "work", label: "工作区" },
  { value: "life", label: "生活区" },
  { value: "family", label: "家庭区" },
  { value: "other", label: "其他" },
] as const;

export type SpaceKind = (typeof SPACE_KINDS)[number]["value"];

export function spaceKindLabel(kind: string | null | undefined): string {
  const hit = SPACE_KINDS.find((k) => k.value === kind);
  return hit?.label ?? kind ?? "未分类";
}

export function isSpaceKind(value: string): value is SpaceKind {
  return SPACE_KINDS.some((k) => k.value === value);
}

export const SPACE_VISIBILITIES = [
  { value: "private", label: "私人" },
  { value: "public", label: "公共" },
] as const;

export type SpaceVisibility = (typeof SPACE_VISIBILITIES)[number]["value"];

export function spaceVisibilityLabel(v: string | null | undefined) {
  if (v === "public") return "公共";
  return "私人";
}

/**
 * 注册/bootstrap 自动创建的默认空间（如「3374446083的空间」），侧栏与总览不展示。
 * 判定：描述为「个人默认空间」，或名称以「的空间」结尾。
 */
export function isAutoDefaultSpace(s: {
  name: string;
  description?: string | null;
}): boolean {
  if (s.description === "个人默认空间") return true;
  return /的空间$/.test(s.name.trim());
}

import type { ImportanceKey, QuadrantKey } from "@/lib/todos";

export const TODO_DND_MIME = "application/x-sharetodo-id";

/** 四象限左右决定重要性（上下紧急由时间决定，拖拽不改） */
export function quadrantToImportance(key: QuadrantKey): ImportanceKey {
  return key === "urgent_important" || key === "important"
    ? "important"
    : "normal";
}

export function importanceFromQuadrantKey(key: string): ImportanceKey | null {
  if (
    key === "urgent_important" ||
    key === "urgent_normal" ||
    key === "important" ||
    key === "normal"
  ) {
    return quadrantToImportance(key);
  }
  return null;
}

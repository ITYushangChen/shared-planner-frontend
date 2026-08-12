"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  TODO_DND_MIME,
  importanceFromQuadrantKey,
} from "@/lib/quadrant-dnd";
import {
  importanceToPriority,
  todoImportance,
  type TodoRow,
} from "@/lib/todos";

type Options = {
  /** 未排期拖入象限时回调（打开编辑并提示设时间） */
  onUnscheduledDrop?: (todo: TodoRow, quadrantKey: string) => void;
};

/** 乐观覆盖 priority，并在拖入四象限时写库 */
export function useImportanceDrop(
  todoLists: TodoRow[][],
  options: Options = {},
) {
  const { onUnscheduledDrop } = options;
  const supabase = createClient();
  const [overrides, setOverrides] = useState<
    Record<string, TodoRow["priority"]>
  >({});
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dropError, setDropError] = useState("");

  useEffect(() => {
    setOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next = { ...prev };
      let changed = false;
      for (const list of todoLists) {
        for (const t of list) {
          if (next[t.id] && next[t.id] === t.priority) {
            delete next[t.id];
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [todoLists]);

  const applyPriority = useCallback(
    (list: TodoRow[]) =>
      list.map((t) =>
        overrides[t.id] ? { ...t, priority: overrides[t.id] } : t,
      ),
    [overrides],
  );

  const onDragOverQuadrant = useCallback((e: DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverKey(key);
  }, []);

  const onDragLeaveQuadrant = useCallback((e: DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOverKey(null);
  }, []);

  const onDropQuadrant = useCallback(
    async (e: DragEvent, quadrantKey: string) => {
      e.preventDefault();
      setDragOverKey(null);
      const todoId =
        e.dataTransfer.getData(TODO_DND_MIME) ||
        e.dataTransfer.getData("text/plain");
      const importance = importanceFromQuadrantKey(quadrantKey);
      if (!todoId || !importance) return;

      let current: TodoRow | undefined;
      for (const list of todoLists) {
        current = list.find((t) => t.id === todoId);
        if (current) break;
      }
      if (!current) return;

      // 未排期：更新重要度后打开编辑，提示设置时间
      if (!current.start_at) {
        const nextPriority = importanceToPriority(importance);
        if (todoImportance(current.priority) !== importance) {
          setOverrides((prev) => ({ ...prev, [todoId]: nextPriority }));
          const { error } = await supabase
            .from("todos")
            .update({ priority: nextPriority })
            .eq("id", todoId);
          if (error) {
            setOverrides((prev) => {
              const n = { ...prev };
              delete n[todoId];
              return n;
            });
            setDropError(error.message);
            return;
          }
        }
        onUnscheduledDrop?.(
          { ...current, priority: nextPriority },
          quadrantKey,
        );
        return;
      }

      const effective = overrides[todoId]
        ? { ...current, priority: overrides[todoId] }
        : current;
      if (todoImportance(effective.priority) === importance) return;

      const nextPriority = importanceToPriority(importance);
      setOverrides((prev) => ({ ...prev, [todoId]: nextPriority }));
      setDropError("");

      const { error } = await supabase
        .from("todos")
        .update({ priority: nextPriority })
        .eq("id", todoId);

      if (error) {
        setOverrides((prev) => {
          const n = { ...prev };
          delete n[todoId];
          return n;
        });
        setDropError(error.message);
        return;
      }
      // 已乐观更新 UI；由 Realtime 或下次导航同步，避免整页 refresh
    },
    [todoLists, overrides, supabase, onUnscheduledDrop],
  );

  const setTodoImportance = useCallback(
    async (todo: TodoRow, importance: "important" | "normal") => {
      const effective = overrides[todo.id]
        ? { ...todo, priority: overrides[todo.id] }
        : todo;
      if (todoImportance(effective.priority) === importance) return;

      const nextPriority = importanceToPriority(importance);
      setOverrides((prev) => ({ ...prev, [todo.id]: nextPriority }));
      setDropError("");

      const { error } = await supabase
        .from("todos")
        .update({ priority: nextPriority })
        .eq("id", todo.id);

      if (error) {
        setOverrides((prev) => {
          const n = { ...prev };
          delete n[todo.id];
          return n;
        });
        setDropError(error.message);
        return;
      }
    },
    [overrides, supabase],
  );

  const toggleImportance = useCallback(
    async (todo: TodoRow) => {
      const effective = overrides[todo.id]
        ? { ...todo, priority: overrides[todo.id] }
        : todo;
      const next =
        todoImportance(effective.priority) === "important"
          ? "normal"
          : "important";
      await setTodoImportance(todo, next);
    },
    [overrides, setTodoImportance],
  );

  return useMemo(
    () => ({
      applyPriority,
      dragOverKey,
      dropError,
      onDragOverQuadrant,
      onDragLeaveQuadrant,
      onDropQuadrant,
      setTodoImportance,
      toggleImportance,
    }),
    [
      applyPriority,
      dragOverKey,
      dropError,
      onDragOverQuadrant,
      onDragLeaveQuadrant,
      onDropQuadrant,
      setTodoImportance,
      toggleImportance,
    ],
  );
}

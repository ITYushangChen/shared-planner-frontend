import { createClient } from "@/lib/supabase/client";
import {
  emitNotificationToast,
  emitNotificationsChanged,
} from "@/lib/notify-events";

/** 保存指派/改期后：通知被指派人并检测冲突 */
export async function notifyTodoAssignment(todoId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("notify_todo_assignment", {
    p_todo_id: todoId,
  });
  if (error) {
    console.warn("notify_todo_assignment:", error.message);
    return null;
  }

  const result = data as {
    assigned_notifications: number;
    conflict_resolutions: number;
  } | null;

  // 本机立刻刷新铃铛角标（不等 Realtime）
  emitNotificationsChanged();

  if (result && result.conflict_resolutions > 0) {
    emitNotificationToast({
      title: "日程冲突提醒",
      body: `检测到 ${result.conflict_resolutions} 处冲突，请到消息中心处理`,
      id: `conflict-${todoId}-${Date.now()}`,
    });
  }

  return result;
}

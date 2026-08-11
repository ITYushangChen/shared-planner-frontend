import { Router } from "express";
import { z } from "zod";
import { chatJson } from "../lib/deepseek";
import {
  assertSpaceMember,
  listSpaceMembers,
  listUserSpaceIds,
} from "../lib/space";
import { createAdminClient } from "../lib/supabase";
import type { AuthedRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { checkConflicts, priorityWeight } from "../services/todos";

const bodySchema = z
  .object({
    space_id: z.string().uuid().optional(),
    all_spaces: z.boolean().optional().default(false),
    text: z.string().optional(),
    todo_ids: z.array(z.string().uuid()).optional(),
    confirm: z.boolean().optional().default(false),
    workday_start: z.string().optional().default("09:00"),
    workday_end: z.string().optional().default("18:00"),
    timezone: z.string().optional().default("Asia/Shanghai"),
  })
  .refine((d) => d.all_spaces || d.space_id, {
    message: "需要 space_id 或 all_spaces",
  });

type Suggestion = {
  todo_id: string;
  title: string;
  start_at: string;
  end_at: string;
  reason?: string;
};

export const aiScheduleRouter = Router();

aiScheduleRouter.post("/schedule", requireAuth, async (req, res) => {
  try {
    const auth = (req as AuthedRequest).auth!;
    const body = bodySchema.parse(req.body);
    const admin = createAdminClient();

    const spaceIds = body.all_spaces
      ? await listUserSpaceIds(admin, auth.user.id)
      : [body.space_id!];

    if (spaceIds.length === 0) {
      res.json({ suggestions: [], message: "没有可访问的空间" });
      return;
    }

    if (!body.all_spaces) {
      await assertSpaceMember(admin, body.space_id!, auth.user.id);
    }

    // 成员目录：单空间用该空间成员；全部空间合并去重
    const memberMap = new Map<
      string,
      { user_id: string; display_name: string }
    >();
    for (const sid of spaceIds) {
      const ms = await listSpaceMembers(admin, sid);
      for (const m of ms) {
        if (!memberMap.has(m.user_id)) {
          memberMap.set(m.user_id, {
            user_id: m.user_id,
            display_name: m.display_name,
          });
        }
      }
    }
    const members = [...memberMap.values()];

    let query = admin
      .from("todos")
      .select(
        "id, space_id, title, description, priority, status, start_at, end_at, due_at, is_all_day, todo_assignees(user_id)",
      )
      .in("space_id", spaceIds)
      .neq("status", "done");

    if (body.todo_ids?.length) {
      query = query.in("id", body.todo_ids);
    } else {
      query = query.is("start_at", null);
    }

    const { data: todos, error } = await query;
    if (error) throw new Error(error.message);
    if (!todos?.length) {
      res.json({ suggestions: [], message: "没有需要排期的待办" });
      return;
    }

    const { data: busy } = await admin
      .from("todos")
      .select("id, space_id, title, start_at, end_at, todo_assignees(user_id)")
      .in("space_id", spaceIds)
      .neq("status", "done")
      .not("start_at", "is", null);

    const parsed = await chatJson<{ suggestions: Suggestion[] }>({
      system: `你是日程排期助手。根据未排期待办与成员已占用时段，给出不冲突的时间建议。
可跨多个空间排期；同一指派人在任意空间的时段都不可重叠。
只输出 JSON：
{
  "suggestions": [
    {
      "todo_id": "uuid",
      "title": "标题",
      "start_at": "ISO8601",
      "end_at": "ISO8601",
      "reason": "原因"
    }
  ]
}
规则：
- 优先高优先级、临近 due_at
- 尽量落在 workday_start~workday_end
- 同一指派人时间不可重叠
- todo_id 必须来自输入列表`,
      user: JSON.stringify({
        timezone: body.timezone,
        workday_start: body.workday_start,
        workday_end: body.workday_end,
        scope: body.all_spaces ? "all_spaces" : "single_space",
        request: body.text || "帮我安排未完成/未排期的任务",
        members: members.map((m) => ({
          id: m.user_id,
          name: m.display_name,
        })),
        unscheduled: [...todos]
          .sort(
            (a, b) =>
              priorityWeight(b.priority) - priorityWeight(a.priority),
          )
          .map((t) => ({
            id: t.id,
            space_id: t.space_id,
            title: t.title,
            priority: t.priority,
            due_at: t.due_at,
            assignees: (t.todo_assignees as { user_id: string }[] | null)?.map(
              (a) => a.user_id,
            ),
          })),
        busy: busy || [],
        now: new Date().toISOString(),
      }),
    });

    const suggestions = (parsed.suggestions || []).filter((s) =>
      todos.some((t) => t.id === s.todo_id),
    );

    if (!body.confirm) {
      res.json({ preview: true, suggestions });
      return;
    }

    const applied: string[] = [];
    for (const s of suggestions) {
      const todo = todos.find((t) => t.id === s.todo_id);
      if (!todo) continue;

      const assigneeIds =
        (todo.todo_assignees as { user_id: string }[] | null)?.map(
          (a) => a.user_id,
        ) || [];

      for (const uid of assigneeIds) {
        const conflicts = await checkConflicts({
          admin,
          spaceId: todo.space_id as string,
          userId: uid,
          startAt: s.start_at,
          endAt: s.end_at,
          excludeTodoId: s.todo_id,
        });
        if (conflicts.length > 0) {
          throw new Error(
            `排期冲突：${s.title} 与用户 ${uid} 的已有日程重叠`,
          );
        }
      }

      const { error: upErr } = await admin
        .from("todos")
        .update({
          start_at: s.start_at,
          end_at: s.end_at,
          is_all_day: false,
        })
        .eq("id", s.todo_id)
        .eq("space_id", todo.space_id);
      if (upErr) throw new Error(upErr.message);
      applied.push(s.todo_id);
    }

    await admin.from("ai_actions").insert({
      space_id: spaceIds[0],
      user_id: auth.user.id,
      action_type: "reschedule",
      payload: { suggestions, all_spaces: body.all_spaces },
      result_todo_ids: applied,
      status: "applied",
    });

    res.json({ preview: false, applied, suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Not a member") ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

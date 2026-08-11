import { Router } from "express";
import { z } from "zod";
import { chatText } from "../lib/deepseek";
import { assertSpaceMember } from "../lib/space";
import { createAdminClient } from "../lib/supabase";
import type { AuthedRequest } from "../middleware/auth";
import { requireAuth, requireCronSecret } from "../middleware/auth";

function dayBounds(timezone: string, date = new Date()) {
  // Approximate local day bounds using Intl parts → reconstruct UTC range via offset trick
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = fmt.format(date); // YYYY-MM-DD
  const start = new Date(`${localDate}T00:00:00`);
  const end = new Date(`${localDate}T23:59:59.999`);

  // Convert "wall time in timezone" to UTC using a formatter offset estimate
  const toUtc = (wall: Date) => {
    const asUtc = new Date(
      wall.toLocaleString("en-US", { timeZone: "UTC" }),
    ).getTime();
    const asTz = new Date(
      wall.toLocaleString("en-US", { timeZone: timezone }),
    ).getTime();
    const offset = asTz - asUtc;
    return new Date(wall.getTime() - offset);
  };

  return {
    localDate,
    startIso: toUtc(start).toISOString(),
    endIso: toUtc(end).toISOString(),
  };
}

async function buildSummaryForUser(params: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  spaceId?: string;
  timezone: string;
}) {
  const { localDate, startIso, endIso } = dayBounds(params.timezone);
  let query = params.admin
    .from("todos")
    .select(
      "id, title, priority, status, start_at, end_at, due_at, space_id, todo_assignees!inner(user_id)",
    )
    .eq("todo_assignees.user_id", params.userId)
    .neq("status", "done");

  if (params.spaceId) query = query.eq("space_id", params.spaceId);

  const { data: todos, error } = await query;
  if (error) throw new Error(error.message);

  const today = (todos || []).filter((t) => {
    if (t.start_at && t.start_at <= endIso && (t.end_at || t.start_at) >= startIso) {
      return true;
    }
    if (t.due_at && t.due_at >= startIso && t.due_at <= endIso) return true;
    return false;
  });

  const unscheduled = (todos || []).filter((t) => !t.start_at).slice(0, 10);

  const text = await chatText({
    system:
      "你是 ShareTodo 的每日摘要助手。用简洁中文写 2～4 句今日提醒。输入列表均为「指派给当前用户」的待办，必须逐条点名标题，不要遗漏已排期项；并提醒未排期任务。不要用 Markdown 标题。",
    user: JSON.stringify({
      local_date: localDate,
      timezone: params.timezone,
      note: "以下任务均已指派给该用户，摘要必须覆盖",
      today_scheduled: today.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        start_at: t.start_at,
        end_at: t.end_at,
        due_at: t.due_at,
      })),
      unscheduled_assigned_to_me: unscheduled.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
      })),
    }),
  });

  return { localDate, text, todayCount: today.length, todos: today };
}

export const dailySummaryRouter = Router();

/** 登录用户手动拉取自己的今日摘要，并写入 notifications */
dailySummaryRouter.post("/daily-summary", requireAuth, async (req, res) => {
  try {
    const auth = (req as AuthedRequest).auth!;
    const body = z
      .object({
        space_id: z.string().uuid().optional(),
        timezone: z.string().optional(),
      })
      .parse(req.body || {});

    const admin = createAdminClient();
    if (body.space_id) {
      await assertSpaceMember(admin, body.space_id, auth.user.id);
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("timezone")
      .eq("id", auth.user.id)
      .maybeSingle();

    const timezone = body.timezone || profile?.timezone || "Asia/Shanghai";
    const summary = await buildSummaryForUser({
      admin,
      userId: auth.user.id,
      spaceId: body.space_id,
      timezone,
    });

    const { data: notification, error } = await admin
      .from("notifications")
      .insert({
        user_id: auth.user.id,
        space_id: body.space_id || null,
        type: "daily_summary",
        title: `${summary.localDate} 今日摘要`,
        body: summary.text,
        payload: { todo_ids: summary.todos.map((t) => t.id) },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (body.space_id) {
      await admin.from("ai_actions").insert({
        space_id: body.space_id,
        user_id: auth.user.id,
        action_type: "daily_summary",
        payload: { text: summary.text, local_date: summary.localDate },
        result_todo_ids: summary.todos.map((t) => t.id),
        status: "applied",
      });
    }

    res.json({
      notification_id: notification.id,
      date: summary.localDate,
      summary: summary.text,
      today_count: summary.todayCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Not a member") ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

/** Railway Cron：为所有用户生成摘要（需 x-cron-secret） */
dailySummaryRouter.post(
  "/jobs/daily-summary",
  requireCronSecret,
  async (_req, res) => {
    try {
      const admin = createAdminClient();
      const { data: profiles, error } = await admin
        .from("profiles")
        .select("id, timezone");
      if (error) throw new Error(error.message);

      let created = 0;
      for (const p of profiles || []) {
        const summary = await buildSummaryForUser({
          admin,
          userId: p.id,
          timezone: p.timezone || "Asia/Shanghai",
        });
        if (summary.todayCount === 0 && summary.text.length < 5) continue;

        const { error: nErr } = await admin.from("notifications").insert({
          user_id: p.id,
          type: "daily_summary",
          title: `${summary.localDate} 今日摘要`,
          body: summary.text,
          payload: { todo_ids: summary.todos.map((t) => t.id) },
        });
        if (!nErr) created += 1;
      }

      res.json({ ok: true, created });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  },
);

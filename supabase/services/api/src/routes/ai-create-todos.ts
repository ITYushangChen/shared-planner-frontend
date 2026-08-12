import { Router } from "express";
import { z } from "zod";
import { chatJson } from "../lib/deepseek";
import {
  assertSpaceMember,
  listSpaceMembers,
  memberDirectoryPrompt,
  resolveAssignees,
} from "../lib/space";
import { createAdminClient } from "../lib/supabase";
import type { AuthedRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import {
  insertTodosWithAssignees,
  type ParsedTodo,
  type Priority,
  type TodoPreview,
} from "../services/todos";

const bodySchema = z.object({
  space_id: z.string().uuid(),
  text: z.string().min(1),
  confirm: z.boolean().optional().default(false),
  timezone: z.string().optional().default("Asia/Shanghai"),
  now: z.string().optional(),
});

export const aiCreateTodosRouter = Router();

aiCreateTodosRouter.post("/create-todos", requireAuth, async (req, res) => {
  try {
    const auth = (req as AuthedRequest).auth!;
    const body = bodySchema.parse(req.body);
    const admin = createAdminClient();

    await assertSpaceMember(admin, body.space_id, auth.user.id);
    const members = await listSpaceMembers(admin, body.space_id);
    const nowIso = body.now || new Date().toISOString();

    const parsed = await chatJson<{ todos: ParsedTodo[]; summary?: string }>({
      system: `你是 ShareTodo AI 助手。把用户的自然语言解析成一个或多个待办 JSON。
只输出 JSON，格式：
{
  "summary": "一句话说明",
  "todos": [
    {
      "title": "标题",
      "description": "可选",
      "priority": "high|medium|low",
      "assignee_names": ["昵称或全员"],
      "start_at": "ISO8601 或 null",
      "end_at": "ISO8601 或 null",
      "due_at": "ISO8601 或 null",
      "is_all_day": false
    }
  ]
}
规则：
- 相对时间按 timezone 与 now 解释（如「明天下午2点」「周三」）
- 有时段则同时给 start_at 与 end_at；全天事件 is_all_day=true 且给当天 start_at
- 指派人必须尽量匹配成员昵称；不确定可用「全员」或留空（默认创建者）
- 不要编造不存在的成员`,
      user: `timezone=${body.timezone}
now=${nowIso}
space members:
${memberDirectoryPrompt(members)}

user request:
${body.text}`,
    });

    const todos = Array.isArray(parsed.todos) ? parsed.todos : [];
    if (todos.length === 0) {
      res.status(422).json({ error: "AI 未解析出待办", raw: parsed });
      return;
    }

    const preview: TodoPreview[] = todos.map((t) => {
      const priority = (["high", "medium", "low"].includes(String(t.priority))
        ? t.priority
        : "medium") as Priority;
      return {
        title: String(t.title || "未命名待办").slice(0, 255),
        description: t.description ?? null,
        priority,
        assignee_names: t.assignee_names,
        start_at: t.start_at || null,
        end_at: t.end_at || null,
        due_at: t.due_at || null,
        is_all_day: Boolean(t.is_all_day),
        assignee_ids: resolveAssignees(t.assignee_names, members, auth.user.id),
      };
    });

    if (!body.confirm) {
      res.json({
        preview: true,
        summary: parsed.summary || null,
        todos: preview,
      });
      return;
    }

    const { data: conversation, error: convErr } = await admin
      .from("ai_conversations")
      .insert({
        space_id: body.space_id,
        user_id: auth.user.id,
        title: body.text.slice(0, 80),
      })
      .select("id")
      .single();
    if (convErr) throw new Error(convErr.message);

    await admin.from("ai_messages").insert([
      {
        conversation_id: conversation.id,
        role: "user",
        content: body.text,
      },
      {
        conversation_id: conversation.id,
        role: "assistant",
        content: JSON.stringify({ summary: parsed.summary, todos: preview }),
      },
    ]);

    const todoIds = await insertTodosWithAssignees({
      admin,
      spaceId: body.space_id,
      creatorId: auth.user.id,
      conversationId: conversation.id,
      items: preview,
    });

    res.json({
      preview: false,
      summary: parsed.summary || null,
      todo_ids: todoIds,
      todos: preview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Not a member") ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

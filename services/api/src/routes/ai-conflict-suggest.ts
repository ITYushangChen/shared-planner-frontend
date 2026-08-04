import { Router } from "express";
import { z } from "zod";
import { chatJson } from "../lib/deepseek";
import { assertSpaceMember, listSpaceMembers } from "../lib/space";
import { createAdminClient } from "../lib/supabase";
import type { AuthedRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

const bodySchema = z.object({
  space_id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
  confirm: z.boolean().optional().default(false),
});

type MoveSuggestion = {
  todo_id: string;
  title: string;
  from_start_at: string;
  from_end_at: string;
  to_start_at: string;
  to_end_at: string;
  reason: string;
};

export const aiConflictSuggestRouter = Router();

aiConflictSuggestRouter.post(
  "/conflict-suggest",
  requireAuth,
  async (req, res) => {
    try {
      const auth = (req as AuthedRequest).auth!;
      const body = bodySchema.parse(req.body);
      const admin = createAdminClient();
      await assertSpaceMember(admin, body.space_id, auth.user.id);
      const members = await listSpaceMembers(admin, body.space_id);

      const targetUserId = body.user_id || auth.user.id;
      if (!members.some((m) => m.user_id === targetUserId)) {
        res.status(400).json({ error: "user_id is not in this space" });
        return;
      }

      const { data: todos, error } = await admin
        .from("todos")
        .select(
          "id, title, priority, start_at, end_at, status, todo_assignees!inner(user_id)",
        )
        .eq("space_id", body.space_id)
        .eq("todo_assignees.user_id", targetUserId)
        .neq("status", "done")
        .not("start_at", "is", null)
        .order("start_at", { ascending: true });

      if (error) throw new Error(error.message);

      const scheduled = todos || [];
      const conflicts: Array<{ a: string; b: string }> = [];
      for (let i = 0; i < scheduled.length; i++) {
        for (let j = i + 1; j < scheduled.length; j++) {
          const a = scheduled[i];
          const b = scheduled[j];
          if (!a.start_at || !a.end_at || !b.start_at || !b.end_at) continue;
          if (a.start_at < b.end_at && a.end_at > b.start_at) {
            conflicts.push({ a: a.id, b: b.id });
          }
        }
      }

      if (conflicts.length === 0) {
        res.json({ conflicts: [], suggestions: [], message: "未检测到冲突" });
        return;
      }

      const parsed = await chatJson<{ suggestions: MoveSuggestion[] }>({
        system: `你是日程冲突解决助手。给定某人的冲突待办，建议把较低优先级任务挪到空闲时段。
只输出 JSON：
{
  "suggestions": [
    {
      "todo_id": "uuid",
      "title": "标题",
      "from_start_at": "ISO",
      "from_end_at": "ISO",
      "to_start_at": "ISO",
      "to_end_at": "ISO",
      "reason": "原因"
    }
  ]
}`,
        user: JSON.stringify({
          member: members.find((m) => m.user_id === targetUserId),
          todos: scheduled,
          conflict_pairs: conflicts,
          now: new Date().toISOString(),
        }),
      });

      const suggestions = (parsed.suggestions || []).filter((s) =>
        scheduled.some((t) => t.id === s.todo_id),
      );

      if (!body.confirm) {
        res.json({ preview: true, conflicts, suggestions });
        return;
      }

      const applied: string[] = [];
      for (const s of suggestions) {
        const { error: upErr } = await admin
          .from("todos")
          .update({
            start_at: s.to_start_at,
            end_at: s.to_end_at,
          })
          .eq("id", s.todo_id)
          .eq("space_id", body.space_id);
        if (upErr) throw new Error(upErr.message);
        applied.push(s.todo_id);
      }

      await admin.from("ai_actions").insert({
        space_id: body.space_id,
        user_id: auth.user.id,
        action_type: "conflict_suggest",
        payload: { conflicts, suggestions },
        result_todo_ids: applied,
        status: "applied",
      });

      res.json({ preview: false, conflicts, suggestions, applied });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const status = message.includes("Not a member") ? 403 : 400;
      res.status(status).json({ error: message });
    }
  },
);

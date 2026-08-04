import { Router } from "express";
import { z } from "zod";
import { assertSpaceMember } from "../lib/space";
import { createAdminClient } from "../lib/supabase";
import type { AuthedRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { computeSortScore } from "../services/todos";

const bodySchema = z.object({
  space_id: z.string().uuid(),
  persist: z.boolean().optional().default(true),
});

export const aiReorderRouter = Router();

aiReorderRouter.post("/reorder", requireAuth, async (req, res) => {
  try {
    const auth = (req as AuthedRequest).auth!;
    const body = bodySchema.parse(req.body);
    const admin = createAdminClient();
    await assertSpaceMember(admin, body.space_id, auth.user.id);

    const { data: todos, error } = await admin
      .from("todos")
      .select("id, title, priority, status, due_at, start_at, sort_score")
      .eq("space_id", body.space_id);

    if (error) throw new Error(error.message);

    const ranked = (todos || [])
      .map((t) => ({
        ...t,
        sort_score: computeSortScore(t),
      }))
      .sort((a, b) => b.sort_score - a.sort_score);

    if (body.persist) {
      for (const t of ranked) {
        const { error: upErr } = await admin
          .from("todos")
          .update({ sort_score: t.sort_score })
          .eq("id", t.id);
        if (upErr) throw new Error(upErr.message);
      }

      await admin.from("ai_actions").insert({
        space_id: body.space_id,
        user_id: auth.user.id,
        action_type: "reorder",
        payload: {
          order: ranked.map((t) => ({ id: t.id, sort_score: t.sort_score })),
        },
        result_todo_ids: ranked.map((t) => t.id),
        status: "applied",
      });
    }

    res.json({
      todos: ranked.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        due_at: t.due_at,
        start_at: t.start_at,
        sort_score: t.sort_score,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Not a member") ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

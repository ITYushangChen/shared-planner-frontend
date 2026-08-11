import fs from "fs";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { chatJson } from "../lib/deepseek";
import type { AuthedRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

const bodySchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().min(1),
        status: z.enum(["done", "in_progress", "todo"]).optional(),
        category: z.string().optional(),
      }),
    )
    .min(1)
    .max(50),
});

/** 读取任务名称改写规则（renwumingcheng 文件）；缺失时使用兜底规则 */
function loadTaskNameRules(): string {
  try {
    const file = path.join(process.cwd(), "renwumingcheng");
    const content = fs.readFileSync(file, "utf8").trim();
    if (content) return content;
  } catch {
    // 文件缺失时忽略，走兜底规则
  }
  return "根据任务名称把任务改写成大白话、有结果导向的一句话，说明对公司/客户有什么好处，不用术语，口语化，只输出 JSON。";
}

export const aiReportPlainRouter = Router();

/** 按 renwumingcheng 规则，把任务名称改写成大白话、有结果导向的一句话 */
aiReportPlainRouter.post("/report-plain", requireAuth, async (req, res) => {
  try {
    const auth = (req as AuthedRequest).auth!;
    const body = bodySchema.parse(req.body || {});

    const parsed = await chatJson<{
      items?: Array<{ id: string; text: string }>;
    }>({
      system: `你是企业周报助手。严格按下面的规则文件内容，把每个任务名称改写成报告中的大白话描述：\n\n${loadTaskNameRules()}`,
      user: JSON.stringify({
        user_id: auth.user.id,
        tasks: body.tasks,
      }),
      temperature: 0.6,
    });

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    res.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

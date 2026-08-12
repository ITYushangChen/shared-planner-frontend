import cors from "cors";
import express from "express";
import { assertRuntimeEnv, config } from "./config";
import { aiConflictSuggestRouter } from "./routes/ai-conflict-suggest";
import { aiCreateTodosRouter } from "./routes/ai-create-todos";
import { aiReorderRouter } from "./routes/ai-reorder";
import { aiScheduleRouter } from "./routes/ai-schedule";
import { aiReportPlainRouter } from "./routes/ai-report-plain";
import { dailySummaryRouter } from "./routes/daily-summary";

assertRuntimeEnv();

const app = express();

app.use(
  cors({
    origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(","),
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "shared-planner-api",
    model: config.deepseekModel,
  });
});

app.use("/ai", aiCreateTodosRouter);
app.use("/ai", aiScheduleRouter);
app.use("/ai", aiReorderRouter);
app.use("/ai", aiConflictSuggestRouter);
app.use("/ai", aiReportPlainRouter);
app.use("/ai", dailySummaryRouter);
app.use(dailySummaryRouter);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = err instanceof Error ? err.message : "Server error";
    res.status(500).json({ error: message });
  },
);

app.listen(config.port, () => {
  console.log(`ShareTodo API listening on :${config.port}`);
});

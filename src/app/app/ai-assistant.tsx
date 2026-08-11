"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AiApiError,
  conflictSuggest,
  createTodos,
  dailySummary,
  getApiBaseUrl,
  reorderTodos,
  scheduleTodos,
  type AiTodoPreview,
  type ConflictMove,
  type ScheduleSuggestion,
} from "@/lib/ai-api";
import type { SpaceNavItem } from "@/lib/todos";
import { useSpeechToText } from "@/lib/use-speech-to-text";

type Mode = "create" | "schedule" | "conflict" | "reorder" | "summary";

type Props = {
  spaces: SpaceNavItem[];
  defaultSpaceId?: string;
  timezone?: string;
  /** 抽屉内：去掉外层卡片边框 */
  plain?: boolean;
};

const MODE_LABEL: Record<Mode, string> = {
  create: "创建",
  schedule: "排期",
  conflict: "冲突",
  reorder: "排序",
  summary: "摘要",
};

const PRIORITY_LABEL = {
  high: "重要",
  medium: "不重要",
  low: "不重要",
} as const;
/** 排期/冲突/排序/摘要可选：全部空间 */
const ALL_SPACES = "__all__";

export function AiAssistant({
  spaces,
  defaultSpaceId,
  timezone,
  plain = false,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [spaceId, setSpaceId] = useState(
    defaultSpaceId || spaces[0]?.id || "",
  );
  const allSpaces = spaceId === ALL_SPACES;
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  /** 开始录音时已有文案，识别结果追加在其后 */
  const speechBaseRef = useRef("");
  /** 本轮已确认的最终识别片段 */
  const speechFinalRef = useRef("");

  useEffect(() => {
    if (defaultSpaceId) setSpaceId(defaultSpaceId);
  }, [defaultSpaceId]);

  const onSpeechTranscript = useCallback((chunk: string, isFinal: boolean) => {
    if (!chunk) return;
    if (isFinal) {
      speechFinalRef.current = [speechFinalRef.current, chunk]
        .filter(Boolean)
        .join(" ");
      setText(
        [speechBaseRef.current, speechFinalRef.current]
          .filter(Boolean)
          .join(speechBaseRef.current ? " " : ""),
      );
      return;
    }
    setText(
      [speechBaseRef.current, speechFinalRef.current, chunk]
        .filter(Boolean)
        .join(" "),
    );
  }, []);

  const {
    supported: speechSupported,
    listening,
    error: speechError,
    start: startSpeech,
    stop: stopSpeech,
  } = useSpeechToText(onSpeechTranscript);

  function toggleSpeech() {
    if (listening) {
      stopSpeech();
      return;
    }
    speechBaseRef.current = text.trim();
    speechFinalRef.current = "";
    startSpeech();
  }

  const [createPreview, setCreatePreview] = useState<AiTodoPreview[] | null>(
    null,
  );
  const [schedulePreview, setSchedulePreview] = useState<
    ScheduleSuggestion[] | null
  >(null);
  const [conflictPreview, setConflictPreview] = useState<{
    conflicts: Array<{ a: string; b: string }>;
    suggestions: ConflictMove[];
  } | null>(null);
  const [reorderPreview, setReorderPreview] = useState<
    Array<{ id: string; title: string; sort_score: number; priority: string }>
    | null
  >(null);

  const apiReady = Boolean(getApiBaseUrl());
  const tz =
    timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "Asia/Shanghai";

  const placeholders = useMemo(
    () => ({
      create:
        "例：周五下班前上线 V2.3，周三下午评审，周四全天开发联调，指派给小明",
      schedule: "例：把未排期任务安排到本周工作时间内，优先重要任务",
      conflict: "检测当前用户日程冲突并给出挪动建议",
      reorder: "按紧急度重算排序分并更新列表",
      summary: "生成「指派给我」的今日待办摘要并写入通知",
    }),
    [],
  );

  function clearPreviews() {
    setCreatePreview(null);
    setSchedulePreview(null);
    setConflictPreview(null);
    setReorderPreview(null);
    setSummary(null);
  }

  function onModeChange(next: Mode) {
    if (listening) stopSpeech();
    setMode(next);
    clearPreviews();
    setMsg("");
    // 创建必须落到具体空间
    if (next === "create" && spaceId === ALL_SPACES) {
      setSpaceId(defaultSpaceId || spaces[0]?.id || "");
    }
  }

  async function runPreview(e?: FormEvent) {
    e?.preventDefault();
    if (listening) stopSpeech();
    if (mode === "create" && (!spaceId || spaceId === ALL_SPACES)) {
      setMsg("创建待办请选择具体空间");
      return;
    }
    if (!spaceId && mode !== "summary") {
      setMsg("请选择空间");
      return;
    }
    if ((mode === "create" || mode === "schedule") && !text.trim()) {
      setMsg("请先输入一句话");
      return;
    }

    setLoading(true);
    setMsg("AI 思考中…");
    clearPreviews();

    try {
      if (mode === "create") {
        const res = await createTodos({
          space_id: spaceId,
          text: text.trim(),
          confirm: false,
          timezone: tz,
        });
        if ("todos" in res && res.preview) {
          setCreatePreview(res.todos);
          setSummary(res.summary);
          setMsg(`预览 ${res.todos.length} 条，确认后写入`);
        }
      } else if (mode === "schedule") {
        const res = await scheduleTodos({
          space_id: allSpaces ? undefined : spaceId,
          all_spaces: allSpaces,
          text: text.trim() || undefined,
          confirm: false,
          timezone: tz,
        });
        if ("message" in res && (!res.suggestions || res.suggestions.length === 0)) {
          setMsg(res.message || "没有需要排期的待办");
        } else if ("suggestions" in res) {
          setSchedulePreview(res.suggestions);
          setMsg(
            res.suggestions.length
              ? `预览 ${res.suggestions.length} 条排期建议${allSpaces ? "（全部空间）" : ""}`
              : "未生成排期建议",
          );
        }
      } else if (mode === "conflict") {
        const res = await conflictSuggest({
          space_id: allSpaces ? undefined : spaceId,
          all_spaces: allSpaces,
          confirm: false,
        });
        if ("message" in res && (!("suggestions" in res) || !res.suggestions?.length)) {
          setMsg(res.message || "未检测到冲突");
        } else if ("suggestions" in res) {
          setConflictPreview({
            conflicts: "conflicts" in res ? res.conflicts : [],
            suggestions: res.suggestions,
          });
          setMsg(
            res.suggestions.length
              ? `发现冲突，${res.suggestions.length} 条调整建议${allSpaces ? "（全部空间）" : ""}`
              : "检测到冲突但无建议",
          );
        }
      } else if (mode === "reorder") {
        const res = await reorderTodos({
          space_id: allSpaces ? undefined : spaceId,
          all_spaces: allSpaces,
          persist: false,
        });
        setReorderPreview(res.todos.slice(0, 20));
        setMsg(
          `已计算 ${res.todos.length} 条排序（未写入，点确认应用）${allSpaces ? " · 全部空间" : ""}`,
        );
      } else if (mode === "summary") {
        const res = await dailySummary({
          space_id: allSpaces ? undefined : spaceId || undefined,
          timezone: tz,
        });
        setSummary(res.summary);
        setMsg(`${res.date} 摘要已生成（今日 ${res.today_count} 项）`);
      }
    } catch (err) {
      setMsg(err instanceof AiApiError ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  async function runConfirm() {
    if (mode === "create" && (!spaceId || spaceId === ALL_SPACES)) {
      setMsg("创建待办请选择具体空间");
      return;
    }
    if (!spaceId && mode !== "summary") {
      setMsg("请选择空间");
      return;
    }
    setLoading(true);
    setMsg("写入中…");

    try {
      if (mode === "create") {
        if (!text.trim()) {
          setMsg("缺少原始输入");
          setLoading(false);
          return;
        }
        const res = await createTodos({
          space_id: spaceId,
          text: text.trim(),
          confirm: true,
          timezone: tz,
        });
        if ("todo_ids" in res) {
          setMsg(`已创建 ${res.todo_ids.length} 条待办`);
          clearPreviews();
          setText("");
          router.refresh();
        }
      } else if (mode === "schedule") {
        const res = await scheduleTodos({
          space_id: allSpaces ? undefined : spaceId,
          all_spaces: allSpaces,
          text: text.trim() || undefined,
          confirm: true,
          timezone: tz,
        });
        if ("applied" in res) {
          setMsg(`已应用 ${res.applied.length} 条排期`);
          clearPreviews();
          router.refresh();
        }
      } else if (mode === "conflict") {
        const res = await conflictSuggest({
          space_id: allSpaces ? undefined : spaceId,
          all_spaces: allSpaces,
          confirm: true,
        });
        if ("applied" in res) {
          setMsg(`已调整 ${res.applied.length} 条`);
          clearPreviews();
          router.refresh();
        }
      } else if (mode === "reorder") {
        const res = await reorderTodos({
          space_id: allSpaces ? undefined : spaceId,
          all_spaces: allSpaces,
          persist: true,
        });
        setMsg(`已更新 ${res.todos.length} 条排序分`);
        clearPreviews();
        router.refresh();
      }
    } catch (err) {
      setMsg(err instanceof AiApiError ? err.message : "确认失败");
    } finally {
      setLoading(false);
    }
  }

  const canConfirm =
    (mode === "create" && (createPreview?.length ?? 0) > 0) ||
    (mode === "schedule" && (schedulePreview?.length ?? 0) > 0) ||
    (mode === "conflict" && (conflictPreview?.suggestions.length ?? 0) > 0) ||
    (mode === "reorder" && (reorderPreview?.length ?? 0) > 0);

  const needsText = mode === "create" || mode === "schedule";
  const primaryLabel =
    mode === "summary"
      ? "生成摘要"
      : mode === "reorder"
        ? "预览排序"
        : mode === "conflict"
          ? "检测冲突"
          : "预览";

  if (spaces.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 text-sm text-zinc-500">
        请先创建或加入空间后再使用 AI
      </div>
    );
  }

  return (
    <section
      className={
        plain
          ? "bg-white"
          : "rounded-xl border border-zinc-200 bg-white p-4"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {plain ? null : (
            <h2 className="text-sm font-medium text-zinc-800">AI 助手</h2>
          )}
          <p className={plain ? "text-xs text-zinc-400" : "mt-0.5 text-xs text-zinc-400"}>
            先预览，确认后再写入（{tz}）· 请先选择目标空间
          </p>
        </div>
        {!apiReady ? (
          <p className="text-xs text-amber-700">
            未配置 NEXT_PUBLIC_API_URL
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={[
              "rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors duration-200",
              mode === m
                ? "bg-zinc-900 text-white"
                : "border border-[#2f5f8f]/55 bg-white text-[#2f5f8f] hover:bg-[#e8f0f7]",
            ].join(" ")}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <form onSubmit={runPreview} className="mt-3 flex flex-col gap-2">
        <label className="text-xs text-zinc-500">
          目标空间
          <select
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
          >
            {mode !== "create" ? (
              <option value={ALL_SPACES}>全部空间（跨空间）</option>
            ) : null}
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.visibility === "public" ? " · 公共" : ""}
              </option>
            ))}
          </select>
        </label>
        {mode !== "create" && allSpaces ? (
          <p className="text-[11px] text-zinc-400">
            将处理你加入的所有空间中的任务（创建功能仍需指定单一空间）
          </p>
        ) : null}

        {needsText ? (
          <div className="flex flex-col gap-2">
            <textarea
              className="min-h-[72px] rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
              placeholder={placeholders[mode]}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={loading || !speechSupported}
                onClick={toggleSpeech}
                className={[
                  "min-h-11 min-w-[7.5rem] touch-manipulation rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200 disabled:opacity-50",
                  listening
                    ? "bg-red-600 text-white hover:bg-red-500"
                    : "border border-[#2f5f8f]/55 bg-white text-[#2f5f8f] hover:bg-[#e8f0f7]",
                ].join(" ")}
                aria-pressed={listening}
              >
                {listening ? "停止聆听" : "语音输入"}
              </button>
              {listening ? (
                <span className="text-xs text-red-600">正在聆听，说完再点停止</span>
              ) : null}
              {!speechSupported ? (
                <span className="text-xs text-zinc-400">
                  当前浏览器不支持语音（建议 Chrome）
                </span>
              ) : null}
            </div>
            {speechError ? (
              <p className="text-xs text-amber-700">{speechError}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">{placeholders[mode]}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loading || !apiReady}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "处理中…" : primaryLabel}
          </button>
          {canConfirm ? (
            <button
              type="button"
              disabled={loading}
              onClick={runConfirm}
              className="rounded-xl border border-[var(--success)] bg-[var(--success-soft)] px-3 py-2 text-sm font-medium text-[var(--success)] transition-colors duration-200 disabled:opacity-50"
            >
              确认写入
            </button>
          ) : null}
          {(createPreview ||
            schedulePreview ||
            conflictPreview ||
            reorderPreview ||
            summary) &&
          mode !== "summary" ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                clearPreviews();
                setMsg("");
              }}
              className="rounded-xl border border-[#2f5f8f]/55 px-3 py-2 text-sm font-medium text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7] disabled:opacity-50"
            >
              丢弃预览
            </button>
          ) : null}
        </div>
      </form>

      {msg ? <p className="mt-2 text-xs text-zinc-500">{msg}</p> : null}

      {summary && mode === "summary" ? (
        <div className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700 whitespace-pre-wrap">
          {summary}
        </div>
      ) : null}

      {summary && mode === "create" ? (
        <p className="mt-2 text-sm text-zinc-600">{summary}</p>
      ) : null}

      {createPreview?.length ? (
        <ul className="mt-3 divide-y divide-zinc-100 rounded-lg border border-zinc-100">
          {createPreview.map((t, i) => (
            <li key={`${t.title}-${i}`} className="px-3 py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-medium text-zinc-900">{t.title}</span>
                <span className="shrink-0 text-xs text-zinc-400">
                  {PRIORITY_LABEL[t.priority] || t.priority}
                  {t.is_all_day ? " · 全天" : ""}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                {t.start_at
                  ? `${new Date(t.start_at).toLocaleString()}${
                      t.end_at
                        ? ` – ${new Date(t.end_at).toLocaleString()}`
                        : ""
                    }`
                  : "未排期"}
                {t.assignee_names?.length
                  ? ` · ${t.assignee_names.join("、")}`
                  : ""}
              </p>
              {t.description ? (
                <p className="mt-0.5 text-xs text-zinc-400">{t.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {schedulePreview?.length ? (
        <ul className="mt-3 divide-y divide-zinc-100 rounded-lg border border-zinc-100">
          {schedulePreview.map((s) => (
            <li key={s.todo_id} className="px-3 py-2 text-sm">
              <p className="font-medium text-zinc-900">{s.title}</p>
              <p className="text-xs text-zinc-500">
                {new Date(s.start_at).toLocaleString()} –{" "}
                {new Date(s.end_at).toLocaleString()}
              </p>
              {s.reason ? (
                <p className="text-xs text-zinc-400">{s.reason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {conflictPreview?.suggestions.length ? (
        <ul className="mt-3 divide-y divide-zinc-100 rounded-lg border border-red-100">
          {conflictPreview.suggestions.map((s) => (
            <li key={s.todo_id} className="px-3 py-2 text-sm">
              <p className="font-medium text-zinc-900">{s.title}</p>
              <p className="text-xs text-zinc-500">
                {new Date(s.from_start_at).toLocaleString()} →{" "}
                {new Date(s.to_start_at).toLocaleString()}
              </p>
              <p className="text-xs text-zinc-400">{s.reason}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {reorderPreview?.length ? (
        <ol className="mt-3 list-decimal space-y-1 rounded-lg border border-zinc-100 px-5 py-2 text-sm">
          {reorderPreview.map((t) => (
            <li key={t.id} className="text-zinc-800">
              {t.title}
              <span className="ml-2 text-xs text-zinc-400">
                {t.priority} · score {t.sort_score}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

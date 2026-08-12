import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppAuth, getMySpaceNav } from "@/lib/app-data";
import {
  TODO_SELECT,
  localDateKey,
  type TodoRow,
} from "@/lib/todos";
import {
  REPORT_STATUS_LABEL,
  categoryLabel,
  generateTaskDescription,
  taskCategory,
} from "@/lib/reports";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ReportTaskDetailPage({ params }: Props) {
  const { id } = await params;
  const { supabase, user } = await getAppAuth();

  if (!user) {
    redirect("/login");
  }

  const { data: todo } = await supabase
    .from("todos")
    .select(TODO_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (!todo) {
    return <TaskMissing />;
  }

  // 与报告页一致的可见性：空间管理员可见全部，普通成员仅可见指派给自己的任务
  const { spaces } = await getMySpaceNav();
  const space = spaces.find((s) => s.id === todo.space_id);
  const canAssign = space?.role === "owner" || space?.role === "admin";
  const assignedToMe = (todo.todo_assignees ?? []).some(
    (a) => a.user_id === user.id,
  );
  if (!canAssign && !assignedToMe) {
    return <TaskMissing />;
  }

  const t = todo as unknown as TodoRow;
  const status: "done" | "in_progress" | "todo" =
    t.status === "done"
      ? "done"
      : t.status === "in_progress"
        ? "in_progress"
        : "todo";
  const category = taskCategory(t.title);
  const description =
    t.description?.trim() ||
    generateTaskDescription(t.title, status, category);
  const dayIso = t.completed_at
    ? localDateKey(new Date(t.completed_at))
    : t.start_at
      ? localDateKey(new Date(t.start_at))
      : null;
  const dayLabel = dayIso ? dayIso.slice(5).replace("-", "/") : "待排期";
  const progressLabel =
    status === "done" ? "已完成" : status === "in_progress" ? "进行中" : "未开始";

  const statusBadge = {
    done: "bg-emerald-50 text-emerald-600",
    in_progress: "bg-sky-50 text-sky-600",
    todo: "bg-rose-50 text-rose-600",
  }[status];
  const statusDot = {
    done: "bg-emerald-500",
    in_progress: "bg-sky-500",
    todo: "bg-rose-400",
  }[status];

  return (
    <main className="flex flex-1 flex-col p-4 md:p-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/开拓隆海logo.png"
            alt="开拓隆海"
            className="h-8 w-auto shrink-0"
          />
          <Link
            href="/app/reports"
            className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--brand-ink)]"
          >
            ← 返回报告中心
          </Link>
        </div>

        <section className="mt-3 rounded-xl border border-[var(--border-muted)] bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 text-lg font-semibold text-[var(--brand-ink)]">
              {t.title}
            </h1>
            <span
              className={[
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                statusBadge,
              ].join(" ")}
            >
              <span className={`h-2 w-2 rounded-full ${statusDot}`} />
              {REPORT_STATUS_LABEL[status]}
            </span>
          </div>

          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-start gap-3">
              <dt className="w-16 shrink-0 text-xs text-[var(--text-muted)]">
                时间
              </dt>
              <dd className="min-w-0 text-[var(--brand-ink)]">
                {dayLabel}
              </dd>
            </div>
            <div className="flex items-start gap-3">
              <dt className="w-16 shrink-0 text-xs text-[var(--text-muted)]">
                完成进展
              </dt>
              <dd className="text-[var(--brand-ink)]">{progressLabel}</dd>
            </div>
            <div className="flex items-start gap-3">
              <dt className="w-16 shrink-0 text-xs text-[var(--text-muted)]">
                遇到的问题
              </dt>
              <dd className="text-[var(--brand-ink)]">暂无</dd>
            </div>
            <div className="flex items-start gap-3">
              <dt className="w-16 shrink-0 text-xs text-[var(--text-muted)]">
                描述
              </dt>
              <dd className="min-w-0 whitespace-pre-wrap text-[var(--brand-ink)]">
                {description}
              </dd>
            </div>
            <div className="flex items-start gap-3">
              <dt className="w-16 shrink-0 text-xs text-[var(--text-muted)]">
                日期
              </dt>
              <dd className="text-[var(--brand-ink)]">{dayLabel}</dd>
            </div>
            <div className="flex items-start gap-3">
              <dt className="w-16 shrink-0 text-xs text-[var(--text-muted)]">
                分类
              </dt>
              <dd className="text-[var(--brand-ink)]">
                {categoryLabel(category)}
              </dd>
            </div>
            <div className="flex items-start gap-3">
              <dt className="w-16 shrink-0 text-xs text-[var(--text-muted)]">
                部门
              </dt>
              <dd className="text-[var(--brand-ink)]">{t.department || "通用"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}

/** 任务不存在或无权查看时的友好提示页（替代裸 404） */
function TaskMissing() {
  return (
    <main className="flex flex-1 flex-col p-4 md:p-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/开拓隆海logo.png"
            alt="开拓隆海"
            className="h-8 w-auto shrink-0"
          />
          <Link
            href="/app/reports"
            className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--brand-ink)]"
          >
            ← 返回报告中心
          </Link>
        </div>
        <section className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-[var(--border-muted)] bg-white px-6 py-14 text-center shadow-sm">
          <p className="text-sm font-semibold text-[var(--brand-ink)]">
            任务不存在或无权查看
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            该任务可能已被删除，或不属于你所在的空间（普通成员只能查看指派给自己的任务）。
          </p>
          <Link
            href="/app/reports"
            className="mt-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            返回报告中心
          </Link>
        </section>
      </div>
    </main>
  );
}

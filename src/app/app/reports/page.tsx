import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAppAuth, getMySpaceNav, visibleSpaceNav } from "@/lib/app-data";
import { TODO_SELECT, type TodoRow } from "@/lib/todos";
import {
  buildReportData,
  parseReportInput,
  parseReportSpaceIds,
  parseReportType,
  resolveReportRange,
  stripReportData,
} from "@/lib/reports";
import { ReportWorkspace } from "./report-workspace";

type SearchParams = Promise<{
  type?: string;
  date?: string;
  spaces?: string;
}>;

const ACTIVE_TODO_LIMIT = 2000;
const DONE_TODO_LIMIT = 1000;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const { supabase, user } = await getAppAuth();

  if (!user) {
    redirect("/login");
  }

  const { spaces: allSpaces } = await getMySpaceNav();
  const spaces = visibleSpaceNav(allSpaces);
  const type = parseReportType(sp.type);
  const input = parseReportInput(type, sp.date);
  const range = resolveReportRange(type, input || sp.date);
  const selectedSpaceIds = parseReportSpaceIds(sp.spaces, spaces);
  const selectedSpaces = spaces.filter((s) =>
    selectedSpaceIds.includes(s.id),
  );
  const canAssignBySpace = Object.fromEntries(
    spaces.map((s) => [s.id, s.role === "owner" || s.role === "admin"]),
  );

  const emptyTodos = { data: [] as never[], error: null };
  const spaceIds =
    selectedSpaces.length > 0
      ? selectedSpaces.map((s) => s.id)
      : spaces.map((s) => s.id);

  // 所选空间全部任务：进行中/未开始（含未排期）+ 已完成（按完成时间倒序）
  const [activeRes, doneRes] =
    spaceIds.length > 0
      ? await Promise.all([
          supabase
            .from("todos")
            .select(TODO_SELECT)
            .in("space_id", spaceIds)
            .neq("status", "done")
            .order("created_at", { ascending: false })
            .limit(ACTIVE_TODO_LIMIT),
          supabase
            .from("todos")
            .select(TODO_SELECT)
            .in("space_id", spaceIds)
            .eq("status", "done")
            .order("completed_at", { ascending: false })
            .limit(DONE_TODO_LIMIT),
        ])
      : [emptyTodos, emptyTodos];

  const fetchError = activeRes.error ?? doneRes.error;
  const rawTodos = [
    ...((activeRes.data ?? []) as unknown as TodoRow[]),
    ...((doneRes.data ?? []) as unknown as TodoRow[]),
  ];
  const taskLimitReached =
    (activeRes.data?.length ?? 0) >= ACTIVE_TODO_LIMIT ||
    (doneRes.data?.length ?? 0) >= DONE_TODO_LIMIT;

  const data = buildReportData({
    type,
    range,
    selectedSpaces,
    todos: rawTodos,
    canAssignBySpace,
    userId: user.id,
  });

  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={null}>
        <ReportWorkspace
          spaces={spaces}
          type={type}
          input={data.input}
          selectedSpaceIds={selectedSpaceIds}
          viewData={stripReportData(data)}
          fetchError={fetchError?.message ?? null}
          taskLimitReached={taskLimitReached}
        />
      </Suspense>
    </main>
  );
}

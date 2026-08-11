/** 侧栏占位：壳子先出，空间列表流式补上 */
export function SidebarSkeleton() {
  return (
    <>
      <aside className="hidden w-[min(17rem,30vw)] shrink-0 flex-col border-r border-[var(--border-muted)] bg-[var(--surface-muted)]/80 md:flex">
        <div className="flex items-center gap-2 border-b border-[var(--border-muted)] px-3 py-3">
          <div className="h-9 w-9 animate-pulse rounded-full bg-zinc-200" />
          <div className="h-4 flex-1 animate-pulse rounded bg-zinc-200" />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="h-8 animate-pulse rounded-lg bg-zinc-200/80" />
          <div className="mt-2 h-3 w-20 animate-pulse rounded bg-zinc-200/70" />
          <div className="h-9 animate-pulse rounded-lg bg-zinc-200/60" />
          <div className="h-9 animate-pulse rounded-lg bg-zinc-200/60" />
          <div className="h-9 animate-pulse rounded-lg bg-zinc-200/60" />
        </div>
      </aside>
      <div className="fixed inset-x-0 top-0 z-40 h-12 border-b border-[var(--border-muted)] bg-white/95 md:hidden">
        <div className="flex h-full items-center gap-2 px-3">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-zinc-200" />
          <div className="h-4 flex-1 animate-pulse rounded bg-zinc-200" />
        </div>
      </div>
    </>
  );
}

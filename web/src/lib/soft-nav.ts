/**
 * 侧栏软导航：用 App Router 客户端跳转，复用 /app layout，避免整页重载。
 * 在挂载时 prefetch 常用路由与空间日历数据以加快首次点击。
 */
import {
  prefetchSpaceCalendarTodos,
  prefetchSpaceMembers,
} from "@/lib/space-data-cache";

const PREFETCH_HREFS = [
  "/app?view=calendar&range=week",
  "/app/notifications",
  "/app/profile",
] as const;

export function prefetchAppRoutes(
  prefetch: (href: string) => void,
  spaceIds: string[] = [],
) {
  for (const href of PREFETCH_HREFS) {
    try {
      prefetch(href);
    } catch {
      // ignore
    }
  }
  // 预取全部空间页 RSC；数据预取限前若干个，避免侧栏一挂载打爆请求
  const DATA_PREFETCH_LIMIT = 8;
  spaceIds.forEach((id, i) => {
    try {
      prefetch(`/app/spaces/${id}`);
    } catch {
      // ignore
    }
    if (i < DATA_PREFETCH_LIMIT) {
      prefetchSpaceCalendarTodos(id);
      prefetchSpaceMembers(id);
    }
  });
}

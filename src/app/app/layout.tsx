import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAppAuth } from "@/lib/app-data";
import { AppSidebarSlot } from "./app-sidebar-slot";
import { DeferredNotificationToast } from "./deferred-notification-toast";
import { SidebarSkeleton } from "./sidebar-skeleton";
import { UiPrefsProvider } from "./ui-prefs-provider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user } = await getAppAuth();

  if (!user) {
    redirect("/login");
  }

  // 只等轻量 profile，侧栏空间列表与主内容并行流式
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, timezone, ui_prefs")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <UiPrefsProvider
      globalPrefsRaw={profile?.ui_prefs}
      spacePrefsByIdRaw={{}}
    >
      <Suspense fallback={<SidebarSkeleton />}>
        <AppSidebarSlot profile={profile} />
      </Suspense>
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col bg-white/70 backdrop-blur-[2px] pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[calc(3rem+env(safe-area-inset-top))] md:pb-0 md:pt-0">
        <DeferredNotificationToast />
        {children}
      </div>
    </UiPrefsProvider>
  );
}

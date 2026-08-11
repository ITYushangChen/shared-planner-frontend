import { getAppAuth, getMySpaceNav, visibleSpaceNav } from "@/lib/app-data";
import { AppearanceSettingsModal } from "../appearance-settings-modal";
import { SignOutButton } from "../sign-out-button";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const { supabase, user } = await getAppAuth();
  const { spaces: allSpaces, spacePrefsById } = await getMySpaceNav();
  const spaces = visibleSpaceNav(allSpaces);

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, timezone, email, avatar_url, ui_prefs")
    .eq("id", user!.id)
    .maybeSingle();

  const email = user?.email ?? profile?.email ?? "";

  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900">个人资料</h1>
        <p className="mt-1 hidden text-sm text-zinc-500 md:block">
          昵称与登录邮箱绑定展示，可修改昵称与时区
        </p>
      </header>

      <section className="mt-8 rounded-xl border border-zinc-200 p-5">
        <ProfileForm
          email={email}
          initialDisplayName={profile?.display_name ?? ""}
          initialTimezone={profile?.timezone ?? "Asia/Shanghai"}
          initialAvatarUrl={profile?.avatar_url ?? ""}
        />

        {/* 手机：外观设置放在「我的」；桌面仍可用侧栏入口 */}
        <div className="mt-6 border-t border-zinc-100 pt-4 md:hidden">
          <p className="mb-2 text-sm font-medium text-zinc-800">外观</p>
          <AppearanceSettingsModal
            spaces={spaces}
            initialGlobalPrefs={profile?.ui_prefs}
            initialSpacePrefsById={spacePrefsById}
          />
        </div>

        <div className="mt-6 border-t border-zinc-100 pt-4">
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}

import {
  getAppAuth,
  getMySpaceNav,
  mapMembershipRows,
  visibleSpaceNav,
} from "@/lib/app-data";
import { DeferredAppSidebar } from "./deferred-app-sidebar";
import { HydrateSpacePrefs } from "./hydrate-space-prefs";

const SPACE_SELECT =
  "role, ui_prefs, spaces(id, name, kind, visibility, avatar_url, description)";

type ProfileLite = {
  display_name?: string | null;
  avatar_url?: string | null;
  timezone?: string | null;
  ui_prefs?: unknown;
} | null;

/** 流式侧栏：不阻塞主内容 RSC */
export async function AppSidebarSlot({
  profile: profileProp,
}: {
  profile: ProfileLite;
}) {
  const { supabase, user } = await getAppAuth();
  if (!user) return null;

  let spaceNav = await getMySpaceNav();
  let spaces = spaceNav.spaces;
  let spacePrefsById = spaceNav.spacePrefsById;
  let profileData = profileProp;

  if (!profileData || spaces.length === 0) {
    await supabase.rpc("ensure_my_bootstrap");
    const [{ data: profile2 }, { data: memberships }] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, avatar_url, timezone, ui_prefs")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("space_members")
        .select(SPACE_SELECT)
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true }),
    ]);
    profileData = profile2;
    const mapped = mapMembershipRows(memberships ?? []);
    spaces = mapped.spaces;
    spacePrefsById = mapped.spacePrefsById;
  }

  const navSpaces = visibleSpaceNav(spaces);

  return (
    <>
      <HydrateSpacePrefs spacePrefsByIdRaw={spacePrefsById} />
      <DeferredAppSidebar
        spaces={navSpaces}
        displayName={profileData?.display_name}
        avatarUrl={profileData?.avatar_url}
        globalUiPrefs={profileData?.ui_prefs}
        spacePrefsById={spacePrefsById}
        timezone={profileData?.timezone ?? undefined}
      />
    </>
  );
}

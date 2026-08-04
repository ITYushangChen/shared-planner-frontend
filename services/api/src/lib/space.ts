import type { SupabaseClient, User } from "@supabase/supabase-js";

export type SpaceMember = {
  user_id: string;
  role: string;
  display_name: string;
  email: string | null;
};

export async function assertSpaceMember(
  admin: SupabaseClient,
  spaceId: string,
  userId: string,
): Promise<SpaceMember> {
  const { data, error } = await admin
    .from("space_members")
    .select("user_id, role, profiles(display_name, email)")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not a member of this space");

  const profile = data.profiles as unknown as {
    display_name: string;
    email: string | null;
  } | null;

  return {
    user_id: data.user_id,
    role: data.role,
    display_name: profile?.display_name || "User",
    email: profile?.email ?? null,
  };
}

export async function listSpaceMembers(
  admin: SupabaseClient,
  spaceId: string,
): Promise<SpaceMember[]> {
  const { data, error } = await admin
    .from("space_members")
    .select("user_id, role, profiles(display_name, email)")
    .eq("space_id", spaceId);

  if (error) throw new Error(error.message);

  return (data || []).map((row) => {
    const profile = row.profiles as unknown as {
      display_name: string;
      email: string | null;
    } | null;
    return {
      user_id: row.user_id,
      role: row.role,
      display_name: profile?.display_name || "User",
      email: profile?.email ?? null,
    };
  });
}

/** Resolve assignee nicknames (or "全员") to user ids in this space. */
export function resolveAssignees(
  names: string[] | undefined,
  members: SpaceMember[],
  fallbackUserId: string,
): string[] {
  if (!names || names.length === 0) return [fallbackUserId];

  const normalized = names.map((n) => n.trim()).filter(Boolean);
  if (normalized.some((n) => /全员|所有人|everyone/i.test(n))) {
    return members.map((m) => m.user_id);
  }

  const ids = new Set<string>();
  for (const name of normalized) {
    const lower = name.toLowerCase();
    const hit = members.find(
      (m) =>
        m.display_name === name ||
        m.display_name.toLowerCase() === lower ||
        (m.email && m.email.toLowerCase().startsWith(lower)),
    );
    if (hit) ids.add(hit.user_id);
  }

  return ids.size > 0 ? [...ids] : [fallbackUserId];
}

export function memberDirectoryPrompt(members: SpaceMember[]): string {
  return members
    .map((m) => `- ${m.display_name}${m.email ? ` <${m.email}>` : ""} (id=${m.user_id})`)
    .join("\n");
}

export type AuthContext = {
  user: User;
  accessToken: string;
};

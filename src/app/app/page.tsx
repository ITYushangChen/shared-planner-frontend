import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

type MembershipRow = {
  role: string;
  spaces: {
    id: string;
    name: string;
    description: string | null;
  } | null;
};

export default async function AppHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, display_name, timezone")
    .eq("id", user.id)
    .maybeSingle();

  const { data: memberships, error: membershipError } = await supabase
    .from("space_members")
    .select("role, spaces(id, name, description)")
    .eq("user_id", user.id);

  const rows = (memberships ?? []) as unknown as MembershipRow[];

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">已登录</h1>
          <p className="mt-1 text-sm text-zinc-500">
            用于验收：Auth → profiles → 个人空间自动建档
          </p>
        </div>
        <SignOutButton />
      </div>

      <section className="mt-8 rounded-xl border border-zinc-200 p-5">
        <h2 className="text-sm font-medium text-zinc-500">Auth</h2>
        <p className="mt-2 text-zinc-900">邮箱：{user.email}</p>
        <p className="text-sm text-zinc-500">UID：{user.id}</p>
      </section>

      <section className="mt-4 rounded-xl border border-zinc-200 p-5">
        <h2 className="text-sm font-medium text-zinc-500">Profile</h2>
        {profileError ? (
          <p className="mt-2 text-sm text-red-600">{profileError.message}</p>
        ) : profile ? (
          <ul className="mt-2 space-y-1 text-zinc-900">
            <li>昵称：{profile.display_name}</li>
            <li>时区：{profile.timezone}</li>
          </ul>
        ) : (
          <p className="mt-2 text-sm text-amber-700">
            没有 profiles 行 — Trigger 可能未生效，请检查 migration。
          </p>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-zinc-200 p-5">
        <h2 className="text-sm font-medium text-zinc-500">我的空间</h2>
        {membershipError ? (
          <p className="mt-2 text-sm text-red-600">{membershipError.message}</p>
        ) : rows.length === 0 ? (
          <p className="mt-2 text-sm text-amber-700">
            暂无空间 — 检查 space_members / handle_new_user Trigger。
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {rows.map((m) => (
              <li
                key={m.spaces?.id ?? m.role}
                className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-800"
              >
                <span className="font-medium">{m.spaces?.name ?? "（未知空间）"}</span>
                <span className="text-zinc-500"> — 角色：{m.role}</span>
                {m.spaces?.description ? (
                  <p className="text-zinc-500">{m.spaces.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-sm text-zinc-500">
        <Link href="/login" className="underline">
          回登录页
        </Link>
      </p>
    </main>
  );
}

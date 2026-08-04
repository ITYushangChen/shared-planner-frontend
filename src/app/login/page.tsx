"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setMsg("登录中…");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setMsg("登录成功");
    router.push("/app");
    router.refresh();
  }

  async function signUp() {
    setLoading(true);
    setMsg("注册中…");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName || email.split("@")[0] || "User",
        },
      },
    });
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    if (!data.session) {
      setMsg("注册成功。若开启了邮箱确认，请先到邮箱点确认后再登录。");
      return;
    }
    setMsg(`注册成功：${data.user?.email}`);
    router.push("/app");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        ShareTodo AI
      </h1>
      <p className="mt-2 text-sm text-zinc-500">邮箱登录 / 注册（Supabase Auth）</p>

      <form onSubmit={signIn} className="mt-8 flex flex-col gap-3">
        <label className="text-sm text-zinc-700">
          昵称（仅注册时用）
          <input
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-400"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="小张"
            autoComplete="nickname"
          />
        </label>
        <label className="text-sm text-zinc-700">
          邮箱
          <input
            type="email"
            required
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label className="text-sm text-zinc-700">
          密码
          <input
            type="password"
            required
            minLength={6}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
            autoComplete="current-password"
          />
        </label>

        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            登录
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={signUp}
            className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 disabled:opacity-50"
          >
            注册
          </button>
        </div>
      </form>

      {msg ? <p className="mt-4 text-sm text-zinc-600">{msg}</p> : null}
    </main>
  );
}

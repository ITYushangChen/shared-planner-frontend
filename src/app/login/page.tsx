"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "邮箱或密码错误";
  }
  if (m.includes("email not confirmed")) {
    return "邮箱尚未确认。请到 Supabase → Authentication → Providers → Email，关闭 Confirm email 后再试；或去邮箱点确认链接。";
  }
  if (m.includes("user already registered")) {
    return "该邮箱已注册，请直接登录";
  }
  if (m.includes("password should be at least")) {
    return "密码至少 6 位";
  }
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "无法连接服务器，请检查网络/隧道后重试";
  }
  return message;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/app?view=calendar&range=week";
  const callbackError = searchParams.get("error");

  const envOk = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    [],
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState(
    callbackError ? "登录回调失败，请重新登录" : "",
  );
  const [loading, setLoading] = useState(false);

  async function authPassword(mode: "signin" | "signup") {
    if (!envOk) {
      setMsg("缺少 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY，请检查 .env.local");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setMsg("密码至少 6 位");
      return;
    }

    setLoading(true);
    setMsg(mode === "signup" ? "注册中…" : "登录中…");

    try {
      const res = await fetch("/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          mode,
          email: email.trim(),
          password,
        }),
      });

      let data: { error?: string; ok?: boolean } = {};
      try {
        data = (await res.json()) as { error?: string; ok?: boolean };
      } catch {
        data = {};
      }

      if (!res.ok) {
        setLoading(false);
        setMsg(translateAuthError(data.error || `请求失败（${res.status}）`));
        return;
      }

      setMsg("登录成功，正在进入…");
      const dest = next.startsWith("/")
        ? next
        : "/app?view=calendar&range=week";
      // 整页跳转，带上服务端刚写入的 Set-Cookie
      window.location.assign(dest);
    } catch (err) {
      setLoading(false);
      setMsg(
        translateAuthError(
          err instanceof Error ? err.message : "网络错误，请重试",
        ),
      );
    }
  }

  async function signIn(e?: FormEvent) {
    e?.preventDefault();
    await authPassword("signin");
  }

  async function signUp() {
    await authPassword("signup");
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        ShareTodo AI
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        邮箱注册 / 登录（本地联调 Supabase Auth）
      </p>

      {!envOk ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          未检测到 Supabase 环境变量，请配置 web/.env.local 后重启 npm run
          dev。
        </p>
      ) : null}

      <form onSubmit={signIn} className="mt-8 flex flex-col gap-3">
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
            disabled={loading || !envOk}
            className="flex-1 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            登录
          </button>
          <button
            type="button"
            disabled={loading || !envOk}
            onClick={signUp}
            className="flex-1 rounded-xl border border-[#2f5f8f]/55 px-4 py-2 text-sm font-medium text-[#2f5f8f] transition-colors duration-200 hover:bg-[#e8f0f7] disabled:opacity-50"
          >
            注册
          </button>
        </div>
      </form>

      {msg ? (
        <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-700">{msg}</p>
      ) : null}

      <p className="mt-8 text-xs leading-relaxed text-zinc-400">
        开发提示：Supabase → Authentication → Providers → Email，建议关闭
        Confirm email；隧道调试时 Redirect 需包含当前
        https://….trycloudflare.com/**
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md px-6 py-16 text-sm text-zinc-500">
          加载登录页…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type Body = {
  email?: string;
  password?: string;
  displayName?: string;
  mode?: "signin" | "signup";
};

/**
 * 服务端邮箱登录/注册，把 session 写到响应 Set-Cookie。
 * 经 Cloudflare 隧道时比纯浏览器端 signIn 更稳（避免进 /app 被中间件踢回登录）。
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json(
      { error: "缺少 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY" },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";
  const mode = body.mode === "signup" ? "signup" : "signin";
  const displayName =
    body.displayName?.trim() || email.split("@")[0] || "User";

  if (!email || !password) {
    return NextResponse.json({ error: "请填写邮箱和密码" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }

  let response = NextResponse.json({ ok: true });

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.json({ ok: true });
        const isHttps = request.nextUrl.protocol === "https:";
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, {
            ...options,
            path: options?.path ?? "/",
            sameSite: options?.sameSite ?? "lax",
            // localhost(http) 不能 Secure；隧道 https 必须 Secure
            secure: isHttps ? true : Boolean(options?.secure),
          });
        });
      },
    },
  });

  if (mode === "signup") {
    const origin = request.nextUrl.origin;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/app?view=calendar&range=week")}`,
      },
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data.session) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        return NextResponse.json(
          {
            error:
              "注册成功，但尚未建立登录会话。请到 Supabase 关闭 Confirm email 后点登录。",
          },
          { status: 400 },
        );
      }
    }
  } else {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
  }

  try {
    await supabase.rpc("ensure_my_bootstrap");
  } catch {
    // 建档失败不阻断登录
  }

  return response;
}

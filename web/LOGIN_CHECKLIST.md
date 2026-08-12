# 登录打通清单

## 1. Supabase（必做）

### A. 关闭邮箱确认（本地开发）

Authentication → Providers → Email → **Confirm email = OFF** → Save

### B. 本地回调地址

Authentication → URL Configuration：

- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/**`

### C. 执行 SQL（按顺序）

1. `supabase/migrations/20260804000000_init_sharetodo.sql`（若尚未建表）
2. `supabase/migrations/20260804100000_ensure_bootstrap.sql`
3. `supabase/migrations/20260804120000_spaces_kind.sql`（空间 kind：工作区/生活区/家庭区）

## 2. 本地前端

```powershell
cd web
npm run dev
```

打开 http://localhost:3000/login

1. 用新邮箱注册（密码 ≥ 6 位）
2. 应自动进入 `/app`
3. 看到绿色「登录打通验收通过」+ 个人空间

## 3. 常见错误

| 提示 | 处理 |
|------|------|
| Email not confirmed | 关闭 Confirm email |
| Failed to fetch | 开代理访问 `*.supabase.co` |
| 没有 profiles / 空间 | 执行 ensure_bootstrap.sql |
| Invalid login credentials | 邮箱密码错误或用户不存在 |

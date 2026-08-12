# 连接 Vercel（前端）

仓库：https://github.com/ITYushangChen/shared-planner-frontend

## 方式 A：网页导入（推荐）

1. 打开 https://vercel.com → **Add New… → Project**
2. Import `ITYushangChen/shared-planner-frontend`
3. **Root Directory** 留空（仓库根就是 Next 应用）
4. Environment Variables 添加：

```env
NEXT_PUBLIC_SUPABASE_URL=（同本地 .env.local）
NEXT_PUBLIC_SUPABASE_ANON_KEY=（同本地 .env.local）
NEXT_PUBLIC_API_URL=https://你的Railway域名.up.railway.app
```

5. Deploy
6. 部署成功后，到 Supabase → Authentication → URL Configuration：
   - Site URL = `https://你的项目.vercel.app`
   - Redirect URLs 增加 `https://你的项目.vercel.app/**`

## 方式 B：CLI

```powershell
cd web
npx vercel login
npx vercel link
npx vercel env pull   # 可选
npx vercel --prod     # 部署生产
```

## 本地开发

```powershell
npm run dev
```

打开 http://localhost:3000  
本地 API：`NEXT_PUBLIC_API_URL=http://localhost:8080`

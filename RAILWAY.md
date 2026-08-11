# 连接 Railway（Dashboard 操作清单）

本机若无法安装 Railway CLI（访问 GitHub releases 超时），请用网页完成连接。

仓库：https://github.com/ITYushangChen/shared-planner-backend  
根目录已有 `Dockerfile` + `railway.toml`（builder = DOCKERFILE）。

## 1. 关联 GitHub 仓库

1. 打开 https://railway.app → 进入你的项目  
2. 若还没有服务： **New → GitHub Repo** → 选 `shared-planner-backend`  
3. 若已有服务： **Settings → Source** 确认 Repo 为 `ITYushangChen/shared-planner-backend`，Branch = `main`

## 2. 构建设置（重要）

**Settings**：

| 项 | 值 |
|----|-----|
| Root Directory | **留空**（用仓库根 Dockerfile） |
| Builder | Dockerfile（或由 `railway.toml` 指定） |
| 自定义 Build Command | **清空**（不要写 `cd services/api && npm …`） |
| 自定义 Start Command | **清空**（Dockerfile 已有 `CMD`） |

## 3. 环境变量 Variables

必填：

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEEPSEEK_API_KEY=
```

建议：

```text
CORS_ORIGIN=https://你的前端.vercel.app
CRON_SECRET=一串随机字符
```

`PORT` 一般不用填（Railway 自动注入）。

保存后 **Redeploy**。

## 4. 公网域名

**Settings → Networking → Generate Domain**

记下：`https://xxxx.up.railway.app`

浏览器打开：`https://xxxx.up.railway.app/health`  
应返回：`{"ok":true,"service":"shared-planner-api",...}`

## 5. 前端对接

在 Vercel / 本地 `web/.env.local` 增加：

```env
NEXT_PUBLIC_API_URL=https://xxxx.up.railway.app
```

然后 Redeploy 前端。

## 6. Healthcheck 失败时

Deploy Logs 若出现 `Missing required env`：补全第 3 步变量再部署。  
`railway.toml` 中 `healthcheckPath = /health`，勿改成其它路径。

## CLI（可选，网络可用时）

```powershell
npm install -g @railway/cli
railway login
cd supabase
railway link
railway up
```

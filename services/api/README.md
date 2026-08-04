# ShareTodo API（DeepSeek + Supabase）

部署到 **Railway** 的 AI / 定时任务后端。常规 CRUD 仍由前端直连 Supabase。

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/health` | 无 | 健康检查 |
| POST | `/ai/create-todos` | Bearer JWT | 自然语言建待办（`confirm:false` 预览） |
| POST | `/ai/schedule` | Bearer JWT | 智能排期 |
| POST | `/ai/reorder` | Bearer JWT | 按紧急度排序并写 `sort_score` |
| POST | `/ai/conflict-suggest` | Bearer JWT | 冲突解决建议 |
| POST | `/ai/daily-summary` | Bearer JWT | 手动生成今日摘要 → `notifications` |
| POST | `/jobs/daily-summary` | `x-cron-secret` | Cron 批量为用户生成摘要 |

### 创建待办示例

```bash
curl -X POST "$API_URL/ai/create-todos" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "space_id": "uuid",
    "text": "周五下班前要上线 V2.3，周三下午评审、周四全天开发联调",
    "confirm": false,
    "timezone": "Asia/Shanghai"
  }'
```

确认写入时把 `confirm` 改为 `true`。

## 本地运行

```bash
cd services/api
cp .env.example .env
# 填写 SUPABASE_* 与 DEEPSEEK_API_KEY
npm install
npm run dev
```

## Railway 部署

1. New Project → Deploy from GitHub（backend 仓）
2. **Root Directory** = `services/api`
3. Build：`npm install && npm run build`
4. Start：`npm start`
5. 配置 Variables（见 `.env.example`）
6. `CORS_ORIGIN` 填 Vercel 前端域名
7. Cron Job（可选）：每天请求  
   `POST /jobs/daily-summary`，Header：`x-cron-secret: $CRON_SECRET`

## 前端对接

```env
NEXT_PUBLIC_API_URL=https://你的服务.up.railway.app
```

```ts
const { data: { session } } = await supabase.auth.getSession()
await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai/create-todos`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ space_id, text, confirm: false }),
})
```

## DeepSeek

使用官方 OpenAI 兼容接口：

- Base：`https://api.deepseek.com`
- Model 默认：`deepseek-chat`
- 需开通并填写 `DEEPSEEK_API_KEY`

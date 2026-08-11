FROM node:20-alpine AS deps
WORKDIR /app
COPY services/api/package.json services/api/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY services/api/package.json services/api/package-lock.json ./
COPY services/api/tsconfig.json ./
COPY services/api/src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# AI 任务名称改写规则（运行时读取 renwumingcheng）
COPY services/api/renwumingcheng ./renwumingcheng

EXPOSE 8080
CMD ["npm", "start"]

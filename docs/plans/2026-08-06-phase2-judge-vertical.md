# Phase 2：判题竖线

## 出口标准

一名学生可以在 OJ2 前端登录、读取公开题、提交代码，并通过 WebSocket 看到真实 JudgeServer 返回的判题结果。

## 已实现链路

```text
Vue → Hono → PostgreSQL submission → BullMQ/Redis → worker
    → QDU JudgeServer → PostgreSQL 事务写回 → Redis pub/sub
    → Bun WebSocket → Vue SubmissionMonitor
```

- 认证使用 Redis 中的 32 字节随机会话令牌和 `HttpOnly`、`SameSite=Lax` Cookie。
- 每个受保护请求都重新读取用户表；账号禁用会立即让 HTTP/WS 鉴权失效。
- 兼容 Django `pbkdf2_sha256`，验证走异步 `node:crypto.pbkdf2`；成功登录后透明改存 Bun `argon2id`。
- 公开题详情隐藏测试点、答案、AST 规则，只返回模板中的学生可编辑区。
- BullMQ worker 负责模板拼接、JudgeServer HTTP 调用、C/Python AST 检查、结果聚合和统计事务。
- WebSocket 在订阅时重放数据库现状，覆盖“判题先完成、浏览器后连上”的竞态；轮询仍作为前端保底。
- JudgeServer 心跳保留镜像要求的旧 `{ error, data }` 信封，其余新接口使用 `{ data }` / `{ error: { code, message } }`。

## 本地启动

```bash
docker compose -f docker/compose.dev.yml up -d
bun run seed:dev
bun run dev
```

默认开发账号是 `student / student123`，可用 `OJ2_DEV_USERNAME` 和 `OJ2_DEV_PASSWORD` 覆盖。真实测试点放在 `data/test_case/`，该目录只读挂载给 JudgeServer 且不进入 Git。

## 验收记录

- API 与共享契约 TypeScript 静态检查通过。
- Vue 生产构建通过，保留 Chrome 90 兼容构建。
- Django PBKDF2 正确/错误密码兼容检查通过，AST C/Python WASM 加载与规则判定通过。
- 使用生产样本题 `1004` 的真实测试点完成 AC 和 WA；题目计数、用户提交数和首次 AC 状态在同一事务中更新。
- WebSocket 实测收到 `pending → judging → finished`，并验证完成后再订阅仍会重放最终结果。
- 真实浏览器完成登录、读题、编辑、提交并显示“答案正确”。
- Compose 配置有效，PostgreSQL、Redis 和 JudgeServer 健康检查均通过。

## Phase 3 边界

本阶段仅切换登录、本人资料、非比赛公开题详情、普通提交与本人提交详情。比赛、题目统计/点评、登录速报、成就、代码格式化等端点继续留给 Phase 3；前端对应实时配置连接暂不启动。

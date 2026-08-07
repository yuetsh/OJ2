# 阶段 0 / 1 / 2 出口标准核验

日期：2026-08-07
方法：**逐条实跑，不采信文档声称**。阶段 1 后半段至阶段 3 的实现由外部 agent（Codex）完成，
本次核验按外部代码对待，独立验证。

## 结论

| 阶段 | 出口标准条数 | 通过 | 结果 |
|---|---|---|---|
| 0 存量盘点 | 4 | 4 | ✅ |
| 1 骨架 | 5 | 5 | ✅ |
| 2 判题竖线 | 1（端到端） | 1 | ✅ |

## 阶段 0

| 标准 | 实测 |
|---|---|
| `endpoint-inventory.md` 的 REVIEW 计数为 0 | `grep -c '^| REVIEW |'` → **0** |
| 清单顶部记录最终数字 | 「合计 127 —— KEEP 110、CUT 17、REVIEW 0；新后端需实现 110 个」 |
| jieba 结论写回设计文档 7.3 | `@node-rs/jieba` 在文档中出现 6 处，7.3 节为实测结论 |
| `schema.sql` 入库 | `git ls-files` 命中 |

## 阶段 1

| 标准 | 实测 |
|---|---|
| `@oj2/contract` 为符号链接 | `contract -> ../../packages/contract`（另有 api、web 两个 workspace 链接） |
| `schema.ts` 27 张表且无框架表 | `grep -c 'pgTable('` → **27**；`django_*` / `auth_*` 匹配为空 |
| `/api/problems` 返回真实数据 | HTTP 200，返回中文标题含 emoji（如「🎮好耶！是大冒险！」），字段完整 |
| `apps/web` 构建成功 | `bun run build` 退出码 **0** |
| `/dev-problems` 显示 20 道题 | `GET /api/dev/problems` → 200，题目数 **20** |

### 旧 Chrome 兼容约束（硬约束）专项核验

学校机房浏览器版本低，`mermaid-legacy` 等 fallback 依赖与 `legacy()` 插件不可动。实测：

- `apps/web/vite.config.ts` 与 `ojnext/vite.config.ts` 差异 **17 行，全部是新增代理**
  （`/api2`、`/ws2`、`/public/avatar`），未触碰 `legacy()` 插件与 Chrome 90 兼容配置
- 依赖 38 → 39，**新增仅 `@oj2/contract`，删除 0 个**，`mermaid-legacy` 仍在

约束守住。

## 阶段 2

出口标准：一名学生能登录、读公开题、提交代码，并通过 WebSocket 看到真实 JudgeServer 的判题结果。

实测流程（全部真实执行，非模拟）：

1. **注册** `POST /api/users` → 201
2. **登录** `POST /api/auth/login` → 200，`Set-Cookie: oj2_session=<32 字节随机令牌>`
3. **会话** `GET /api/me` → 200，返回用户身份
4. **读公开题** `GET /api/problems/1004` → 200
5. **提交** `POST /api/submissions` → 201，返回 `submissionId`
6. **判题** 真实 JudgeServer 执行，返回 `result: 0`（ACCEPTED），两个测试点均带
   `memory` / `cpu_time` / `output_md5`
7. **WebSocket 推送** `ws://localhost:3000/ws/submissions`，订阅后收到三条：

```
{"type":"submission_update","result":6,"status":"pending"}
{"type":"submission_update","result":7,"status":"judging"}
{"type":"submission_update","result":0,"status":"finished","time_cost":0,"memory_cost":1470464,"score":0}
```

8. **统计回写** 题目 `myStatus` 变为 0（已通过）

### 附带核验：公开题详情无泄露

`GET /api/problems/1004` 的响应字段中**不含** `testCaseId`、`testCaseScore`、`answers`、
`astRules` —— 学生侧看不到测试点与答案。

## 遗留待处理项（不影响上述判定）

1. **`GET /api/dev/problems` 与 `apps/web/src/oj/dev-problems.vue` 仍在。** 二者是阶段 1 的
   临时链路验证物，阶段 1 计划正文写明「阶段 3 会删」。`apps/web/src/routes.ts` 里的
   `dev-problems` 路由同样待删。
2. **占位用户 `devadmin` 无法登录。** 其 `password` 列是字面量 `'unusable'`（非有效哈希），
   `raw_password` 为 `'devonly'`。这是阶段 1 为满足 `problem.created_by_id` 外键而造的占位记录，
   设计如此，不是缺陷。需要管理员账号做本地验证时得另建。
3. **判题容器健康状态依赖后端。** `oj2-judge` 的 healthcheck 需要能连上后端心跳端点；
   API 未启动时 `docker compose ps` 会显示 unhealthy，属预期行为，非故障。

## 未覆盖

本次只核验出口标准，**未做代码质量与安全审查**。阶段 2、3 的实现均未经过任务级评审
（阶段 0、1 的评审曾逮到 `_id`/`id` 静默碰撞、端点漏抓 5 个、`key()` 误剥前缀等缺陷），
相关审查另行进行，见 `phase3-review-authz.md` 与 `phase3-review-leakage.md`。

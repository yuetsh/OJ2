# 阶段 1：monorepo 骨架 —— 实施计划

> **给执行者：** 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实施。步骤用 `- [ ]` 复选框跟踪。

**目标：** 建起 `OJ2` 的 Bun workspaces 骨架，`bun dev` 能起来，并从本地 PostgreSQL 真实读出一道题、在浏览器里显示出来。

**架构：** 三个 workspace —— `apps/api`（Bun + Hono + Drizzle）、`apps/web`（由 ojnext 原样拷入，仅换 API 层）、`packages/contract`（Zod schema，前后端唯一真相源）。数据库结构由 `drizzle-kit pull` 从本地 PostgreSQL introspect 生成，剪掉 Django 框架表。本阶段只打通"读一道题"这一条最薄的链路，不碰认证、不碰判题。

**技术栈：** Bun 1.3.11、Hono、Drizzle ORM 0.45.2 / drizzle-kit 0.31.10、Zod、Vue 3 + Vite（沿用 ojnext）。

## 全局约束

- **不修改 `/home/xuyue/Projects/OJ/OnlineJudge/` 和 `/home/xuyue/Projects/OJ/ojnext/` 任何文件。** 两个旧仓库全程冻结，回滚路径依赖于此。`apps/web` 是**拷贝**，不是移动，不带 git 历史。
- **不写测试。** 项目既定策略（根 `CLAUDE.md`：Do not write new tests）。本计划用"跑起来看输出"替代测试环节。
- **PostgreSQL 固定 16。** 生产是 16.10，本地 compose 用 `postgres:16-alpine`（实测 16.14）。**不要换 17/18** —— 开发环境用了生产不支持的特性，要到切换那天才炸。
- **前端必须兼容旧版 Chrome（< 94）。** 学校机房电脑的浏览器版本低，ojnext 里的 `mermaid-legacy` 等 fallback 依赖是为此存在的，**搬运时一个都不能删**，`vite.config.ts` 的 build target 也不能提高。
- 本地依赖服务：`docker compose -f docker/compose.dev.yml up -d`，PostgreSQL 在 **5433**、Redis 在 **6380**（端口特意错开本机默认）。
- 数据库连接串：`postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge`
- 本地库结构已灌好：**34 张表**（27 业务 + 7 Django 框架），与 `docs/specs/schema.sql` 差集为 0。
- 端点清单已定案：新后端需实现 **110 个**端点，见 `docs/specs/endpoint-inventory.md`。本阶段只实现其中 1 个。
- Docker 命令若报 permission denied，说明当前 shell 不在 `docker` 组，用 `newgrp docker <<'EOF' … EOF` 包一层；重启终端后即可直接用。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json` | 根 workspace 定义 + 顶层脚本 |
| `bunfig.toml` | Bun 配置 |
| `tsconfig.base.json` | 三个 workspace 共享的 TS 编译选项 |
| `packages/contract/package.json` / `src/index.ts` | Zod schema 出口，前后端共同依赖 |
| `packages/contract/src/problem.ts` | 题目相关的 Zod schema 与类型 |
| `apps/api/package.json` / `src/index.ts` | Hono 应用入口 |
| `apps/api/src/db/schema.ts` | `drizzle-kit pull` 生成后剪枝的表定义 |
| `apps/api/src/db/index.ts` | Drizzle 客户端单例 |
| `apps/api/src/routes/problem.ts` | 题目路由 |
| `apps/api/drizzle.config.ts` | drizzle-kit 配置 |
| `apps/web/**` | 由 ojnext 拷入，仅改 API 层 |
| `docs/specs/sample-data.sql` | 从生产导出的题目样本（不含用户数据） |

---

## Task 1: monorepo 骨架与共享契约包

**Files:**
- Create: `package.json`、`bunfig.toml`、`tsconfig.base.json`
- Create: `packages/contract/package.json`、`packages/contract/tsconfig.json`、`packages/contract/src/index.ts`、`packages/contract/src/problem.ts`

**Interfaces:**
- Produces: workspace 名 `@oj2/contract`，导出 `problemSummarySchema`、`ProblemSummary`（后续任务的前后端都从这里 import）

- [ ] **Step 1: 写根 `package.json`**

```json
{
  "name": "oj2",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:api": "bun run --filter '@oj2/api' dev",
    "dev:web": "bun run --filter '@oj2/web' dev",
    "db:up": "docker compose -f docker/compose.dev.yml up -d",
    "db:down": "docker compose -f docker/compose.dev.yml down"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 2: 写 `bunfig.toml`**

```toml
[install]
# workspace 内部依赖走本地链接，不去 registry 找
linker = "hoisted"
```

- [ ] **Step 3: 写 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["bun"]
  }
}
```

- [ ] **Step 4: 写 `packages/contract/package.json`**

```json
{
  "name": "@oj2/contract",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "zod": "^4.0.0"
  }
}
```

- [ ] **Step 5: 写 `packages/contract/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 6: 写 `packages/contract/src/problem.ts`**

字段照着本地库 `problem` 表的真实列取。只放本阶段用得到的几个，不要把整张表铺开 —— YAGNI。

```typescript
import { z } from "zod"

/** 题目列表项。字段取自 problem 表，只含列表页需要的列。 */
export const problemSummarySchema = z.object({
  id: z.number().int(),
  _id: z.string(), // 展示用编号，与自增 id 不同
  title: z.string(),
  difficulty: z.string(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
})

export type ProblemSummary = z.infer<typeof problemSummarySchema>
```

- [ ] **Step 7: 写 `packages/contract/src/index.ts`**

```typescript
export * from "./problem"
```

- [ ] **Step 8: 安装并确认 workspace 被识别**

```bash
cd /home/xuyue/Projects/OJ/OJ2
bun install
```

预期：输出里能看到 workspace 解析，`node_modules/@oj2/contract` 是指向 `packages/contract` 的符号链接。核实：

```bash
ls -l node_modules/@oj2/
```

预期看到 `contract -> ../../packages/contract`。

- [ ] **Step 9: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add package.json bunfig.toml tsconfig.base.json packages/ bun.lock
git commit -m "feat(阶段1): monorepo 骨架与 @oj2/contract 契约包"
```

---

## Task 2: 从本地库生成 Drizzle schema 并剪枝

**Files:**
- Create: `apps/api/package.json`、`apps/api/tsconfig.json`、`apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/schema.ts`（由 drizzle-kit 生成后手工剪枝）
- Create: `apps/api/src/db/index.ts`

**Interfaces:**
- Consumes: 本地 PostgreSQL（`postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge`）
- Produces: `apps/api/src/db/schema.ts` 导出各表定义；`apps/api/src/db/index.ts` 导出 `db` 客户端单例

**先决条件**：`docker compose -f docker/compose.dev.yml ps` 显示两个服务都是 healthy。不是的话先 `bun run db:up` 并等健康检查通过。

- [ ] **Step 1: 写 `apps/api/package.json`**

```json
{
  "name": "@oj2/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "db:pull": "drizzle-kit pull"
  },
  "dependencies": {
    "@oj2/contract": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "hono": "^4.0.0",
    "postgres": "^3.4.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.10"
  }
}
```

- [ ] **Step 2: 写 `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "drizzle.config.ts"]
}
```

- [ ] **Step 3: 写 `apps/api/drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge",
  },
  // Django 框架表不进新后端，introspect 时直接排除
  tablesFilter: ["!django_*", "!auth_*"],
})
```

- [ ] **Step 4: 安装依赖并 introspect**

```bash
cd /home/xuyue/Projects/OJ/OJ2
bun install
cd apps/api
bun run db:pull
```

- [ ] **Step 5: 核对生成结果**

```bash
cd /home/xuyue/Projects/OJ/OJ2/apps/api
echo "生成的表数: $(grep -c 'pgTable(' src/db/schema.ts)"
grep -oE 'export const \w+ = pgTable\("\w+"' src/db/schema.ts | sed 's/.*pgTable("//' | tr -d '"' | sort | grep -E '^(django_|auth_)' && echo "❌ 仍有框架表" || echo "✅ 无框架表"
```

预期：
- 生成的表数 **27**（34 减去 7 张 Django 框架表：`auth_group`、`auth_group_permissions`、`auth_permission`、`django_content_type`、`django_dramatiq_task`、`django_migrations`、`django_session`）
- 输出 `✅ 无框架表`

若 `tablesFilter` 没生效、27 对不上，改为生成后手工删掉那 7 个 `pgTable` 定义，并在 `schema.ts` 顶部注释写明删了哪些、为什么。

- [ ] **Step 6: 确认 `user` 表的两个特殊列被正确生成**

```bash
grep -nE 'rawPassword|raw_password|sessionKeys|session_keys' src/db/schema.ts
```

预期两个都在。`raw_password` 是**有意保留**的明文密码列（教师查学生密码的运维需求，见设计文档 7.1.1），不要因为"看起来不安全"就删掉。`session_keys` 是死字段，但本阶段不动它 —— 删除属于后续阶段的清理工作。

- [ ] **Step 7: 写 `apps/api/src/db/index.ts`**

```typescript
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema"

const url = process.env.DATABASE_URL ?? "postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge"

const client = postgres(url)

export const db = drizzle(client, { schema })
export { schema }
```

- [ ] **Step 8: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add apps/api bun.lock
git commit -m "feat(阶段1): drizzle schema 从本地库生成并剪掉 Django 框架表"
```

---

## Task 3: 导入题目样本数据

**Files:**
- Create: `docs/specs/sample-data.sql`

**Interfaces:**
- Produces: 本地库里有若干条真实题目记录，供 Task 4 的接口读取

**只导题目和标签，不导用户。** 理由：题目内容（富文本、LaTeX、中文、特殊字符）正是最容易撑爆新后端序列化的东西，必须用真实数据；而学生账号属于个人信息，没有理由离开服务器 —— 本阶段也用不到用户数据。

`problem` 表有 `created_by_id` 外键指向 `user`，所以要先造一个占位用户，再导题目。

- [ ] **Step 1: 在服务器上导出题目样本**

登录生产服务器执行（容器名以实际 `docker-compose.yml` 为准）：

```bash
docker exec oj-postgres psql -U onlinejudge -d onlinejudge -c \
  "\copy (SELECT * FROM problem ORDER BY id LIMIT 20) TO STDOUT WITH CSV HEADER" > problems.csv
docker exec oj-postgres psql -U onlinejudge -d onlinejudge -c \
  "\copy (SELECT * FROM problem_tag) TO STDOUT WITH CSV HEADER" > tags.csv
```

- [ ] **Step 2: 传回本机**

```bash
scp <服务器>:~/problems.csv <服务器>:~/tags.csv /tmp/
```

- [ ] **Step 3: 确认没有夹带用户数据**

```bash
head -1 /tmp/problems.csv
grep -icE 'pbkdf2_sha256|@[a-z]+\.(com|cn|net)' /tmp/problems.csv
```

预期：表头是 problem 表的列名；第二条计数为 **0**。非 0 说明导错了表，删掉重来。

- [ ] **Step 4: 造占位用户并导入**

```bash
cd /home/xuyue/Projects/OJ/OJ2
docker cp /tmp/problems.csv oj2-postgres:/tmp/problems.csv
docker cp /tmp/tags.csv oj2-postgres:/tmp/tags.csv
docker exec -i oj2-postgres psql -U onlinejudge -d onlinejudge <<'SQL'
-- 占位用户，仅为满足 problem.created_by_id 外键；密码是无意义的固定串
INSERT INTO "user" (id, password, username, admin_type, problem_permission, open_api, is_disabled, session_keys, raw_password)
VALUES (1, 'unusable', 'devadmin', 'Super Admin', 'All', false, false, '[]'::jsonb, 'devonly')
ON CONFLICT (id) DO NOTHING;

\copy problem_tag FROM '/tmp/tags.csv' WITH CSV HEADER
\copy problem FROM '/tmp/problems.csv' WITH CSV HEADER
SQL
```

- [ ] **Step 5: 核对**

```bash
docker exec oj2-postgres psql -U onlinejudge -d onlinejudge -tAc \
  "SELECT count(*) || ' 道题, ' || count(DISTINCT difficulty) || ' 种难度' FROM problem"
docker exec oj2-postgres psql -U onlinejudge -d onlinejudge -tAc \
  "SELECT _id || ' | ' || left(title, 30) FROM problem ORDER BY id LIMIT 3"
```

预期：能看到 20 道题、若干种难度，以及 3 条真实的题目编号和标题。

- [ ] **Step 6: 把导入脚本存档**

把 Step 4 里的 SQL（不含 CSV 数据本身）写进 `docs/specs/sample-data.sql`，顶部注释说明 CSV 从哪来、为什么不导用户数据。**CSV 文件本身不入库** —— 题目内容是学校的教学资产，没必要进 git。在 `.gitignore` 加一行 `*.csv`。

- [ ] **Step 7: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add docs/specs/sample-data.sql .gitignore
git commit -m "chore(阶段1): 题目样本导入脚本（不含用户数据）"
```

---

## Task 4: Hono 应用与题目列表接口

**Files:**
- Create: `apps/api/src/index.ts`、`apps/api/src/routes/problem.ts`

**Interfaces:**
- Consumes: `db` 与 `schema`（Task 2）、`problemSummarySchema`（Task 1）、样本数据（Task 3）
- Produces: `GET http://localhost:3000/api/problems` 返回题目列表，形如 `{ "data": ProblemSummary[] }`

**响应格式说明**：阶段 0 已定案 API 重新设计，所以**不要**复刻旧后端的 `{error, data}` 格式。本阶段先用最朴素的 `{ data }`，完整契约留到阶段 3 铺开时定。

- [ ] **Step 1: 写 `apps/api/src/routes/problem.ts`**

```typescript
import { Hono } from "hono"
import { desc } from "drizzle-orm"

import { problemSummarySchema } from "@oj2/contract"

import { db, schema } from "../db"

export const problemRoutes = new Hono()

problemRoutes.get("/problems", async (c) => {
  const rows = await db
    .select({
      id: schema.problem.id,
      _id: schema.problem.id_,
      title: schema.problem.title,
      difficulty: schema.problem.difficulty,
      submissionNumber: schema.problem.submissionNumber,
      acceptedNumber: schema.problem.acceptedNumber,
    })
    .from(schema.problem)
    .orderBy(desc(schema.problem.id))
    .limit(20)

  // 用契约校验，schema 与实际数据对不上会在这里立刻炸，而不是传到前端才发现
  const data = rows.map((r) => problemSummarySchema.parse(r))
  return c.json({ data })
})
```

> **注意列名**：`drizzle-kit pull` 会把 `problem._id` 这类下划线开头的列生成成什么标识符，取决于生成结果。**先看 `src/db/schema.ts` 里 `problem` 表的实际字段名**，再照着写上面的 `select`。`submission_number` / `accepted_number` 同理，drizzle 通常转成 camelCase，但以生成结果为准，不要照抄本段。

- [ ] **Step 2: 写 `apps/api/src/index.ts`**

```typescript
import { Hono } from "hono"

import { problemRoutes } from "./routes/problem"

const app = new Hono()

app.get("/health", (c) => c.json({ ok: true }))
app.route("/api", problemRoutes)

export default {
  port: 3000,
  fetch: app.fetch,
}
```

- [ ] **Step 3: 起服务**

```bash
cd /home/xuyue/Projects/OJ/OJ2
bun run dev:api
```

- [ ] **Step 4: 验证（另开一个终端）**

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/problems | head -c 600
```

预期：
- `/health` 返回 `{"ok":true}`
- `/api/problems` 返回真实题目，能看到中文标题和真实的 `_id` 编号

若 Zod 校验报错，说明 `problemSummarySchema` 的字段类型与库里实际类型不符（常见：数字列被 postgres 驱动返回成字符串）。修 schema 或在 select 里转型，**不要**把校验去掉 —— 它在这里炸正是它的价值。

- [ ] **Step 5: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add apps/api/src
git commit -m "feat(阶段1): Hono 应用与题目列表接口，读通本地真实数据"
```

---

## Task 5: 把 ojnext 搬进 apps/web

**Files:**
- Create: `apps/web/**`（由 `/home/xuyue/Projects/OJ/ojnext` 拷贝）
- Modify: `apps/web/package.json`（改名、接入 workspace）

**Interfaces:**
- Consumes: `@oj2/contract`
- Produces: workspace `@oj2/web`，`bun run dev:web` 能起 Vite 开发服务器

**这是搬运，不是重写。** 37k 行 Vue、217 个文件原样拷过来，本阶段**一行业务代码都不改**。API 层的替换留到阶段 3。

- [ ] **Step 1: 拷贝（排除 node_modules、.git、构建产物）**

```bash
cd /home/xuyue/Projects/OJ
mkdir -p OJ2/apps/web
rsync -a --exclude=node_modules --exclude=.git --exclude=dist --exclude=package-lock.json \
  ojnext/ OJ2/apps/web/
```

`package-lock.json` 排除掉，因为 workspace 统一由根目录的 `bun.lock` 管。

- [ ] **Step 2: 确认旧仓库未被动过**

```bash
cd /home/xuyue/Projects/OJ/ojnext && git status --porcelain | wc -l
```

预期：`0`。非 0 说明 rsync 方向写反了，立刻 `git checkout .` 恢复。

- [ ] **Step 3: 改 `apps/web/package.json` 的包名**

把 `"name": "oj-next"` 改成 `"name": "@oj2/web"`，并加上契约包依赖：

```json
  "dependencies": {
    "@oj2/contract": "workspace:*",
```

其余 38 个依赖和 11 个 devDependencies **一个都不要动**，尤其是 `mermaid-legacy` 之类为兼容旧版 Chrome 存在的 fallback 包。

- [ ] **Step 4: 装依赖**

```bash
cd /home/xuyue/Projects/OJ/OJ2
bun install
```

从 npm 换到 bun 解析同一批依赖，可能出现版本漂移。装完看有没有报错或大量警告。

- [ ] **Step 5: 确认能构建**

```bash
cd /home/xuyue/Projects/OJ/OJ2/apps/web
bun run build
```

预期：构建成功，产出 `dist/`。这一步是搬运是否成功的**唯一硬指标** —— 38 个依赖在 bun 下能否正常解析、Vite 能否跑通，都在这里见分晓。

失败的话不要动业务代码，先看是不是依赖解析问题；实在不行退回用 npm 管 `apps/web`（Bun workspaces 允许某个包单独用别的包管理器，代价是失去统一 lockfile）。

- [ ] **Step 6: 确认旧版 Chrome 兼容没被破坏**

```bash
cd /home/xuyue/Projects/OJ/OJ2/apps/web
grep -nE '"target"|build:\s*\{' vite.config.ts | head
grep -c 'mermaid-legacy' package.json
```

预期：`vite.config.ts` 的 build target 与 ojnext 原文件完全一致（可 `diff` 对照 `/home/xuyue/Projects/OJ/ojnext/vite.config.ts`，应无差异）；`mermaid-legacy` 计数 ≥ 1。

- [ ] **Step 7: 起开发服务器看一眼**

```bash
cd /home/xuyue/Projects/OJ/OJ2
bun run dev:web
```

浏览器打开 `http://localhost:5173`。此时 API 还指向旧后端（`vite.config.ts` 里 `/api` 代理到 `PUBLIC_OJ_URL`），页面可能报接口错误 —— **这是预期的**，本阶段不接线。只要页面框架能渲染出来就算过。

- [ ] **Step 8: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add apps/web bun.lock
git commit -m "feat(阶段1): 搬入 ojnext 为 apps/web，未改业务代码"
```

---

## Task 6: 端到端串通

**Files:**
- Modify: `apps/web/vite.config.ts`（新增一条指向新 API 的代理）
- Create: `apps/web/src/oj/dev-problems.vue`（临时验证页，阶段 3 会删）
- Modify: `apps/web/src/routes.ts`（挂一条临时路由）

**Interfaces:**
- Consumes: `GET /api2/problems`（Task 4 的接口，经 Vite 代理）、`ProblemSummary`（Task 1 的类型）

**这一步的唯一目的是证明链路通了**：本地 PostgreSQL → Drizzle → Hono → 契约校验 → Vite 代理 → Vue 页面。用 `/api2` 前缀而不是 `/api`，是为了不影响现有页面继续指向旧后端。

- [ ] **Step 1: 在 `apps/web/vite.config.ts` 的 proxy 里加一条**

在现有的 `"/api"`、`"/public"`、`"/ws"` 之外新增：

```typescript
        "/api2": {
          target: "http://localhost:3000",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api2/, "/api"),
        },
```

- [ ] **Step 2: 写临时验证页 `apps/web/src/oj/dev-problems.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from "vue"
import type { ProblemSummary } from "@oj2/contract"

const problems = ref<ProblemSummary[]>([])
const error = ref("")

onMounted(async () => {
  try {
    const res = await fetch("/api2/problems")
    const body = await res.json()
    problems.value = body.data
  } catch (e) {
    error.value = String(e)
  }
})
</script>

<template>
  <div style="padding: 24px">
    <h2>阶段 1 链路验证（临时页，阶段 3 删除）</h2>
    <p v-if="error" style="color: red">{{ error }}</p>
    <p>共 {{ problems.length }} 道题</p>
    <ul>
      <li v-for="p in problems" :key="p.id">
        {{ p._id }} — {{ p.title }}（{{ p.difficulty }}，通过 {{ p.acceptedNumber }}/{{ p.submissionNumber }}）
      </li>
    </ul>
  </div>
</template>
```

- [ ] **Step 3: 在 `apps/web/src/routes.ts` 挂一条路由**

照该文件已有的路由写法，加一条 `path: "/dev-problems"` 指向上面这个组件。**照抄文件里现有条目的风格**，不要自创写法。

- [ ] **Step 4: 两个服务一起起**

```bash
cd /home/xuyue/Projects/OJ/OJ2
bun run db:up     # 若依赖服务没在跑
bun run dev       # 同时起 api 和 web
```

- [ ] **Step 5: 验证**

浏览器打开 `http://localhost:5173/dev-problems`。

预期：页面列出 20 道**真实题目**，中文标题正常显示，编号和通过数都是库里的真实值。

这就是阶段 1 的出口标准。看到题目列表出来，说明本地 PostgreSQL → Drizzle → Hono → Zod 契约 → Vite 代理 → Vue 组件这条链路全线打通，且类型从数据库一路贯通到了前端组件（`ProblemSummary` 在 `.vue` 里有完整类型提示）。

- [ ] **Step 6: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add apps/web/vite.config.ts apps/web/src/oj/dev-problems.vue apps/web/src/routes.ts
git commit -m "feat(阶段1): 端到端串通，前端显示本地库真实题目"
```

---

## 阶段 1 完成标准

五项全部满足才算完成：

- [ ] `bun install` 后 `node_modules/@oj2/contract` 是指向 `packages/contract` 的符号链接
- [ ] `apps/api/src/db/schema.ts` 有 27 张表，无 `django_*` / `auth_*`
- [ ] `curl http://localhost:3000/api/problems` 返回真实题目数据
- [ ] `cd apps/web && bun run build` 构建成功，且 `vite.config.ts` 与 ojnext 原文件无差异
- [ ] 浏览器 `http://localhost:5173/dev-problems` 显示 20 道真实题目

---

## 自查记录

**规格覆盖：** 设计文档第 11 节阶段 1 列的四项 —— 建仓与 Bun workspaces（Task 1）、`drizzle-kit pull` 并剪掉 `django_*`（Task 2）、拷贝 ojnext 进 `apps/web`（Task 5）、出口标准"能从真实库读出一道题"（Task 4 + Task 6）—— 均已覆盖。额外补了 Task 3（样本数据），因为本地库只有结构没有数据，不导样本无法验证出口标准。

**与设计文档的偏离：**
1. 出口标准原文是"能从真实库读出一道题"，当时假设本机无数据库。现在改为**本地 PostgreSQL 16 + 生产导出的题目样本**，比原设想更强（能在浏览器里端到端看到）。
2. 不写测试 —— 遵循项目既定策略，用"跑起来看输出"替代。

**类型一致性：** `ProblemSummary` 在 Task 1 定义、Task 4 用于后端校验、Task 6 用于前端类型标注，三处同源。`db` / `schema` 在 Task 2 定义、Task 4 消费。Task 4 Step 1 已显式提醒：`select` 的字段名必须以 `drizzle-kit pull` 的实际生成结果为准，不得照抄计划正文。

**已知风险：** Task 5 Step 5 的 `bun run build` 是本阶段唯一可能大面积失败的地方 —— ojnext 的 38 个依赖从 npm 换到 bun 解析可能漂移。计划里给了退路（该包单独用 npm 管）。

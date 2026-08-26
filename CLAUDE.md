# CLAUDE.md

OJ2 是判题狗（Online Judge）的后端重写：Django 6 → Bun + TypeScript，前后端同仓。
上一代在 `../OnlineJudge/`（Django）和 `../ojnext/`（Vue SPA），**两者都是回滚路径，
完全冻结、一行都不改。**

> **2026-08-26 起**：旧仓库零改动，没有例外——包括修 bug、包括不影响外部接口的
> 内部小修（日志、缓存实现之类，以前允许，现已收紧）。所有后续工作，包括在旧仓库
> 里发现的 bug，都只落在 OJ2：先确认 OJ2 是否有对应逻辑、是否重现了同样的问题，
> 只在 OJ2 里修；旧仓库那边如实告知用户"未处理，按当前政策不动旧仓库"，不要顺手改掉。

冻结的目的是「回滚那天旧站能原样起来、和新站看到同一份数据」——改 OJ2 时，接口路径
与响应结构、数据库 schema 这些外部可观测的东西都要小心，一动回滚就不再是「把上游
切回去」那么简单。

设计文档：`docs/specs/2026-08-06-bun-backend-rewrite-design.md`
切换手册：`docs/specs/phase5-cutover-runbook.md` ← 上线当天照这份走

## 仓库结构

| 目录 | 作用 |
|---|---|
| `apps/api/` | 后端。Hono + Drizzle + BullMQ，编译成单二进制 |
| `apps/web/` | 前端。从 ojnext 原样搬来的 Vue 3 SPA |
| `packages/contract/` | 前后端共用的 Zod 契约 |
| `docker/` | Dockerfile + 三套 compose（dev / debian / school） |
| `docs/specs/` | 设计、端点清单、各阶段评审报告与演练报告 |

## 本机环境

**Docker 可用，全套依赖都能在本机跑起来**（PostgreSQL、Redis、判题沙箱），
镜像也能在本机构建并完整演练上线。这一点和上一代不同，别沿用"本机跑不起来后端"
的旧假设。

```bash
bun install
bun run db:up          # 起 postgres(5433) / redis(6380) / 判题沙箱(8081)
bun run dev            # api(3000) + worker + web(5173) 一起起
```

首次要先建 `.env`（照 `.env.example`）。判题机 token 两边必须一致：
`.env` 的 `JUDGE_SERVER_TOKEN` 和 `docker/.env` 的 `OJ2_JUDGE_TOKEN`。

常用检查：

```bash
bunx tsc --noEmit -p apps/api                 # 后端类型检查
bun run --filter '@oj2/api' check:routes      # 路由遮蔽检查，加完路由跑一下
cd apps/web && bun run build                  # 前端构建（vite 不做类型检查，构建即验证）
```

**不要写测试** —— 沿用上一代的项目约定。验证靠实跑：起服务、打接口、看结果。

## 几件必须知道的事

### 单二进制是有代价的

`apps/api` 编译成 `bun build --compile` 的单二进制，所以**运行时不能依赖
node_modules**。任何 `require.resolve` / `Bun.resolveSync` / `__dirname` 去找文件的
写法，本地都正常、编译后都会炸，而且**只在离开仓库目录后才炸**（在仓库里跑时它顺着
cwd 摸到了 node_modules，假装没事）。

资源要用 `with { type: "file" }` 内嵌。`.node` 原生模块还要额外注意：这个写法
只有打包器认、`bun run` 不认，所以必须按形态分叉 —— 见 `apps/api/src/vendor/jieba.ts`
的注释，那里把坑写全了。

**改完这类代码，dev 和编译两种形态都要跑一遍。** 我吃过亏：只验了编译产物，
dev 直接起不来。

### 路径解析看 `runtime.ts`

编译后 `import.meta.dir` 恒为 `/$bunfs/root`，往上三级就是文件系统根。
相对路径一律走 `runtime.ts` 的 `pathBase`，别自己拼。

### SQL 判题会 spawn「自己」

`judge/sql/index.ts` 起的子进程是二进制自身 + `sql-child` 子命令（因为编译后磁盘上
没有 child.ts 可以 spawn）。所以**入口必须有 argv 分发**，否则「起自己」变成
「把整个程序再跑一遍」→ 指数级 fork。这不是假想，开发时炸过一次开发机。
`OJ2_SQL_CHILD` 那道递归闸不要删。

### 加路由要防遮蔽

**Hono 按注册顺序匹配，不是静态优先**（实测确认过，别凭直觉）。`/problems/:id`
注册在 `/problems/random` 前面的话，后者永远进不去 —— 而且不报错、不警告，
只是静默走进前一条的 handler。阶段 4 真实发生过一次，两个教师用的分析端点被吃掉，
一直到评审才发现。

加完路由跑 `bun run --filter '@oj2/api' check:routes`。

### 判题状态码要三处同步

`apps/api/src/judge/status.ts`、`apps/web/src/utils/constants.ts`、
以及上一代的 `../OnlineJudge/submission/models.py`（回滚时要对得上）。
题目表情 reaction 的语义 key 同理。

### 比赛只有 ACM 模式

没有 OI。上一代残留的 OI 分支在阶段 0 已经砍掉，不要"顺手补回来"。

### 前端要兼容老 Chrome

机房电脑 Chrome < 94。`mermaid-legacy` 等 fallback 依赖和 vite 的构建 target
不能动，`vite.config.ts` 里有注释说明。

## 数据库

Drizzle schema 是从生产库 `drizzle-kit pull` 出来的，**不写迁移**。
新旧后端跑在同一套表结构上（阶段 5 演练逐列比对过，零差异），这是回滚能成立的前提 ——
所以改 schema 前先想清楚回滚怎么办。

生产库的几个约定：

- `raw_password` 明文列**要保留**，老师用它找学生密码。不要"顺手清理"。
- `judge_server_heartbeat` 保留。
- `problem.prompt` 是给未来 AI 预留的，当前没接线，不要删。

## 部署

三套 compose 在 `docker/`：`dev`（本机）、`debian`（服务器）、`school`（机房）。

**机房那套没有 postgres，连的是服务器的库。** 两个站点共用一个数据库，
但各有各的 Redis 和判题沙箱 —— 所以上线那天**两边必须一起切**。

`compose.debian.yml` 有两种形态，靠 env 切换：

- **只换前后端**（上线用这个）：设 `DATA_DIR` / `DB_HOST` / `REDIS_HOST`，
  沿用旧栈已经在跑的 postgres 和 redis，只起 api / worker / web / judge。
- **自带数据**（本机、演练）：不设那几个变量，起栈时加 `--profile local-data`。
- **并行试跑**（上线前先挂 `oj2.xuyue.cc` 跑几天）：在「只换前后端」基础上再加
  `WEB_PORT`（8080 被旧 backend 占着）和 `JUDGE_STATE_DIR`（两个判题机不能共用运行目录）。
  这种形态下旧栈一个容器都不用停，正式切换退化成改一行 NPM 上游。

⚠️ `DATA_DIR` 默认值 `../data` 是 **`OJ2/data`**，不是部署目录的 `data/`。
沿用旧数据却忘了设它，会静默起一套空数据（空库、没测试点、图片 404），
而且**不报错** —— 这是切换当天唯一会静默走歪的地方。

细节和演练结果都在 `docs/specs/phase5-cutover-runbook.md`。

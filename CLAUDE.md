# CLAUDE.md

OJ2 是判题狗（Online Judge）的后端重写：Django 6 → Bun + TypeScript，前后端同仓。
上一代在 `../OnlineJudge/`（Django）和 `../ojnext/`（Vue SPA），**仍然完全冻结、
一行都不改**。

> **2026-08-26：回滚路径已废弃，且已经不可逆。** 旧 Django 后端确认不再使用，
> `0002_drop_django_leftovers` 删掉了它的 7 张框架表（含 `django_session`、
> `django_migrations`）。**这条迁移已在生产库执行完毕**
> （`docker exec oj-api oj2-api migrate` 回「没有待执行的迁移」）。
>
> 所以旧栈现在**起不来**了：「停新栈起旧栈」「把 NPM 上游改回 8080」都已失效，
> 唯一退路是从数据库备份恢复。切换手册里的「回滚保证」那节只剩历史价值。
>
> 「改 schema 要考虑回滚」这条约束随之解除，schema 归 OJ2 独占，
> 走 drizzle migration 正常演进即可。

> **旧仓库仍然零改动**，没有例外——包括修 bug、包括不影响外部接口的内部小修。
> 所有后续工作，包括在旧仓库里发现的 bug，都只落在 OJ2：先确认 OJ2 是否有对应逻辑、
> 是否重现了同样的问题，只在 OJ2 里修；旧仓库那边如实告知用户"未处理，按当前政策
> 不动旧仓库"，不要顺手改掉。冻结的理由现在只剩「留作参照、别分散精力」，
> 不再是回滚保证。

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

### 判题状态码不能改

`apps/api/src/judge/status.ts` 和 `apps/web/src/utils/constants.ts` 必须一致。
这些整数是**落库的值**：12 万条历史提交的 `submission.result` 就是它们，判题沙箱回的也是
这套编码，所以只能新增、不能改已有的含义。题目表情 reaction 的语义 key 同理。

### 比赛只有 ACM 模式

没有 OI。上一代残留的 OI 分支在阶段 0 已经砍掉，不要"顺手补回来"。

### 前端要兼容老 Chrome

机房电脑 Chrome < 94。`mermaid-legacy` 等 fallback 依赖和 vite 的构建 target
不能动，`vite.config.ts` 里有注释说明。

## 数据库

Drizzle schema 最初是 `drizzle-kit pull` 从生产库拉出来的，所以它长得像 Django 建的表
（表名、bigint/int4 混用、外键全是 NO ACTION），`schema.ts` 顶部记了哪些地方是手工修的。

**schema 现在归 OJ2 独占。** 旧后端已下线，「改 schema 要考虑回滚」这条约束不再存在，
结构变更走下面的 migration 正常演进即可。

### 改 schema 走 drizzle migration

`bun run db:generate`（造迁移文件）→ `bun run db:migrate`（按 `drizzle.__drizzle_migrations`
增量执行），就是 Django `makemigrations` / `migrate` 的等价物。索引/结构变更走这条，
不要再手写 SQL 往 `docs/specs/` 里塞。

**部署时自动执行。** `docker/deploy.sh` 在「构建镜像」之后、「起栈」之前会跑
`oj2-api migrate`，失败就中止部署（旧容器原样还在跑）。CI 走的也是 deploy.sh，
所以不需要给 GitHub 配数据库凭据，也不用把生产库对外开放。

迁移文件**不内嵌进二进制**，随镜像装在 `/usr/local/share/oj2/migrations`
（见 `runtime.ts` 的 `migrationsDir`、Dockerfile 里那两条 COPY）。这样 drizzle 的
`migrate()` 能原样用——它靠 `meta/_journal.json` 自动发现迁移，**新增迁移不用改任何
代码**。内嵌就得为每条迁移手写一行 import，那是迟早会漏的账。

**破坏性迁移默认拦截。** 含 `DROP TABLE` / `DROP COLUMN` / `DROP SCHEMA` /
`ALTER COLUMN ... TYPE` / `TRUNCATE` 的迁移会让部署停在迁移这步并退出 4，
需要确认备份后显式放行：

```bash
OJ2_ALLOW_DESTRUCTIVE=1 docker/deploy.sh
```

`DROP INDEX` / `DROP CONSTRAINT` 不算——它们不掉数据，拦了只会让人习惯性带上放行开关。

**0000 跑不了，库不能靠迁移自举。** `0000_crazy_gateway.sql` 是 `drizzle-kit pull`
的产物，整份被 `/* */` 包着，可执行语句 0 条。所以任何新库的结构都只能来自
`docs/specs/schema.sql` 或生产 dump，然后手工做基线。`oj2-api migrate` 会检测这两种
情况并打印具体该做什么，不会让你撞上 drizzle 那个语焉不详的报错。

**给一个已经存在的库做基线**：drizzle 没有 `--fake-initial`，`migrate` 见到空的
`__drizzle_migrations` 会从 `0000` 的完整建表跑起，撞上已存在的表就整个事务回滚 ——
**而且失败时 exit 1 但一个错误都不打印**（只有 NOTICE，实测过）。所以对已有数据的库
第一次跑之前，先手插一行把 `0000` 标记成已执行：

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
  VALUES ('baseline-0000-faked', 1786070652521);   -- = meta/_journal.json 里 0000 的 when
```

migrator 只比 `created_at`，不校验 hash，所以 hash 随便填。

**已知的三个坑**（`meta/0000_snapshot.json` 是 `pull` 出来的，没法无损还原 Django 建的
schema，下面三处已经修过了，别让它们回潮）：

- ~~**快照里的 Django 序列**~~：已随 `0002_drop_django_leftovers` 删表一并解决，
  `tablesFilter` 也移除了。（历史原因：`tablesFilter` 只过滤表、不过滤它们的序列，
  于是 `generate` 会吐出 5 条 `DROP SEQUENCE`。）
- **bigint 上限精度**：`pull` 生成的 `maxValue: 9223372036854775807` 是 JS number 字面量，
  round-trip 成 `...776000`，每次 generate 都会多出 10 条 `ALTER COLUMN ... SET MAXVALUE`。
  已改成字符串。
- **表达式索引的 opclass**：`problem_tag_name_ci_unique` 在快照里带 `opclass`，但 drizzle
  自己序列化不出来，导致每次都 drop + recreate。已从快照里去掉。

**还有两个改不掉的、写代码时要绕开的**：

- **索引方向会被丢**：`.desc()` 在生成 SQL 时消失，但快照里记成 `asc: false`，两边对不上，
  下次 pull 就是假 diff。单列索引不写方向就行（Postgres 用 Index Scan Backward 服务
  `ORDER BY ... DESC`，代价一样）。**多列混合方向的索引别指望 generate**，得手写。
- **`CREATE INDEX CONCURRENTLY` 跑不了**：migrator 把所有语句包在一个事务里。大表加索引
  要是不能接受锁写窗口，只能绕开 migration 手工执行。参考量级：12.3 万行的部分索引，
  普通 `CREATE INDEX` 只锁 74ms，一般不用纠结。

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

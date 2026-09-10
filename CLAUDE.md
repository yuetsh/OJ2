# CLAUDE.md

OJ2 是判题狗（Online Judge）的后端重写：Django 6 → Bun + TypeScript，前后端同仓。
上一代在 `../OnlineJudge/`（Django）和 `../ojnext/`（Vue SPA），**仍然完全冻结、
一行都不改**。

> **旧栈已不可逆地下线。** `0002_drop_django_leftovers` 删掉了 Django 的框架表
> （`django_session` 等），且已在生产库执行完毕。所以「停新栈起旧栈」「把 NPM 上游
> 改回 8080」都已失效，**唯一退路是从数据库备份恢复** —— 切换手册里的「回滚保证」
> 那节只剩历史价值。
>
> 生产库上 0002 有一张没删干净（0 行的 `django_migrations`，来源已无法复原），
> 由 `0014_drop_django_migrations` 补删，前因后果写在那个迁移文件的注释里。
>
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
bun run --filter '@oj2/api' typecheck         # 后端类型检查
bun run --filter '@oj2/api' check:routes      # 路由遮蔽检查，加完路由跑一下
cd apps/web && bun run type-check             # 前端类型检查
cd apps/web && bun run build                  # 前端构建
```

⚠️ **前端类型检查只能走 `bun run type-check` 这个脚本。** 两条看起来等价的路子
都会**静默通过**：`vue-tsc --noEmit -p tsconfig.json` 检查 0 个文件（那个
tsconfig 是 `files: []` + references 的壳，真正的配置在 `tsconfig.app.json`），
而 `vite build` 根本不做类型检查。改完 .vue / .ts 别拿构建当验证。

**不要写测试** —— 沿用上一代的项目约定。验证靠实跑：起服务、打接口、看结果。
本机 Docker 全套都能起，实跑的成本比想象中低。

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

### 出参不 `parse`，用 `satisfies`

**后端的响应一律 `satisfies XxxType`，不要写 `xxxSchema.parse({...})`。**
出参是后端自己刚拼出来的字面量，TS 已经在编译期校验过；再 `parse` 一遍拿不到任何新
信息，唯一可能失败的输入是**库里的历史数据**，而失败的代价是 500。这一层原来有 136 处，
已经全部撤掉，撤的时候当场炸出两个一直存在的线上 500：

- `adminProblemSchema.lastUpdateTime` 写的是 `z.string()`，但 `problem.last_update_time`
  是全库唯一可空的列（961 道题里 470 道是 NULL）——**后台打开任何一道没编辑过的老题都是 500**；
- `embeddedSubmissionSchema` 从 `submissionDetailSchema` 继承了 `problemDisplayId` 却没
  omit，而路由只填了同义的 `problem`——**凡是收到过站内信的人，消息页都打不开**（列表为空
  时才碰巧不炸，所以一直没人报）。

两个都是「读出侧校验」自己造出来的故障，不是它拦住的故障。历史上还有两次同类：
`exerciseSchema` 按题型收紧后一行脏数据让整条练习列表 500；`info` 写成
`union([完整形状, z.object({})])` 后对不上的一律落进空对象那支且 parse **成功**，
管理员详情页的测试点表格静默消失（全量核出 9163/124192 条中招，RE 8480/8480 全中——
沙箱在非正常退出的测试点上写 `output_md5: null`，而契约写的是 `z.string()`）。

**闸设在写入侧，一共三处形态：**

1. **入参 `safeParse`**（58 处，全部保留）—— 请求体进来的那一刻校验，对不上回 400。
2. **`db/schema.ts` 的 `.$type<>()`** —— 枚举型的列（`submission.result` / `.language`、
   `problem.difficulty` / `.languages`、`achievement.rarity`、`exercise.type`…）和几个
   形状确定的 JSONB（`problem.template` / `.astRules` / `.sqlConfig` / `.sqlDisplay`、
   `acm_contest_rank.submission_info`）直接在列上收窄，只影响 TS、不产生任何 SQL。
   这些断言**逐列拿根目录那份生产备份核过**（12.4 万条提交的 `result` 全在 `-2..6,10`、
   961 道题的 `languages` 全是合法数组、10050 条榜单条目形状全对）。
   加这类断言前先照样核一遍，别凭直觉。
3. **语义校验函数** —— `astRulesError()`、`services/exercise.ts` 的 `exerciseDataError`。

**JSONB 原文（`submission.info` / `statistic_info` / `exercise.data`）仍然一律放行**，
读出侧不收窄：它们的形状真相在判题机那边。

query 里的筛选值要和收窄过的列比较时走 `routes/helpers.ts` 的 `asFilterValue()` ——
那是纯类型交接，**不加校验**：在那儿拦一道会把「筛出空列表」变成「筛条件被忽略、
返回全部」。前端那侧（`utils/contract.ts` 为什么只挂三处）见 `apps/web/CLAUDE.md`。

唯一还留着 `parse` 的地方是 `judge/events.ts` 的 `parseSubmissionEvent` ——
那是从 Redis 收回来的报文，真边界，且失败返回 `null` 而不是 500。

### AST 代码规则有两张表，必须同增同减

契约的 `AST_NODE_TARGETS_BY_LANGUAGE`（target → 中文名）决定后台下拉能选什么，
`apps/api/src/judge/ast.ts` 的 `mappings`（target → tree-sitter 节点类型）决定判题机
认得什么。**加节点类型时两边都要加**，运算符表 `AST_OPERATOR_TARGETS_BY_LANGUAGE` 同理。

只加一边是**静默错判**：判题机 `mapping[target] ?? target` 拿裸名去比节点类型，
C 的语法树里永远不存在 `list_comprehension`，于是「必须使用列表推导式」永远失败、
「不能使用 f-string」永远通过，两头都不报错，只有学生受着。原来那张表是 C/Python
混在一起的 15 条，整份铺成下拉，给 C 题也能选到 Python 专有节点——就是这么来的。

判题机只认 `AST_SUPPORTED_LANGUAGES` 里的语言（C / C++ / Python3）。别的语言配了规则
一条都不会跑，所以后台不给它们开 tab，题目页也不把它们的规则展示成「要求」——
**看得见却不检查**比没有更糟。

C++ 的语法表是「C 的全集 + C++ 独有的几条」，因为 tree-sitter-cpp 继承 tree-sitter-c，
C 那 14 个 target 在 C++ 树里逐个实测通用。但**调用形态两者不同**，加语言时必须一起看：
`a.push_back()` 和 `p->push_back()` 在 C++ 都是 `call_expression` + `field_expression`，
不是 Python 的 `attribute`；`std::sort(...)` 的 function 是 `qualified_identifier`
而不是 `identifier`，所以 `functionCalls` 对 C++ 额外比一次 `::` 末段——否则学生写了
`using namespace std` 与否会得到不同的判定结果。

规则的语义校验在 `astRulesError()`，不在 zod 的 refine 上：`astRulesSchema` 同时用于
**读**后台题目详情，在读路径上抛错会让历史脏数据把整个题目详情打不开。同理，保存前
先 `pickAstRules()` 剔除够不着的分组再校验，否则早年配过 C++ 规则的题会把老师锁死
——tab 里看不到那组规则，保存却被拦下。

### 比赛只有 ACM 模式

没有 OI。上一代残留的 OI 分支在阶段 0 已经砍掉，不要"顺手补回来"。

### 前端要兼容老 Chrome

机房电脑 Chrome < 94。`mermaid-legacy` 等 fallback 依赖和 vite 的构建 target
不能动，`vite.config.ts` 里有注释说明。

## 数据库

Drizzle schema 最初是 `drizzle-kit pull` 从生产库拉出来的，所以它长得像 Django 建的表
（表名、bigint/int4 混用），`schema.ts` 顶部记了哪些地方是手工修的。

**外键的删除动作从 0010 起是显式的**，不再是 Django 留下的一律 NO ACTION：

- **CASCADE**：父行消失后子行必然无意义、且不构成「学生做过什么」的证据 —— 中间表
  （problem_tags）、题单/教程/成就的组成部分、一对一附属（user_profile）与可重算的
  缓存（user_stat）。
- **NO ACTION（即拦住）**：需要人看见的删除 —— `submission.problem_id`、以及 `user`
  的绝大多数外键。删用户撞外键会被 handler 翻译成「请改为禁用账号」，这是有意的。

**加新子表时必须回来想一遍该走哪一档**，别默认新外键会自己连坐 —— drizzle 不写
`.onDelete()` 就是 NO ACTION，而 0010 只改了当时存在的那批。

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
**空库自举时这道闸不生效**：没有数据可丢，0002 那串 `DROP ... IF EXISTS` 全是空转，
拦下来只会逼每个新环境都带一次放行开关，把它训练成习惯动作。

**放行的三条路，别记错：**

1. 服务器上手工部署：`OJ2_ALLOW_DESTRUCTIVE=1 docker/deploy.sh`。
2. CI（`.github/workflows/deploy.yml`）：**必须先手工触发**并在
   `workflow_dispatch` 上勾 `allow_destructive`。push 触发拿不到这个 input，值恒为空
   —— 也就是说**自动部署永远不会执行破坏性迁移**，只会停在闸门上把工作流判红。
   这是有意的：那种改动得有人先确认备份。
3. 先单跑迁移把结构推到位，再 push 代码：迁移一旦记进
   `drizzle.__drizzle_migrations` 就不会再跑，后续自动部署里它已不是 pending，
   自然不触发闸门。多环境共库时（机房 + 服务器）推荐这条。

**空库能自举了。** `oj2-api migrate` 指向一个空库时直接从 `0000` 建起：

```bash
DATABASE_URL=postgres://... oj2-api migrate
# 空库，从 0000 开始自举。
# 待执行 15 条迁移，开始。
#   ✓ 0000_crazy_gateway
#   ✓ 0001_add_submission_public_create_time_idx
#   ✓ 0002_drop_django_leftovers
#   …
#   ✓ 0014_drop_django_migrations
```

`0000_crazy_gateway.sql` 原本是 `drizzle-kit pull` 的产物、整份被 `/* */` 包着、可执行
语句 0 条，所以以前新库只能先手工 `psql -f docs/specs/schema.sql`。现在它的内容由那份
生产 dump 机械转换而来（去掉 psql 专有指令、去掉 7 张 Django 遗留表及其索引外键，
其余原样保留）。**实测**：空库自举出来的结构，和「灌 schema.sql + 打基线 + 跑迁移」
这条老路子跑出来的结构，`pg_dump --schema-only` 逐字节一致（734 行，零差异）。

改 0000 对生产库没有影响 —— migrator 只比 `created_at`、**从不校验 hash**
（`pg-core/dialect.js` 里就一句 `Number(lastDbMigration.created_at) < migration.folderMillis`），
而生产库那行 `baseline-0000-faked` 早把它挡在门外了。

⚠️ **0000 的注释里不要出现 statement-breakpoint 那个分隔标记的字面量。**
`readMigrationFiles` 是纯文本切分，不管它在不在注释里，照切不误 —— 注释被从中间切开，
后半截当成 SQL 发出去，报的是 `syntax error at or near "。"` 这种和真实原因毫不相干的错。

**给一个已经存在的库做基线**：drizzle 没有 `--fake-initial`，`migrate` 见到空的
`__drizzle_migrations`、库里却已经有表，会拒绝执行并 exit 3（裸跑 `drizzle-kit migrate`
的话则是从 `0000` 撞上已存在的表、整个事务回滚，**而且 exit 1 却一个错误都不打印**）。
对已有数据的库第一次跑之前，先手插一行把 `0000` 标记成已执行：

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

**还有一个写代码时要绕开的**：

- **`.op()` 会吞掉索引方向**：真正的根因不是 `.desc()`，是 opclass。drizzle-kit 的
  `CreatePgIndexConvertor` 里那个三元一旦走进 opclass 分支就回不到方向分支：
  `${it.opclass ? ` ${it.opclass}` : it.asc ? "" : " DESC"}`。而 `drizzle-kit pull`
  给**每一列**都挂了 `.op(...)`，所以本仓库里"写了 `.desc()` 却生成不出 DESC"每次都会重演。

  **要方向就别写 `.op()`。** 不写没有任何代价——`int4_ops` / `timestamptz_ops` 本来就是
  这些类型的默认 opclass，写了等于没写。实测（drizzle-kit 0.31.10，探针索引跑过 generate）：

  | schema.ts | 生成的 SQL |
  |---|---|
  | `.desc().nullsFirst().op("timestamptz_ops")` | `"create_time" timestamptz_ops` ← 方向丢了 |
  | `.desc().nullsFirst()` | `"create_time" DESC NULLS FIRST` ✅ |
  | `.desc()` | `"create_time" DESC NULLS LAST` ✅ |

  所以**多列混合方向的索引可以正常 generate**，不必手写。

  假 diff 的机制也要理解对：带 `.op()` 时快照记的是 `asc: false`，SQL 建出来却是 ASC，
  **分歧在快照和真实库之间**，不在快照和 schema.ts 之间——所以再跑 generate 是干净的，
  要等到下次 pull 才炸出来。这是当初难定位的原因。

### 迁移执行器是自己的，不是 drizzle 那个

`db/migrate.ts` 不调用 drizzle 的 `migrate()`，自己按 journal 逐条执行。换掉它是因为
`pg-core/dialect.js` 里那个实现有两条硬伤：

1. **所有待执行的迁移共用一个事务**，第 3 条失败会把第 1、2 条一起回滚。现在是**一条一个
   事务**，语义和 Django `migrate` 一致，失败时也说得清库停在哪儿。
2. 正因为全在事务里，`CREATE INDEX CONCURRENTLY` 一律跑不了，没有开关。

记账行的写法和 drizzle 完全一致（`hash` = 整个文件的 sha256，`created_at` = journal 的
`when`），而 migrator 只比 `created_at`、不校验 hash，所以两套执行器可以互换，不会看不懂
对方写的记录。

**`CREATE INDEX CONCURRENTLY` 现在能跑了。** 在迁移文件**第一行**写上标记：

```sql
-- oj2:no-transaction
CREATE INDEX CONCURRENTLY "xxx_idx" ON "submission" USING btree ("language");
```

这条迁移就走裸执行（简单查询协议，不包事务）。代价是**没有回滚**：中途失败时前面的语句
已经生效，而且 CONCURRENTLY 失败会在库里留下一个 INVALID 索引，要先
`DROP INDEX` 再重来（`select indexrelid::regclass from pg_index where not indisvalid`
能找出来）。所以**这种迁移一个文件只放一条语句**。

要不要用是另一回事：参考量级是 12.3 万行的部分索引，普通 `CREATE INDEX` 只锁 74ms，
一般不用纠结，CONCURRENTLY 留给真扛不住锁写窗口的场合。

退出码：2 = 配置/文件问题，3 = 基线不对，4 = 撞上破坏性迁移，5 = 某条迁移执行失败。

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

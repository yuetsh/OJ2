# CLAUDE.md

OJ2 是判题狗（Online Judge）的后端重写：Django 6 → Bun + TypeScript，前后端同仓。
上一代在 `../OnlineJudge/`（Django）和 `../ojnext/`（Vue SPA）。

> **旧栈已不可逆地下线**（`0002_drop_django_leftovers` 删掉了 Django 的框架表并已在生产库
> 执行完毕，漏网的一张空 `django_migrations` 由 `0014` 补删）。所以「停新栈起旧栈」已经
> 不是退路，**唯一退路是从数据库备份恢复**。
>
> **旧仓库仍然零改动**，没有例外 —— 包括修 bug、包括不影响外部接口的内部小修。
> 所有后续工作，包括在旧仓库里发现的 bug，都只落在 OJ2：先确认 OJ2 是否有对应逻辑、是否
> 重现了同样的问题，只在 OJ2 里修；旧仓库那边如实告知用户「未处理，按当前政策不动旧仓库」，
> 不要顺手改掉。冻结的理由现在只剩「留作参照、别分散精力」，不再是回滚保证。

细节文档（`CLAUDE.md` 只留日常要记住的，展开都在这几份里）：

| 文档 | 什么时候读 |
|---|---|
| `docs/deploy.md` | 部署、上线、备份恢复 |
| `docs/database.md` | 写迁移、给新库打基线、drizzle-kit 抽风 |
| `docs/timezone.md` | 动日历口径、动时间出参格式 |
| `docs/contract.md` | 动 zod 契约、想给某个字段加校验 |
| `docs/ast-rules.md` | 动 AST 代码规则、升级 tree-sitter |
| `docs/specs/` | 两份设计文档：后端重写、课堂求助与协作编辑 |

## 仓库结构

| 目录 | 作用 |
|---|---|
| `apps/api/` | 后端。Hono + Drizzle + BullMQ，编译成单二进制 |
| `apps/web/` | 前端。从 ojnext 原样搬来的 Vue 3 SPA |
| `packages/contract/` | 前后端共用的 Zod 契约 |
| `docker/` | Dockerfile + 三套 compose（dev / debian / school）+ 部署与运维脚本 |
| `docs/` | 上面那几份专题文档 + `specs/` 里的设计文档 |

## 本机环境

**Docker 可用，全套依赖都能在本机跑起来**（PostgreSQL、Redis、判题沙箱），
镜像也能在本机构建并完整演练上线。这一点和上一代不同，别沿用「本机跑不起来后端」的旧假设。

```bash
bun install
bun run db:up          # 起 postgres(5433) / redis(6380) / 判题沙箱(8081)
bun run db:migrate     # 空库会从 0000 自举出全部结构
bun run dev            # api(3000) + worker + web(5173) 一起起
```

首次要先建 `.env`（照 `.env.example`）。判题机 token 两边必须一致：
`.env` 的 `JUDGE_SERVER_TOKEN` 和 `docker/.env` 的 `OJ2_JUDGE_TOKEN`。

常用检查：

```bash
bun run --filter '@oj2/api' typecheck         # 后端类型检查
bun run --filter '@oj2/api' check:routes      # 路由遮蔽检查，加完路由跑一下
bun run --filter '@oj2/api' check:ast         # AST 节点类型检查，升级 tree-sitter 后跑
cd apps/web && bun run type-check             # 前端类型检查
cd apps/web && bun run build                  # 前端构建
```

⚠️ **前端类型检查只能走 `bun run type-check` 这个脚本。** 两条看起来等价的路子都会**静默
通过**：`vue-tsc --noEmit -p tsconfig.json` 检查 0 个文件（那个 tsconfig 是 `files: []` +
references 的壳，真正的配置在 `tsconfig.app.json`），而 `vite build` 根本不做类型检查。
改完 .vue / .ts 别拿构建当验证。

**不要写测试** —— 沿用上一代的项目约定。验证靠实跑：起服务、打接口、看结果。
本机 Docker 全套都能起，实跑的成本比想象中低。

## 几件必须知道的事

### 单二进制是有代价的

`apps/api` 编译成 `bun build --compile` 的单二进制，所以**运行时不能依赖 node_modules**。
任何 `require.resolve` / `Bun.resolveSync` / `__dirname` 去找文件的写法，本地都正常、编译后
都会炸，而且**只在离开仓库目录后才炸**（在仓库里跑时它顺着 cwd 摸到了 node_modules，
假装没事）。

资源要用 `with { type: "file" }` 内嵌。`.node` 原生模块还要额外注意：这个写法只有打包器认、
`bun run` 不认，所以必须按形态分叉 —— 见 `apps/api/src/vendor/jieba.ts` 的注释，
那里把坑写全了。

**改完这类代码，dev 和编译两种形态都要跑一遍。** 我吃过亏：只验了编译产物，dev 直接起不来。

### 路径解析看 `runtime.ts`

编译后 `import.meta.dir` 恒为 `/$bunfs/root`，往上三级就是文件系统根。
相对路径一律走 `runtime.ts` 的 `pathBase`，别自己拼。

### SQL 判题会 spawn「自己」

`judge/sql/index.ts` 起的子进程是二进制自身 + `sql-child` 子命令（因为编译后磁盘上没有
child.ts 可以 spawn）。所以**入口必须有 argv 分发**，否则「起自己」变成「把整个程序再跑
一遍」→ 指数级 fork。这不是假想，开发时炸过一次开发机。`OJ2_SQL_CHILD` 那道递归闸不要删。

### 加路由要防遮蔽

**Hono 按注册顺序匹配，不是静态优先**（实测确认过，别凭直觉）。`/problems/:id` 注册在
`/problems/random` 前面的话，后者永远进不去 —— 而且不报错、不警告，只是静默走进前一条的
handler。阶段 4 真实发生过一次，两个教师用的分析端点被吃掉，一直到评审才发现。

加完路由跑 `bun run --filter '@oj2/api' check:routes`。

### 判题状态码不能改

`apps/api/src/judge/status.ts` 和 `apps/web/src/utils/constants.ts` 必须一致。
这些整数是**落库的值**：12 万条历史提交的 `submission.result` 就是它们，判题沙箱回的也是
这套编码，所以只能新增、不能改已有的含义。题目表情 reaction 的语义 key 同理。

### 出参不 `parse`，用 `satisfies`

**后端的响应一律 `satisfies XxxType`，不要写 `xxxSchema.parse({...})`。** 出参是后端自己刚
拼出来的字面量，TS 已经在编译期校验过；再 parse 一遍拿不到任何新信息，唯一可能失败的输入是
**库里的历史数据**，而失败的代价是 500 —— 这条规矩是被四次这样的线上故障换来的。

**闸设在写入侧**：入参 `safeParse`（58 处）、`db/schema.ts` 的 `.$type<>()` 列收窄、
语义校验函数（`astRulesError()` / `exerciseDataError`）。JSONB 原文
（`submission.info` / `statistic_info` / `exercise.data`）一律放行，它们的形状真相在判题机
那边。query 的筛选值走 `routes/helpers.ts` 的 `asFilterValue()`，那是纯类型交接、不加校验。

四次故障的细节、`.$type<>()` 断言该怎么核，见 `docs/contract.md`；
前端为什么只在三处挂运行时闸门，见 `apps/web/CLAUDE.md`。

### AST 代码规则：一张表，外加一个机器检查

契约的 `AST_NODE_TARGETS_BY_LANGUAGE` 是**唯一**一张表（`label` 给界面、`node` 给判题机），
判题机侧没有第二张表，所以加 target 漏配节点类型在结构上不可能。但**配错**仍然可能，
而且完全静默 —— 节点类型对不上就是「必须使用 X」永远失败、「不能使用 X」永远通过。

```bash
bun run --filter '@oj2/api' check:ast     # 升级 tree-sitter-* 之后一定要跑
```

判题机只认 C / C++ / Python3（`AST_SUPPORTED_LANGUAGES`），别的语言配了规则一条都不会跑，
所以后台不给它们开 tab —— **看得见却不检查**比没有更糟。C++ 的调用形态和 C 不一样、
规则的语义校验为什么不挂在 zod 上，见 `docs/ast-rules.md`。

### 比赛只有 ACM 模式

没有 OI。上一代残留的 OI 分支在阶段 0 已经砍掉，不要「顺手补回来」。

### 前端基线是 Chrome 105（2026-09-16 从 < 94 上调）

机房**部分**电脑是 Chrome 105，其余更新 —— 按最低那档定基线。

- **`@vitejs/plugin-legacy` 留着，别删**：vite 8 的默认构建 target 是 `chrome111`，比 105 高。
  这个插件同时把 `build.target` 压到 `es2020/chrome105`、给现代产物补 core-js polyfill
  （`toSorted` / `Set` 运算 / 迭代器辅助那批是 Chrome 110+ 才有的）。`modernTargets` 不写，
  用插件自带的基线（`chrome>=105`），正好是这一档。polyfill 清单写死在 `vite.config.ts`，
  **升级前端依赖后重新审计**：`DEBUG=vite:legacy bun run build` 会打印探测到的全集。
- **Chrome < 94 那套删掉了**：`mermaid-legacy`（mermaid@9）、cytoscape 的 UMD→ESM 别名、
  `useMermaid.ts` 里按 UA 分叉的 v9 回调式 render —— 105 用得上 mermaid 11。
- **View Transitions 要 111，105 没有**，`darkTransition.ts` 的降级分支是真在用的。

### 时间只有一个锚点：`apps/api/src/time.ts`

**凡是要把一个时刻换算成「哪一天 / 几点 / 哪一年」，一律走那个模块。** 不要写
`new Date(x).getHours()`、`setHours(0,0,0,0)`、`getFullYear()`、`new Date(y, m, d)` 这类跟
**进程时区**走的代码 —— 容器是 UTC、开发机是本机时区，两边答案不同而且不报错。
SQL 里要按日历切，用 `localTime(列)`（生成 `列 at time zone 'Asia/Shanghai'`），
别依赖数据库会话时区。

**分层：存 UTC 时刻 → 后端判定按东八区 → 出参 ISO UTC → 前端按东八区渲染。**

- **存**：35 个时间列全是 `timestamptz`，写侧一律 `new Date().toISOString()`。
- **判定**：日历语义走 `time.ts`，SQL 用 `localTime()`。
- **出参**：`db/index.ts` 给 OID 1184 挂了 parser，读出来的时刻统一成 ISO 8601 UTC，
  **微秒必须保留**（截成毫秒会让翻页每页丢一条、班级 AC 排名少 1）。
- **渲染**：前端 `parseTime()` / `zonedParts()` 按同一个固定偏移取东八区部件
  （见 `apps/web/CLAUDE.md`）。

时区常量 `TIME_ZONE` / `TIME_ZONE_OFFSET_MINUTES` 在 `packages/contract/src/time.ts`，
前后端共用一份，按**固定偏移**算（大陆 1991 年起没有夏令时）。旧栈的口径本来就是东八区，
重写时丢过一次、2026-09 才收回来 —— 期间「今日提交」在北京时间 0:00–8:00 是空的，
两个小时口径的成就整体偏 8 小时，事后已用一次性脚本对账订正（账平了，脚本已删）。
**再动日历口径之前先读 `docs/timezone.md`**，那里有实测数据和核实方法；
Dockerfile 的 `TZ` 和数据库连接的 `TimeZone` 是**刻意不设**的，别「顺手补上」。

## 数据库

Drizzle schema 最初是 `drizzle-kit pull` 从生产库拉出来的，所以它长得像 Django 建的表
（表名、bigint/int4 混用），`schema.ts` 顶部记了哪些地方是手工修的。
**schema 现在归 OJ2 独占**，结构变更走 migration 正常演进。

**外键的删除动作从 0010 起是显式的**，不再是 Django 留下的一律 NO ACTION：

- **CASCADE**：父行消失后子行必然无意义、且不构成「学生做过什么」的证据 —— 中间表
  （problem_tags）、题单/教程/成就的组成部分、一对一附属（user_profile）与可重算的缓存
  （user_stat）。
- **NO ACTION（即拦住）**：需要人看见的删除 —— `submission.problem_id`、以及 `user` 的绝大
  多数外键。删用户撞外键会被 handler 翻译成「请改为禁用账号」，这是有意的。

**加新子表时必须回来想一遍该走哪一档**，别默认新外键会自己连坐 —— drizzle 不写
`.onDelete()` 就是 NO ACTION，而 0010 只改了当时存在的那批。

### 改 schema 走 drizzle migration

`bun run db:generate`（造迁移文件）→ `bun run db:migrate`（按
`drizzle.__drizzle_migrations` 增量执行），就是 Django `makemigrations` / `migrate` 的
等价物。索引/结构变更走这条，不要再手写 SQL 往 `docs/` 里塞。

- **执行器是自己的**（`db/migrate.ts`，一条迁移一个事务），不是 drizzle 那个，
  `db:migrate` 和线上 `oj2-api migrate` 是同一条代码路径。
- **部署时自动执行**：`docker/deploy.sh` 在构建镜像之后、起栈之前跑，失败就中止部署。
- 迁移文件**不内嵌进二进制**，随镜像装在 `/usr/local/share/oj2/migrations`
  （见 `runtime.ts` 的 `migrationsDir`），所以新增迁移不用改任何代码。
- **破坏性迁移默认拦截**（`DROP TABLE` / `DROP COLUMN` / `ALTER COLUMN ... TYPE` /
  `TRUNCATE`），退出 4，要显式放行：`OJ2_ALLOW_DESTRUCTIVE=1 docker/deploy.sh`。
- **空库能自举**，直接从 `0000` 建起，新环境不需要先灌 schema dump。

`CREATE INDEX CONCURRENTLY` 怎么写、给已有库打基线的 SQL、`.op()` 会吞掉索引方向这类
drizzle-kit 的坑，全在 `docs/database.md`。

## 部署

三套 compose 在 `docker/`：`dev`（本机）、`debian`（服务器）、`school`（机房）。

**机房那套没有 postgres，连的是服务器的库。** 两个站点共用一个数据库，但各有各的 Redis
和判题沙箱 —— 所以涉及两边的变更要一起做。

`compose.debian.yml` 靠 env 切形态：设 `DATA_DIR` / `DB_HOST` / `REDIS_HOST` 就是接现有的库
（线上就是这个），留空并加 `--profile local-data` 就是自带 postgres / redis。

⚠️ **`DATA_DIR` 默认值 `../data` 是 `OJ2/data`，不是部署目录的 `data/`。** 沿用旧数据却忘了
设它，会静默起一套空数据（空库、没测试点、图片 404），而且**不报错** —— 这是整个部署里
唯一会静默走歪的地方，`deploy.sh` 为它专门设了一道自检。

上线两条路（push 触发 CI / 手工 `docker/deploy.sh`）、部署后的验证清单、NPM 反代那两个
不能关的开关、备份恢复的两个坑，都在 `docs/deploy.md`。

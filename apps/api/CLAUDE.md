# CLAUDE.md

OJ2 的后端（`apps/api`）。这里只放后端专属的坑；全仓通用的约束（旧仓库冻结、判题状态码、
时间锚点、判题镜像、部署）在 `../../CLAUDE.md`。

## 单二进制是有代价的

`apps/api` 编译成 `bun build --compile` 的单二进制，所以**运行时不能依赖 node_modules**。
任何 `require.resolve` / `Bun.resolveSync` / `__dirname` 去找文件的写法，本地都正常、编译后
都会炸，而且**只在离开仓库目录后才炸**（在仓库里跑时它顺着 cwd 摸到了 node_modules，
假装没事）。

资源要用 `with { type: "file" }` 内嵌。`.node` 原生模块还要额外注意：这个写法只有打包器认、
`bun run` 不认，所以必须按形态分叉 —— 见 `src/vendor/jieba.ts` 的注释，那里把坑写全了。

**改完这类代码，dev 和编译两种形态都要跑一遍。** 我吃过亏：只验了编译产物，dev 直接起不来。

`build` 带 `--bytecode --format=esm`：每道 SQL 题都要起一次 `sql-child`，预编译字节码让它
从约 120ms 降到约 72ms（单核实测），`serve` 起服务从约 180ms 降到约 100ms，内存不变，
代价是二进制大 8MB。去掉 `--format=esm` 会退回 CJS 输出，顶层 await 编不过。

## 路径解析看 `runtime.ts`

编译后 `import.meta.dir` 恒为 `/$bunfs/root`，往上三级就是文件系统根。
相对路径一律走 `runtime.ts` 的 `pathBase`，别自己拼。

## SQL 判题会 spawn「自己」

`judge/sql/index.ts` 起的子进程是二进制自身 + `sql-child` 子命令（因为编译后磁盘上没有
child.ts 可以 spawn）。所以**入口必须有 argv 分发**，否则「起自己」变成「把整个程序再跑
一遍」→ 指数级 fork。这不是假想，开发时炸过一次开发机。`OJ2_SQL_CHILD` 那道递归闸不要删。

## 加路由要防遮蔽

**Hono 按注册顺序匹配，不是静态优先**（实测确认过，别凭直觉）。`/problems/:id` 注册在
`/problems/random` 前面的话，后者永远进不去 —— 而且不报错、不警告，只是静默走进前一条的
handler。阶段 4 真实发生过一次，两个教师用的分析端点被吃掉，一直到评审才发现。

加完路由跑 `bun run --filter '@oj2/api' check:routes`。

## 出参不 `parse`，用 `satisfies`

**后端的响应一律 `satisfies XxxType`，不要写 `xxxSchema.parse({...})`。** 出参是后端自己刚
拼出来的字面量，TS 已经在编译期校验过；再 parse 一遍拿不到任何新信息，唯一可能失败的输入是
**库里的历史数据**，而失败的代价是 500 —— 这条规矩是被四次这样的线上故障换来的。

**闸设在写入侧**：入参 `safeParse`、`db/schema.ts` 的 `.$type<>()` 列收窄、
语义校验函数（`astRulesError()` / `exerciseDataError`）。JSONB 原文
（`submission.info` / `statistic_info` / `exercise.data`）一律放行，它们的形状真相在判题机
那边。query 的筛选值走 `routes/helpers.ts` 的 `asFilterValue()`，那是纯类型交接、不加校验。

四次故障的细节、`.$type<>()` 断言该怎么核，见 `../../docs/contract.md`；
前端为什么只在三处挂运行时闸门，见 `../web/CLAUDE.md`。

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

- **部署时自动执行**：`docker/deploy.sh` 在构建镜像之后、起栈之前跑，失败就中止部署。
- **破坏性迁移默认拦截**（`DROP TABLE` / `DROP COLUMN` / `ALTER COLUMN ... TYPE` /
  `TRUNCATE`），退出 4，要显式放行：`OJ2_ALLOW_DESTRUCTIVE=1 docker/deploy.sh`。

`CREATE INDEX CONCURRENTLY` 怎么写、给已有库打基线的 SQL、`.op()` 会吞掉索引方向这类
drizzle-kit 的坑，全在 `../../docs/database.md`。

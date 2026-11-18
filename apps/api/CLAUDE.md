# CLAUDE.md

OJ2 的后端（`apps/api`）。这里只放后端专属的坑；全仓通用的约束（旧仓库冻结、判题状态码、
时间锚点、部署）在 `../../CLAUDE.md`；判题机与 AST 规则的细节在本文件末尾。

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
  （problem_tags）、专题/教程/成就的组成部分、一对一附属（user_profile）与可重算的缓存
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

## 判题机是 go-judge，判题流程在后端

`compose.*.yml` 里的 `oj2-judge-3` **不在任何 registry 上**：`docker/judge/` 把
[go-judge](https://github.com/criyle/go-judge) 的二进制和 gcc / python 装进一个镜像，本机构建。
go-judge 只管「在沙箱里跑一条命令」，**编译、逐个测试点运行、比对输出、定状态码都在
`apps/api/src/judge/sandbox.ts`**，口径逐条照搬了 2026-10 之前的 QingdaoU/JudgeServer
（输出 rstrip 后比 md5、stdout 和 stderr 合在一起比、地址空间限两倍内存、16MB 输出上限 …），
出参也还是它的形状 —— 12 万条历史提交的 `info` 就是这个形状。动那个文件前先读它顶部的注释。

- 构建、分发、改名的步骤见 `docker/judge/README.md`。**服务器和机房各有各的判题沙箱，两边都要装。**
- 判题机容器是 `privileged` 的（go-judge 要自己建 cgroup 和 namespace），别「顺手」改回 `read_only` + `cap_drop`。
- 判题机不再主动报心跳，后台「判题机列表」是 worker 每 5 秒去问一次记下的（`judge/heartbeat.ts`）。
- 编译/运行命令在 `apps/api/src/judge/languages.ts`，不在镜像里。gcc-14 把隐式函数
  声明等提成了 error（`-w` 压不住），那边的 `cLooseErrors` 几个 `-Wno-error=` 就是
  为此加的 —— 删掉它们等于让一批历史题解和 C 教程示例集体 CE。
- **判题沙箱只认 C / C++ / Python。** Java / JavaScript / Golang 连同镜像里的
  JDK / Node / Go 在 2026-09 一起砍了（前端本来就没给入口，12 万条提交里它们共 62 条），
  契约 `judgeLanguageSchema` 里的键留着是为了渲染那 62 条历史提交。
  **`Python3` / `Python2` 这两个旧值已经没有了** —— 0019 迁移把 104530 条提交、937 道题、
  1235 个用户的成就指标并成了一个 `Python`，0020 顺手把那三种语言从题目的可选语言里摘掉
  （不摘的话 84 道题的语言下拉还能选 Java，提交必 SYSTEM_ERROR）。代码里也不再认旧值（别名表 2026-10 删了），
  **回滚到 0019 之前要连数据一起回**，只滚代码会让 Python 提交全炸。
- 换完镜像跑 `bun docker/judge/smoke.ts`：三种语言、六种状态码、gcc 宽松度一起核。

## AST 代码规则：一张表，外加一个机器检查

契约的 `AST_NODE_TARGETS_BY_LANGUAGE` 是**唯一**一张表（`label` 给界面、`node` 给判题机），
判题机侧没有第二张表，所以加 target 漏配节点类型在结构上不可能。但**配错**仍然可能，
而且完全静默 —— 节点类型对不上就是「必须使用 X」永远失败、「不能使用 X」永远通过。

```bash
bun run --filter '@oj2/api' check:ast     # 升级 tree-sitter-* 之后一定要跑
```

判题机只认 C / C++ / Python（`AST_SUPPORTED_LANGUAGES`），别的语言配了规则一条都不会跑，
所以后台不给它们开 tab —— **看得见却不检查**比没有更糟。C++ 的调用形态和 C 不一样、
规则的语义校验为什么不挂在 zod 上，见 `docs/ast-rules.md`。

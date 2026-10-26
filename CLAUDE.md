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
| `docker/judge/README.md` | 换判题沙箱镜像、升语言版本（gcc / Python …） |
| `docs/specs/` | 三份设计文档：后端重写、课堂求助与协作编辑、题目详情页重设计（动题目页之前必读） |

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

**Bun 版本是锁死的**：单二进制把运行时一起打进去，CI 装的是几、线上跑的就是几。
升级要改三处 —— 根 `package.json` 的 `packageManager`（CI 的 setup-bun 读它）和
`@types/bun`、`docker/Dockerfile` 的 `oven/bun:x.y.z` —— 然后 `bun install`。
`bunfig.toml` 设了 `minimumReleaseAge = "3d"`，新发布不满 3 天的包装不上，`@types/bun` 除外。

常用检查：

```bash
bunx vp run verify                            # 下面这些一次跑完，带缓存（没改过的直接跳过）
bun run check                                 # 格式检查 + lint，不含类型检查
bun run fmt                                   # 格式化（bun fmt），全仓一把
bun run lint                                  # lint（Oxlint），有一条 warning 就算失败
bun run --filter '@oj2/api' typecheck         # 后端类型检查
bun run --filter '@oj2/api' check:routes      # 路由遮蔽检查，加完路由跑一下
bun run --filter '@oj2/api' check:ast         # AST 节点类型检查，升级 tree-sitter 后跑
cd apps/web && bun run type-check             # 前端类型检查
cd apps/web && bun run build                  # 前端构建（不在 verify 里）
```

**lint 和任务编排走 Vite+**（`vite-plus`，`vp` 命令），**格式化走 Bun 自带的 `bun fmt`**，
配置都只在根目录的 `vite.config.ts` 一份：`fmt` 块（Oxfmt 的写法，`bun fmt` 直接读它；
`semi: false`，行宽用默认的 100）、`lint` 块（Oxlint，`denyWarnings`）、`run.tasks`
（`verify` 和它依赖的四个检查）。**别用 `vp fmt` / `vp check`**：Oxfmt 和 `bun fmt` 只在
长 CSS 值列表的折行上不一样，混着跑会把 `apps/web/public/style.css` 来回改。前端自己的构建
配置在 `apps/web/vite.config.ts`，和根目录那份无关。

- 格式化只管代码：`.md` / `.yml` / `.json` / `.toml` 在 `fmt.ignorePatterns` 里排掉了
  （文档的中文表格、compose 的逐行注释是手排的），`src/db/meta/` 快照和 unplugin 的两个
  `.d.ts` 也排掉了。
- **`run.tasks` 里一律经 `bun run <脚本>` 调**，不直接写 `tsc`：任务定义在根包，PATH 是根目录
  的 `node_modules/.bin`，直接写拿到的是根目录的 TS 5.9 而不是 `apps/api` 的 TS 7。
- 任务名不能和根 `package.json` 的脚本重名（Vite+ 直接报错），所以 `verify` 没有对应的
  `bun run` 脚本，用 `bunx vp run verify`。
- 缓存在 `node_modules/.vite/task-cache`，按读到的文件内容做指纹；怀疑缓存不对时删掉它。
- **改完代码顺手跑一下 `bun run fmt`**。

⚠️ **前端类型检查只能走 `bun run type-check` 这个脚本。** 两条看起来等价的路子都会**静默
通过**：`vue-tsc --noEmit -p tsconfig.json` 检查 0 个文件（那个 tsconfig 是 `files: []` +
references 的壳，真正的配置在 `tsconfig.app.json`），而 `vite build` 根本不做类型检查。
改完 .vue / .ts 别拿构建当验证。

**不要写测试** —— 沿用上一代的项目约定。验证靠实跑：起服务、打接口、看结果。
本机 Docker 全套都能起，实跑的成本比想象中低。

## 提交

**直接在 `main` 上干活，不开特性分支。** 注意 push 到 `github` 这个 remote 的 `main`
会触发 CI 部署；而 `origin` 会镜像到 `github`，**平时 push `origin` 通常几秒后也就部署了**
（偶尔不跟，要 `git ls-remote github` 核实）。见 `docs/deploy.md`。

提交信息用中文，格式 `type(范围): 从用户视角描述现象`，例如
`fix(流程图): 「重新判题」从来没成功过，而且会把原来的评分清掉`。
常用 type：`fix` / `feat` / `refactor` / `perf` / `chore` / `style`。

## 几件必须知道的事

后端专属的坑 —— 单二进制不能依赖 node_modules、路径走 `runtime.ts`、SQL 判题 spawn 自己、
路由遮蔽、出参用 `satisfies` 不用 `parse`、外键删除动作与迁移 —— 在 **`apps/api/CLAUDE.md`**，
动 `apps/api` 的文件时会自动加载。下面是全仓通用的。

### 判题状态码不能改

`apps/api/src/judge/status.ts` 和 `apps/web/src/utils/constants.ts` 必须一致。
这些整数是**落库的值**：12 万条历史提交的 `submission.result` 就是它们，判题沙箱回的也是
这套编码，所以只能新增、不能改已有的含义。题目表情 reaction 的语义 key 同理。

### 判题镜像是自己构建的

`compose.*.yml` 里的 `oj2-judge-2` **不在任何 registry 上**：上游
QingdaoU/JudgeServer 停更在 2024-04（官方镜像的 `latest` 和 `1.6.1` 是同一份，
编译器停在 gcc-13），新工具链只能自己编。`docker/judge/` 里是只改版本的 Dockerfile
分叉 + 构建脚本 + 冒烟测试，判题逻辑一行没动。

- 构建、分发、改名的步骤见 `docker/judge/README.md`。**服务器和机房各有各的判题沙箱，两边都要装。**
- 编译/运行命令在 `apps/api/src/judge/languages.ts`，不在镜像里。gcc-14 把隐式函数
  声明等提成了 error（`-w` 压不住），那边的 `cLooseErrors` 几个 `-Wno-error=` 就是
  为此加的 —— 删掉它们等于让一批历史题解和 C 教程示例集体 CE。
- **判题沙箱只认 C / C++ / Python。** Java / JavaScript / Golang 连同镜像里的
  JDK / Node / Go 在 2026-09 一起砍了（前端本来就没给入口，12 万条提交里它们共 62 条），
  契约 `judgeLanguageSchema` 里的键留着是为了渲染那 62 条历史提交。
  **`Python3` / `Python2` 这两个旧值已经没有了** —— 0019 迁移把 104530 条提交、937 道题、
  1235 个用户的成就指标并成了一个 `Python`，0020 顺手把那三种语言从题目的可选语言里摘掉
  （不摘的话 84 道题的语言下拉还能选 Java，提交必 SYSTEM_ERROR）。查判题配置走
  `judgeConfigFor()`，它带旧值别名；**回滚要连数据一起回**，只滚代码会让 Python 提交全炸。
- 换完镜像跑 `bun docker/judge/smoke.ts`：三种语言、六种状态码、gcc 宽松度一起核。

### AST 代码规则：一张表，外加一个机器检查

契约的 `AST_NODE_TARGETS_BY_LANGUAGE` 是**唯一**一张表（`label` 给界面、`node` 给判题机），
判题机侧没有第二张表，所以加 target 漏配节点类型在结构上不可能。但**配错**仍然可能，
而且完全静默 —— 节点类型对不上就是「必须使用 X」永远失败、「不能使用 X」永远通过。

```bash
bun run --filter '@oj2/api' check:ast     # 升级 tree-sitter-* 之后一定要跑
```

判题机只认 C / C++ / Python（`AST_SUPPORTED_LANGUAGES`），别的语言配了规则一条都不会跑，
所以后台不给它们开 tab —— **看得见却不检查**比没有更糟。C++ 的调用形态和 C 不一样、
规则的语义校验为什么不挂在 zod 上，见 `docs/ast-rules.md`。

### 比赛只有 ACM 模式

没有 OI。上一代残留的 OI 分支在阶段 0 已经砍掉，不要「顺手补回来」。

### 前端基线是 Chrome 105

机房**部分**电脑是 Chrome 105，其余更新 —— 按最低那档定基线。
**`@vitejs/plugin-legacy` 和写死的 polyfill 清单别删**（vite 8 默认 target 是 `chrome111`）。
升级前端依赖后要重新审计 polyfill 清单，步骤与 View Transitions 的降级见 `apps/web/CLAUDE.md`。

### 时间只有一个锚点：`apps/api/src/time.ts`

**凡是要把一个时刻换算成「哪一天 / 几点 / 哪一年」，一律走那个模块。** 不要写
`new Date(x).getHours()`、`setHours(0,0,0,0)`、`getFullYear()`、`new Date(y, m, d)` 这类跟
**进程时区**走的代码 —— 容器是 UTC、开发机是本机时区，两边答案不同而且不报错。
SQL 里要按日历切，用 `localTime(列)`（生成 `列 at time zone 'Asia/Shanghai'`），
别依赖数据库会话时区。

**分层：存 UTC 时刻 → 后端判定按东八区 → 出参 ISO UTC → 前端按东八区渲染。**

- **存**：时间列全是 `timestamptz`，写侧一律 `new Date().toISOString()`。
- **判定**：日历语义走 `time.ts`，SQL 用 `localTime()`。
- **出参**：`db/index.ts` 给 OID 1184 挂了 parser，读出来的时刻统一成 ISO 8601 UTC，
  **微秒必须保留**（截成毫秒会让翻页每页丢一条、班级 AC 排名少 1）。
- **渲染**：前端 `parseTime()` / `zonedParts()` 按同一个固定偏移取东八区部件
  （见 `apps/web/CLAUDE.md`）。

时区常量 `TIME_ZONE` / `TIME_ZONE_OFFSET_MINUTES` 在 `packages/contract/src/time.ts`，
前后端共用一份，按**固定偏移**算（大陆 1991 年起没有夏令时），与旧栈的东八区口径一致。
**再动日历口径之前先读 `docs/timezone.md`**，那里有实测数据和核实方法；
Dockerfile 的 `TZ` 和数据库连接的 `TimeZone` 是**刻意不设**的，别「顺手补上」。

## 部署

三套 compose 在 `docker/`：`dev`（本机）、`debian`（服务器）、`school`（机房）。

**机房那套没有 postgres，连的是服务器的库。** 两个站点共用一个数据库，但各有各的 Redis
和判题沙箱 —— 所以涉及两边的变更要一起做。

库是 PostgreSQL 18，本机 dev 用同一个大版本，别单独换。迁移在部署时自动跑，**破坏性迁移
默认拦截**，要 `OJ2_ALLOW_DESTRUCTIVE=1 docker/deploy.sh` 显式放行。

⚠️ **`DATA_DIR` 默认值 `../data` 是 `OJ2/data`，不是部署目录的 `data/`。** 沿用旧数据却忘了
设它，会静默起一套空数据（空库、没测试点、图片 404），而且**不报错** —— 这是整个部署里
唯一会静默走歪的地方，`deploy.sh` 为它专门设了一道自检。

上线两条路（push 触发 CI / 手工 `docker/deploy.sh`）、部署后的验证清单、NPM 反代那两个
不能关的开关、备份恢复的两个坑，都在 `docs/deploy.md`。

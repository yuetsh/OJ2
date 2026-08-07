# OJ2 设计文档：后端重写为 Bun + TypeScript

日期：2026-08-06
状态：已确认，待实施

## 1. 背景与动机

现有平台由两个独立仓库组成：

| 仓库 | 角色 | 栈 | 规模 |
|---|---|---|---|
| `OnlineJudge/` | 后端 REST API + WebSocket | Django 6 + DRF + PostgreSQL + Redis + Dramatiq | 17k 行 Python，26 model，118 migration，127 端点 |
| `ojnext/` | 前端 SPA | Vue 3 + TypeScript + Vite + Naive UI + Pinia | 37k 行，217 文件 |

重写的驱动力有三条，均为交付性诉求，非兴趣驱动：

1. **前后端统一 TS 技术栈** —— 消除 Python/TS 上下文切换，让类型从数据库一路贯通到 Vue 组件。
2. **Django 太重** —— 运行时体积、冷启动、DRF serializer/view 样板代码。
3. **现有代码难维护** —— 20+ app 边界模糊，`utils/` 混杂，手写类型与后端 serializer 靠人脑同步。

## 2. 目标与非目标

### 目标

- 用 Bun + TypeScript 重建后端，承接现有 PostgreSQL 全部数据。
- 重新设计 API 契约，前端同步适配。
- 前后端与部署编排收进单一 monorepo。
- 借重写清理存量死代码。

### 非目标

- **不重写前端业务代码。** 37k 行 Vue 中只有约 1.7k 行（5%）触及网络层，其余页面、组件、路由、状态原样搬运。
- **不重写判题沙箱。** JudgeServer 是独立 Docker 服务，通过 HTTP 调用，镜像原样复用。
- **不做数据迁移。** 新后端直接接管现有库表结构。
- **不做新旧双跑。** 假期一次性停机切换。

## 3. 约束

| 约束 | 内容 |
|---|---|
| 数据 | 现有用户、题目、提交记录、成就必须完整延续 |
| 停机 | 可在假期安排一次停机切换，无需双写或灰度 |
| 契约 | API 重新设计，前端跟随修改 |
| 人力 | 单人开发，业余时间推进 |
| 目标环境 | 学校机房（低配）+ Debian 服务器 |

## 4. 存量盘点

重写前必须先做减法。已测得的数据：

| 项 | 数值 |
|---|---|
| 后端端点合计 | 127（`oj` 77 + `admin` 50） |
| 其中已由人工标注 `# DEPRECATED: 前端未调用` | 17 |
| 前端实际调用的路径 | 148 条 `method + path`／104 条不同路径 |
| **疑似无人调用** | **23 个，18%** |
| 空 app | `course/`、`comment/`（均 0 行） |
| 全站不用的分支 | OI 赛制（所有比赛均为 ACM） |
| Python 生态锁定 | 仅 2 处：`jieba`（`flowchart/views/admin.py` 单文件）、`tree-sitter`（`ast_checker/`，177 行） |

> 更正（2026-08-06 阶段 0 重跑后）：本表原写「端点合计 122（oj 74 / admin 48）、DEPRECATED 16、前端调用 78、疑似无人调用约 35%」，四项全错。前三项来自一版漏抓了 `tutorial/urls/tutorial.py` 与 `utils/urls.py` 的提取脚本（共漏 5 个端点，其中 4 个前端在用）与一版只数字面量、不含模板串的前端统计；「约 35%」是从 `(122−78)/122` 推出来的，两个输入都错。现表为 `docs/spikes/` 三个脚本重跑的实测值，独立核验：`cd OnlineJudge && cat */urls/*.py utils/urls.py | grep -c "path("` → 127。
> **减法空间只有 18%，不是三分之一。** 后续阶段按 18% 排期。

前端网络层集中度高，改动面小：

| 文件 | 规模 | 处置 |
|---|---|---|
| `src/oj/api.ts`、`src/admin/api.ts`、`src/shared/api.ts`、`src/oj/achievement/api.ts` | 1096 行 | 重写 |
| `src/utils/http.ts` | ~80 行 | 重写 |
| `src/utils/judge.ts` | ~40 行 | 重写 |
| `src/utils/types.ts` | 15.5K | **删除**，由 `packages/contract` 取代 |
| 3 个 `.vue` 内的直接调用 | 少量 | 收拢进 api 层 |

## 5. 仓库结构

新建 `OJ2/`，与现有两个仓库平级，为独立 git 仓库（主干 `main`）。

```
Projects/OJ/
├── OnlineJudge/          # 旧后端，冻结不动，切换稳定后归档
├── ojnext/               # 旧前端，冻结不动
└── OJ2/                  # 新 monorepo
    ├── apps/
    │   ├── api/          # Bun + Hono + Drizzle
    │   └── web/          # 由 ojnext 拷贝而来（不带 git 历史），仅替换 API 层
    ├── packages/
    │   └── contract/     # Zod schema，前后端唯一真相源
    ├── docker/
    │   ├── Dockerfile.api
    │   ├── Dockerfile.web
    │   ├── compose.dev.yml
    │   ├── compose.debian.yml
    │   ├── compose.school.yml
    │   └── caddy/
    ├── docs/
    │   ├── specs/
    │   └── spikes/
    ├── package.json      # Bun workspaces
    └── bunfig.toml
```

设计要点：

**`packages/contract` 是 monorepo 存在的唯一理由。** Zod schema 单点定义：后端 `.parse()` 做运行时校验，前端 `z.infer` 取类型。当前 `utils/types.ts` 的 15.5K 手写类型与后端 serializer 之间没有任何机器保障，是"难维护"的主要来源。没有这个包，monorepo 只是两个文件夹放在一起，不值得搞。

**只用 Bun workspaces。** 不引入 turbo / nx / pnpm。单人两 app 的规模下，额外编排层的维护成本高于收益，`bun run --filter` 足够。

**旧仓库全程不动。** 回滚成本等于改一行 Caddy 上游配置。切换后稳定运行一学期再归档。

## 6. 技术选型

| 层 | 选型 | 替代掉 |
|---|---|---|
| HTTP 框架 | **Hono** | Django + DRF |
| ORM | **Drizzle** | Django ORM |
| 契约 / 校验 | **Zod**（`packages/contract`） | DRF serializers + `utils/types.ts` |
| 任务队列 | **BullMQ** | Dramatiq |
| WebSocket | **Bun.serve 原生** + Redis pub/sub | Channels + channels-redis |
| 会话 | **Redis opaque token** | Django session |
| 密码 | pbkdf2 兼容验证 → argon2id 透明升级 | Django hashers |
| 中文分词 | `@node-rs/jieba` | jieba |
| AST 解析 | `web-tree-sitter`（WASM） | tree-sitter Python 绑定 |
| Excel 导出 | `exceljs` | xlsxwriter |
| 站点配置 | KV 表 + 内存缓存 | `SysOptions` metaclass |
| 错误上报 | `@sentry/bun` | sentry-sdk[django] |

### 两个非显然决策

**选 Hono 而非 Elysia。** Elysia 类型推导更强、benchmark 更快，但生态小且绑定 Bun。本项目负载为机房数十名学生，框架性能不构成瓶颈；Hono 的生态成熟度、`@hono/zod-validator`、以及可将类型直接传递给前端的 `hc` RPC 客户端更有价值。

**会话用 Redis opaque token 而非 JWT。** 理由是账号封禁需即时生效：`User.is_disabled` 一旦置位必须立刻踢人下线，JWT 做不到，得额外维护黑名单——那等于把 Redis 又加回来，白绕一圈。Redis 本就在架构内，直接用 opaque token 最省。

> 更正（2026-08-06 盘点时发现）：本条最初的理由写的是"现有 `account/views/oj.py:214` 实现了查看并踢出其他登录会话"。核实后该功能实际是死的——`/api/sessions` 前端从不调用，`User.session_keys` 字段只写不读（`account/middleware.py:30` 每请求追加，无人读取）。结论不变，理由已换成上面成立的那条。新后端不要复刻 `session_keys`。

## 7. 已验证的技术假设

三处高风险假设已在 Bun 1.3.11 上实测通过，spike 代码见 `docs/spikes/`。依赖清单与 lockfile 已随 spike 源码入库（`docs/spikes/package.json`、`bun.lock`），`cd docs/spikes && bun install` 后三个脚本均可直接重跑。

### 7.1 Django 密码哈希兼容（`docs/spikes/pbkdf2-spike.ts`）

用 Django 生成 `pbkdf2_sha256$1200000$...` 格式哈希，Bun 侧用 `node:crypto` 的 `pbkdf2` 验证：

```
正确密码 : true
错误密码 : false
单次耗时 : 95 ms  (1200000 轮迭代)
argon2id  : true 耗时 88 ms
```

**结论**：存量密码可直接沿用，学生无需重置。

**衍生约束**：95ms 的同步 pbkdf2 会阻塞事件循环。上课铃响时 40 人并发登录 = 3.8 秒 CPU 占满。因此：

1. 登录必须使用 `node:crypto` 的**异步** `pbkdf2`（走 libuv 线程池），不得使用 `pbkdf2Sync`。
2. 验证成功后立即将该用户哈希升级为 argon2id（`Bun.password`），一学期后存量自然清空。

### 7.2 tree-sitter 迁移（`docs/spikes/ast-spike.ts`）

复刻 `ast_checker/mappings/c.py` 的映射表，在 Bun 中用 `web-tree-sitter` 解析 C 代码：

```
解析耗时: 1.10 ms
  规则 for_loop             -> for_statement        命中 1
  规则 while_loop           -> while_statement      命中 0
  规则 function_definition  -> function_definition  命中 1
  规则 include              -> preproc_include      命中 1

Python 根节点: module | 首个子节点: for_statement
```

C 与 Python 两套 grammar 均正常。`.wasm` 文件随 npm 包分发（`tree-sitter-c` 611K / `tree-sitter-python` 447K），无需现场编译。

**澄清**：WASM 是编译产物格式，不是运行位置。AST 检查仍在服务端执行——现状是 `judge/dispatcher.py:189` 在判题流程中调用，新架构中由 BullMQ worker 在判题前调用，位置等价，学生代码不离开服务器。

**相对现状的改进**：

| | 现状（Python 绑定） | WASM |
|---|---|---|
| 安装 | 按平台编译 C 扩展 | `.wasm` 直接随包分发 |
| 跨架构 | x86 / arm64 各编一次 | 同一份文件通用 |
| Docker | 镜像需带编译链 | 拷贝即用 |

未选原生 NAPI 绑定：性能更高但需 node-gyp 现场编译，Bun 支持稳定性较差。1.1ms 解析耗时在判题流程中可忽略（沙箱启动本身即数十毫秒），选 WASM 图部署简单。

### 7.3 `@node-rs/jieba` 替代 Python jieba（`docs/spikes/jieba-spike.ts`）

对照 `flowchart/views/admin.py:65,191` 的两处用法——`jieba.add_word(w, freq=9999)` 加自定义词、`jieba.cut(text)` 切词——在 Bun 1.3.11 下验证 `@node-rs/jieba@2.0.1`（NAPI 绑定）：

```
默认切词: 输入 / 两个 / 整数 / 并 / 输出 / 它们 / 的 / 和
加词后  : 输入 / 两个整数 / 并 / 输出 / 它们 / 的 / 和
1000 次切词耗时: 2 ms
```

**结论**：通过。NAPI 二进制在 Bun 下正常加载，`cut` 结果符合预期，1000 次切词仅 2ms，性能远超需求（该功能是后台统计页的低频查询）。

**与 brief 预期的一个出入**：`@node-rs/jieba@2.0.1` 的公开 API 里没有 `insertWord`/`addWord` 方法，`.d.ts` 未导出对应接口。改用 `Jieba.loadDict(buffer)` 加载一份自定义词条缓冲区达到同等效果，格式与 Python jieba 用户词典一致（`"词 词频"` 按行排列）：

```typescript
jieba.loadDict(Buffer.from("两个整数 9999\n"))
```

**采用方案**：新后端用 `@node-rs/jieba`。

**衍生约束**：`loadDict` 语义已实测确认为**累加**（连续两次 `loadDict` 后先后加入的词都仍然成词），不是整份替换；但它每次调用都要重新解析并合并一遍词典，单条调用的固定开销远大于词条本身。实测 200 个自定义词：

```
逐条 loadDict : 39.4 ms
一次性 loadDict:  0.98 ms   （40 倍）
```

因此给后续阶段的实现者：

1. `CUSTOM_WORDS` 必须在**启动时**拼成一份完整的词典缓冲区，**一次性** `loadDict`，不得把 Python 那边的 `for w in CUSTOM_WORDS: jieba.add_word(w)` 逐词循环直译成逐条 `loadDict`。
2. 缓冲区格式与 Python jieba 用户词典一致：每行 `"词 词频"`，词频沿用现有的 `9999`。
3. 不要在请求路径上调 `loadDict`。词表变更走重建缓冲区 + 重启（或重建整个 `Jieba` 实例）。

## 8. 数据层策略

- 用 `drizzle-kit pull` 对现有 PostgreSQL 做 introspect，26 张表生成 TypeScript schema。
- **118 个 Django migration 的历史全部丢弃**，从当前 schema 快照重新开始迁移序列。
- 剪除 Django 框架自带表：`django_migrations`、`django_content_type`、`django_session`、`auth_permission` 等。
- 业务表结构保持不变，实现零数据迁移。

### 8.1 不要复刻的现有行为

盘点中发现的、明确不应带进新后端的实现：

- **`SessionRecordMiddleware`（`account/middleware.py:22-33`）**：每个已登录请求都写一遍 session（user_agent / ip / last_activity），遇到新 session key 还额外触发一次 `request.user.save()` —— 即每请求一次数据库写。这是"Django 太慢"的实际来源之一。新后端的会话信息留在 Redis，不落库。
- **`User.session_keys`**：只写不读的死字段，随 `/api/sessions` 端点一并砍掉。

## 9. 判题链路

现有链路：`submission` 写入 → Dramatiq 入队 → `judge/dispatcher.py` 调 JudgeServer → 结果写回 → Channels 推送前端。

新链路：`submission` 写入 → BullMQ 入队 → worker 调 JudgeServer（HTTP，沙箱不变）→ AST 检查（web-tree-sitter）→ 结果写回 → Bun 原生 WebSocket + Redis pub/sub 推送前端。

判题并发受沙箱数量限制，由 BullMQ 的 `concurrency` 配置控制。

## 10. 部署

- 判题沙箱镜像原样复用（`registry.cn-hongkong.aliyuncs.com/oj-image/judge:1.6.1`）。
- 丢弃 `OnlineJudge/deploy/requirements.txt`（48KB）及整套 Python 运行时。
- api 用 `bun build --compile` 产出单二进制，镜像体积从数百 MB 降至数十 MB —— 对机房低配机器收益明显。
- 三套 compose：`dev`（本地）、`debian`（服务器）、`school`（机房）。
- Caddy 作为反向代理，切换即改上游地址。

## 11. 分阶段路线

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| **0 减法与探路** | 对照 104 条前端实际调用路径筛查 127 个后端端点，砍掉无人调用者；删除 `course`/`comment` 空壳与 OI 分支；验证 `@node-rs/jieba` | 产出端点清单，REVIEW 归零、每个端点有 KEEP/CUT 裁决（机器初判：可砍 17 个，疑似无人调用 23 个 = 18%） |
| **1 骨架** | 建仓、Bun workspaces、`drizzle-kit pull` 拿 26 张表并剪除 `django_*`、拷贝 ojnext 进 `apps/web` | `bun dev` 可启动，能从真实库读出一道题 |
| **2 判题竖线**（关键） | 最小 auth + 读题 + 提交 → BullMQ → JudgeServer → Bun WS 推回前端；前端仅改对应几个 api 函数 | 一名学生能登录、看题、提交、看到实时判题结果 |
| **3 铺开** | 77 个 `oj` 端点逐个搬运，搬一个换一个前端 api 函数 | 用户侧全部功能运行在新后端上 |
| **4 后台** | 50 个 `admin` 端点，约占全程 40% 工作量 | 后台可用 |
| **5 切换演练** | `docker/` 三套 compose；单二进制镜像；用生产库快照完整演练 | 演练 30 分钟内完成，回滚路径已验证 |

**阶段顺序的理由**：

- 阶段 0 置于最前，因为砍掉的每一个端点都是不必翻译的代码，且零技术风险。现在不砍，就会被原样翻译一遍。
- 阶段 1 的 schema 先于一切，因为数据库是唯一不能重写的部分，它是全部下游设计的硬约束。
- **阶段 2 纵切而非横切。** 全部技术不确定性（Dramatiq→BullMQ、Channels→Bun WS、判题分发）集中在这一条链路上。打通之后，剩余 100+ 端点均为无惊喜的 CRUD，可断续推进。若按 app 横向切分，风险会分散到项目后期暴露。
- 契约（`packages/contract`）在阶段 1 建包、阶段 2 试用、阶段 3 铺开。不在最前定契约，因为契约须建立在存量盘点与真实 schema 之上，凭空设计必然返工。

## 12. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 阶段 2 技术链路打不通 | 唯一真风险，故置于最前，失败可及早止损 |
| 假期切换当天出问题 | 旧仓库与旧镜像全程保留，回滚 = 改一行 Caddy 上游 |
| admin 工作量拖长战线 | admin 不影响学生使用，可在切换后继续补，必要时切换初期临时保留旧后台 |
| 前后端须同时完工 | 由 `packages/contract` 解耦：契约先定，前端可对 mock 开发，两边不互相等待 |

## 13. 开放问题

- 具体哪些端点进入砍除清单，需在阶段 0 逐个核对后确定。
- `apps/web` 的 Naive UI / Pinia / Vue Router 版本是否随迁升级，待阶段 1 评估（memory 记录：机房 Chrome < 94，`mermaid-legacy` 等 fallback 依赖不可删）。

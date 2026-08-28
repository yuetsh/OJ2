# OJ2 设计文档：课堂求助与协作编辑

日期：2026-08-28
状态：已确认，待实施

## 1. 背景

现有的「协同编辑」功能从 ojnext 原样搬进 `apps/web`（commit `ae1fb32`，一行未改），
用 y-webrtc 做点对点同步，信令走仓库外的 `wss://signaling.xuyue.cc`。

涉及文件：

| 文件 | 职责 |
|---|---|
| `apps/web/src/shared/composables/sync.ts` | Y.Doc + WebrtcProvider + yCollab，房间权限状态机 |
| `apps/web/src/shared/components/SyncCodeEditor.vue` | CodeMirror 挂载点，`sync` prop 驱动启停 |
| `apps/web/src/oj/composables/syncStatus.ts` | provide/inject 的对端用户状态 |
| `apps/web/src/oj/problem/components/Form.vue` | 「开启同步 / 断开同步」按钮与状态标签 |
| `apps/web/src/oj/problem/components/ProblemEditor.vue` | 组装 |
| `apps/web/src/oj/problem/components/ContestEditor.vue` | 仅为避免 inject 抛错而空 provide |

后端对此功能零参与。

### 1.1 为什么要重做

本功能的实际用途是**课堂辅导**：学生做题卡住，老师进入他的编辑器一起改。
按这个用途重新审视，现有实现有四个结构性问题：

**a. 老师无法指定帮谁。** 房间名是 `problem-${problemId}`（sync.ts:272），
不含用户身份。一个班几十人做同一道题时，老师点「开启同步」进的是「第 N 题房间」，
和谁连上取决于谁先在房间里。这不是缺陷，是这个功能**没有实现「帮谁」这个概念**。

**b. 谁的代码保留是随机的。** `setupContentSync`（sync.ts:230-249）两端完全对称：
各自等 500ms，谁先发现 `ytext` 为空谁就把自己的内容插进去。老师接入可能覆盖学生
正在写的代码；两端同时超时还会把两份代码拼在一起。

**c. 权限判定是客户端自报，且拦不住。** `isSuperAdmin` 写在 awareness 里
（sync.ts:344），任何人都能在 devtools 里改。而且判定分支只覆盖
`roomUsers === 2 && !hasSuperAdmin`（sync.ts:180）—— 三人及以上落进 else 分支，
提示「正在等待超管加入」但 yCollab 扩展不会被摘掉，三个人一直在同步编辑。
即使判定命中，它也发生在扩展挂载、文档交换**之后**。

**d. 外部依赖无处可管。** `signaling.xuyue.cc` 在 `docker/` 下没有任何部署源
（compose、Caddyfile、deploy.sh 均无），仓库里查不到它怎么起、怎么重启。
`.env.production` 之外的三个环境都指向内网 IP `10.13.114.114:8085`。
另外 WebrtcProvider 未配置任何 ICE/TURN（sync.ts:274-278），跨 NAT 场景
只能依赖 simple-peer 默认的 Google STUN。

根因是同一件事：**服务端不知道谁是谁**，所以身份、权限、房间归属只能由客户端
自行声明，于是 sync.ts 里写了两百行自报身份 + 人数猜测的状态机，既不可靠也无约束力。

## 2. 目标与非目标

### 目标

- 学生可以就某道题发起求助；老师能看到求助列表并进入协作。
- 房间归属与权限由**服务端**判定，不再依赖客户端自报。
- 协作起点确定为**学生的代码**，不存在覆盖与竞态。
- 传输改走后端已有的 WebSocket 层，去掉 y-webrtc 与外部信令服务器。

### 非目标

- **不做「老师主动连线」**：老师不能在学生未求助时进入其编辑器。若将来要做，
  需要额外的在线学生列表与学生端知情提示，属另一个设计。
- **不做「老师演示给全班看」**：1 对 N 广播是另一套模型，本次不涉及。
- **不落库**：求助请求只在内存，不新增表、不动 drizzle 迁移。
- **不改判题、提交、比赛任何流程。**
- 比赛模式仍然不提供本功能（沿用 `Form.vue` 的 `isContestMode` 判断，并在服务端
  一并拒绝比赛题的求助）。

## 3. 交互流程

```
学生                          服务端                        老师
 │                              │                            │
 ├── help_request{problemId} ──►│                            │
 │                              ├── requests{list} ─────────►│  顶栏红点 +1
 │◄── help_status{pending, ─────┤                            │
 │      queueAhead:2}           │                            │
 │                              │◄── accept{studentId} ──────┤  点击某条
 │◄── room_open{peer} ──────────┼── room_open{peer} ────────►│  弹出协作模态框
 │                              │                            │
 │◄═══ Yjs 二进制帧（服务端按房间转发，不解析）═══════════════►│
 │                              │                            │
 │◄── room_closed{done} ────────┼◄── leave ──────────────────┤  老师关闭模态框
```

### 3.1 多人同时求助

老师端是一个**排队列表**，不是弹窗。顶栏红点显示待处理数量，点开是列表。

- **按等待时长排序，但不强制先来先到。** 老师点谁就是谁 —— 上课时有的问题一句话
  说清、有的要讲五分钟，强制 FIFO 只会碍事。
- **同题聚合**：同一道题有多人求助时，列表按题目分组显示（`第5题 冒泡排序 · 3人`），
  展开是该题下的学生。这本身是个教学信号：一道题堆了好几个人，说明该停下来全班讲，
  而不是挨个救。
- **老师一次只进一个房间。** 其余请求继续排队，不受影响。
- **多老师在线时**，请求被接走后在其他老师列表里变灰并标注「李老师处理中」，不会撞车。

### 3.2 学生端状态

学生必须随时看到自己的处境，否则会反复点：

| 状态 | 学生看到 |
|---|---|
| `pending` | 「已求助，前面还有 N 人」 |
| `active` | 「X 老师正在帮你」 |
| `no_teacher` | 「当前没有老师在线」（点击求助时立即告知，不让他干等） |
| `cancelled` | 「老师已取消你的求助」，可重新求助 |

`queueAhead` = 比自己早创建、且仍为 `pending` 的请求数。`cancelled` 与 `no_teacher`
是推给学生的**瞬时通知**，不是服务端存储的状态 —— 请求在服务端只有 `pending` 与
`active` 两态，取消即从表中移除。

### 3.3 老师取消请求

老师可在列表里对某条点 **× 取消**，请求直接消失，不建立连线，学生收到
`cancelled` 提示。适用于：学生举手后自己想明白了没撤销、老师已当面讲过、乱点。

这与「帮完了」是两回事 —— 帮完是老师退出房间（`leave`），请求一并清除。

## 4. 服务端设计

### 4.1 复用现有 WebSocket 基建

后端只有一个 serve 进程（`main.ts` 单二进制 + 子命令；`docker/compose.debian.yml`
里 `oj-api` 一个容器，`oj-worker` 不跑 HTTP），因此**内存态房间可行，不需要
Redis 同步**。进程重启丢掉全部房间，两端重连后回到干净状态。

新增通道 `/ws/collab`，沿用现有结构：

- `apps/api/src/index.ts:103` 的 upgrade 分支加一条路径，握手时校验 origin 与会话，
  把 `userId` / `token` 放进 `ws.data`。
- `SubmissionSocketData.kind` 增加 `"collab"`（该字段的存在理由就是「同一个
  `Bun.serve` 只能挂一个 websocket handler，用它区分通道」）。
- 会话中途失效踢人（`sweepSessions`）、`touchSession` 复验、账号禁用检查全部白拿。

新增目录 `apps/api/src/collab/`：

| 文件 | 职责 |
|---|---|
| `state.ts` | 内存状态：求助表、房间表、在线老师集合 |
| `handler.ts` | collab 通道的消息处理与广播 |

### 4.2 限流必须分档（关键坑）

现有令牌桶是 20 突发 / 每秒 2 个（`websocket.ts:69-81`），且 `allowMessage` 在
消息类型判断**之前**就拦截，超额直接 `ws.close(1008, "Too many messages")`。

协作编辑时每敲一个字就是一条 Yjs 帧，几秒钟就会把连接踢掉。

**方案**：collab 通道分两档 ——
- **二进制帧**（Yjs 数据）走宽松档。它不查库、不解析，纯内存转发，成本极低。
- **文本控制帧**（`help_request` / `accept` 等）沿用严格档。它们会查库。

起始阈值：二进制帧 200 突发 / 每秒 100 个（连续快速输入约 5-10 帧/秒，余量十倍以上），
文本帧沿用 20 / 2。实测再调。

### 4.3 消息协议

控制面是文本 JSON，数据面是二进制帧（Yjs update / awareness，服务端不解析）。

**客户端 → 服务端**

| 消息 | 发送方 | 说明 |
|---|---|---|
| `{type:"help_request", problemId}` | 学生 | 发起求助 |
| `{type:"help_cancel"}` | 学生 | 撤销自己的求助 |
| `{type:"accept", studentId}` | 老师 | 接单 |
| `{type:"reject", studentId}` | 老师 | 取消某条请求 |
| `{type:"leave"}` | 双方 | 退出房间 |
| `{type:"ping"}` | 双方 | 沿用现有心跳，不查库 |
| 二进制帧 | 房间内双方 | 转发给房间里的另一个人 |

**服务端 → 客户端**

| 消息 | 接收方 | 说明 |
|---|---|---|
| `{type:"requests", list}` | 所有在线老师 | 全量列表（表很小，不做增量） |
| `{type:"help_status", status, queueAhead?, teacherName?}` | 发起求助的学生 | 见 3.2 |
| `{type:"room_open", peer:{name, role}, problemId}` | 房间内双方 | 建立协作 |
| `{type:"room_closed", reason}` | 房间内双方 | `done`（老师主动结束）/ `peer_offline`（对方断线） |
| `{type:"pong", timestamp}` | 双方 | 心跳应答 |
| 二进制帧 | 房间内另一方 | 转发 |

### 4.4 权限

- `accept` / `reject` 由服务端查库校验发送者是 `isTeacherOrAbove`，**不读客户端
  声明的任何身份字段**。注意用真实身份判定，不受前端演示模式影响
  （`user.ts:43` 的 `isSuperAdmin` 含 `!demoMode`，那是纯 UI 概念，服务端不认）。
- 二进制帧只转发给**同一房间的另一个成员**，不做任何广播。
- 比赛题的 `help_request` 服务端直接拒绝。
- 一个学生同时只有一个求助；一个老师同时只在一个房间。

### 4.5 内存状态

```
requests: Map<studentId, {
  studentId, username, className, problemId, problemTitle,
  createdAt, status: "pending" | "active", teacherId?
}>

rooms: Map<studentId, { studentSocket, teacherSocket, problemId }>

teacherSockets: Set<socket>   // 在线老师，用于推 requests 与判断 no_teacher
```

房间以**学生**为键 —— 学生是房间的归属者，这与「学生的代码是内容源」是同一件事。

## 5. 前端设计

### 5.1 新增

| 文件 | 职责 |
|---|---|
| `shared/store/collab.ts` | pinia store：持有 WS 连接、求助列表（老师）、自身求助状态（学生）、当前房间 |
| `shared/components/HelpRequestList.vue` | 顶栏红点 + 下拉列表，含同题聚合 |
| `shared/components/CollabModal.vue` | 老师端协作模态框 |
| `shared/composables/collab.ts` | Y.Doc 与 yCollab 绑定，取代 `sync.ts` |

### 5.2 改动

| 文件 | 改动 |
|---|---|
| `App.vue` | 登录后挂载全局 collab 连接（照 `useConfigUpdate()` 的写法） |
| `Header.vue` | 嵌入 `HelpRequestList`，仅老师及以上可见 |
| `Form.vue` | 「开启同步 / 断开同步」按钮改为「求助 / 取消求助」。可见条件沿用现有 `showSyncFeature` 的三条（桌面端、已登录、非流程图、非比赛），再加上「非教师角色」 |
| `SyncCodeEditor.vue` | 改为消费新的 collab composable |
| `ProblemEditor.vue` | 去掉 syncStatus 的 provide/inject，改读 store |

### 5.3 删除

- `shared/composables/sync.ts`
- `oj/composables/syncStatus.ts`
- `ContestEditor.vue` 里为避免 inject 抛错而写的空 `provideSyncStatus()`
- `y-webrtc` 依赖（`apps/web/package.json`）
- `PUBLIC_SIGNALING_URL`：`.env` / `.env.production` / `.env.staging` / `.env.test`
  / `env.d.ts` / `apps/web/CLAUDE.md` 环境变量表

保留 `yjs` 与 `y-codemirror.next` —— CRDT 与光标显示继续用它们。

### 5.4 老师在模态框里编辑，不跳转页面

老师接单后弹出一个大模态框，内含协作编辑器，标题显示学生名、题号与题面链接。

理由：顶栏是全局的，老师接单时可能正在后台改题或看统计，跳转会丢掉他的上下文；
且老师自己题目页里的代码不会被搅乱。

## 6. 内容源规则（硬性）

学生点「求助」时**不做任何事** —— 不清空编辑器、不建 Y.Doc、不连房间。
只有老师接单、`room_open` 到达之后才：

1. **学生端**：以当前编辑器内容建 Y.Doc 并插入，挂 yCollab。
2. **老师端**：建空 Y.Doc 挂 yCollab，等学生端同步过来。
3. **老师端永远不插入初始内容。**

第 3 条是硬规则，不是默认值。它根治了 1.1(b)。

房间关闭时两端摘掉 yCollab 扩展，**学生编辑器保留当前内容** —— 老师帮改的代码留在
学生那里，这是期望行为。学生端照常写 localStorage。

## 7. 边界与失败处理

| 情况 | 处理 |
|---|---|
| 老师断线 | 房间立即销毁，请求退回 `pending` 重新排队，学生不必重新点（可能只是网络抖动）；学生端摘掉 yCollab，编辑器保留当前内容 |
| 学生断线 / 关页面 | 房间销毁、请求清除，老师端收到 `peer_offline` |
| API 重启 | 内存全清；两端 WS 重连后回到干净状态，学生需重新求助 |
| 没有老师在线 | 学生点求助时当场返回 `no_teacher` |
| 老师尝试进已被接走的请求 | 服务端拒绝，返回最新列表 |
| 会话失效 / 账号禁用 | 沿用现有 `sweepSessions` 与 `touchSession` 路径断连 |

## 8. 验证

项目约定不写测试，验证靠实跑。

`bun run dev` 起 api + worker + web，开两个浏览器 profile（一个学生账号、一个教师
账号），走完整流程：

1. 学生求助 → 老师顶栏出现红点与列表项
2. 多个学生求助 → 排序、同题聚合、等待时长显示正确
3. 老师接单 → 双方进入房间，学生代码出现在老师模态框，两端互相看得到光标
4. 双向编辑 → 内容一致，无覆盖
5. 老师退出 → 学生编辑器保留改后的代码
6. 老师取消某条请求 → 该学生收到提示
7. 断线场景：学生关页面、老师关页面、重启 api
8. 无老师在线时求助 → 学生立即收到提示
9. 比赛题不出现求助按钮，且直接构造 `help_request` 被服务端拒绝

## 9. 遗留与后续

- 求助不落库，因此没有「谁经常卡住、卡在哪道题」的历史统计。若将来需要教学反馈，
  再加表不迟，本次刻意不做。
- 「老师主动连线」与「老师演示给全班看」见 2. 非目标，各自需要独立设计。
- `apps/web/CLAUDE.md` 整份仍是 ojnext 时代的内容（npm 命令、指向 `../OnlineJudge`
  的 Django 后端），其中「Yjs + y-webrtc for collaborative editing **in the flowchart
  editor**」一句本就是错的（协作在代码编辑器，流程图被显式排除）。本次至少要把
  实时特性与环境变量两节改对，整份文档的翻新另计。

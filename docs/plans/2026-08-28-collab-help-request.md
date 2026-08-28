# 课堂求助与协作编辑 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学生就某道题发起求助，老师从全局列表接单并进入该学生的编辑器协作改代码；传输从 y-webrtc P2P 换成后端 WebSocket 通道，房间归属与权限由服务端判定。

**Architecture:** 新增 `/ws/collab` 通道，登录即连、全局常驻。服务端在内存里维护求助表与房间表，只按房间转发 Yjs 二进制帧、不解析代码内容。房间以**学生**为键 —— 学生是房间归属者，这与「学生的代码是内容源」是同一件事。CRDT 与光标仍用 yjs + y-codemirror.next，只是把 y-webrtc 这层传输换掉。

**Tech Stack:** 后端 Bun + Hono + Drizzle（`ws.data.kind` 区分通道，Bun 原生 pub/sub）；前端 Vue 3 + Pinia + Naive UI + CodeMirror 6 + yjs / y-codemirror.next。

**Spec:** `docs/specs/2026-08-28-collab-help-request-design.md`

## Global Constraints

- **不写测试。** 项目约定（`CLAUDE.md`）：验证靠实跑。每个任务的收尾是本文写明的手动验证步骤，不是测试用例。
- **不新增数据库表、不写 drizzle 迁移。** 求助请求只在内存。
- **单二进制约束**：`apps/api` 用 `bun build --compile` 打包，运行时不能依赖 `node_modules` 里的文件路径解析（`require.resolve` / `__dirname` / `Bun.resolveSync`）。新增代码只用普通 import。
- **前端要兼容 Chrome < 94**（机房电脑）。不要引入新的语法/API 依赖，不动 vite 的构建 target。
- **服务端角色常量**：`TEACHER_ROLES = ["Teacher Admin", "Super Admin"]`（`apps/api/src/routes/helpers.ts:74`）。服务端判角色一律读库里的 `adminType`，**不认前端的演示模式**（`demoMode` 是纯 UI 概念）。
- **老师端永远不插入初始内容** —— 见 Task 7，这是硬规则不是默认值。
- **直接在 `main` 上提交**，不开特性分支。
- 提交信息用中文，与仓库现有风格一致。

---

## 文件结构

**后端新增**

| 文件 | 职责 |
|---|---|
| `apps/api/src/collab/state.ts` | 内存状态：求助表、房间表、在线老师集合。纯数据结构与查询，不碰 socket |
| `apps/api/src/collab/handler.ts` | collab 通道的消息处理、鉴权、广播、二进制转发 |

**后端修改**

| 文件 | 改动 |
|---|---|
| `apps/api/src/websocket.ts` | `SubmissionSocketData` 加 collab 所需字段；`kind` 加 `"collab"`；限流分档；open/close/message 分派到 collab handler |
| `apps/api/src/index.ts` | upgrade 分支加 `/ws/collab` |

**前端新增**

| 文件 | 职责 |
|---|---|
| `apps/web/src/shared/store/collab.ts` | pinia store：WS 连接、求助列表（老师）、自身求助状态（学生）、当前房间。全局单例 |
| `apps/web/src/shared/composables/collabDoc.ts` | Y.Doc + yCollab 绑定，把 Yjs 帧接到 collab store 的 WS 上 |
| `apps/web/src/shared/components/HelpRequestList.vue` | 顶栏红点 + 下拉列表，含同题聚合 |
| `apps/web/src/shared/components/CollabModal.vue` | 老师端协作模态框 |

**前端修改**

| 文件 | 改动 |
|---|---|
| `apps/web/src/shared/composables/websocket.ts` | `BaseWebSocket` 支持二进制收发 |
| `apps/web/src/App.vue` | 挂载全局 collab 连接 |
| `apps/web/src/shared/components/Header.vue` | 嵌入 `HelpRequestList` |
| `apps/web/src/oj/problem/components/Form.vue` | 「开启同步」→「求助 / 取消求助」 |
| `apps/web/src/oj/problem/components/ProblemEditor.vue` | 去掉 syncStatus provide/inject，改读 store |
| `apps/web/src/shared/components/SyncCodeEditor.vue` | 改用 collabDoc |
| `apps/web/src/oj/problem/components/ContestEditor.vue` | 删掉空的 `provideSyncStatus()` |

**前端删除**：`shared/composables/sync.ts`、`oj/composables/syncStatus.ts`

两点说明：

- spec 里这个 composable 叫 `shared/composables/collab.ts`，本计划改名为 `collabDoc.ts`
  —— 与 `shared/store/collab.ts` 同名会让 import 路径极易看混。功能不变。
- 前端配了 `unplugin-auto-import`（`vite.config.ts:101`），**vue / vue-router / pinia
  的 API 全部自动导入**。新文件里不要写 `import { ref, computed, watch } from "vue"`
  或 `import { defineStore } from "pinia"`，现有的 store 与组件都没写。

---
## Task 1: BaseWebSocket 支持二进制帧

现有客户端 `onmessage` 无条件 `JSON.parse(event.data)`（websocket.ts:158），`send()` 无条件
`JSON.stringify`（websocket.ts:325）—— 收到 Yjs 二进制帧会直接落进 catch 打一条「解析消息失败」。
先给基类开口子，后面的 collab 客户端才能复用它的重连、心跳、`force_logout` 处理。

**Files:**
- Modify: `apps/web/src/shared/composables/websocket.ts`

**Interfaces:**
- Consumes: 无
- Produces: `BaseWebSocket` 新增 `protected onBinary(data: ArrayBuffer): void`（默认空实现，子类覆盖）与 `sendRaw(data: ArrayBuffer | Uint8Array): boolean`

- [ ] **Step 1: 连接时声明二进制格式**

在 `connect()` 里 `new WebSocket(this.url)` 之后、绑定事件之前加一行。找到创建 socket 的那句，
紧跟着加：

```ts
ws.binaryType = "arraybuffer"
```

不加的话浏览器默认给 `Blob`，读取要走异步 `.arrayBuffer()`，Yjs 的消息顺序会乱。

- [ ] **Step 2: onmessage 里把二进制岔开**

把 websocket.ts:155 的 `ws.onmessage` 改成先判类型。原来的整段 JSON 逻辑保持不动，只在最前面插入：

```ts
      ws.onmessage = (event) => {
        if (ws !== this.ws) return

        // Yjs 这类二进制帧不是 JSON，交给子类。基类的 pong / force_logout 都是文本帧，
        // 不会走到这条路径上
        if (typeof event.data !== "string") {
          this.onBinary(event.data as ArrayBuffer)
          return
        }

        try {
          const data = JSON.parse(event.data) as T
          // ...以下原样保留...
```

- [ ] **Step 3: 加 onBinary 钩子与 sendRaw**

在 `send(data: any)`（websocket.ts:325）旁边加两个成员：

```ts
  /**
   * 二进制帧钩子。基类不认二进制，默认丢弃；collab 这类通道在子类里覆盖。
   * 和 onMessage 对称，不要在这里做 JSON 解析。
   */
  protected onBinary(_data: ArrayBuffer) {}

  /**
   * 不做 JSON 序列化的发送。Yjs 的 update / awareness 本身就是 Uint8Array，
   * 走 send() 会被 JSON.stringify 成一个 {"0":12,"1":3,...} 的对象。
   */
  sendRaw(data: ArrayBuffer | Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data)
      return true
    }
    return false
  }
```

- [ ] **Step 4: 验证没有回归**

```bash
bun run dev
```

浏览器打开 `http://localhost:5173`，登录后：
1. 打开 devtools Network → WS，确认 `/ws/config` 与 `/ws/submissions` 照常连上、心跳 pong 正常
2. 提交一份代码，确认判题状态照常实时刷新（走 `/ws/submissions`）
3. Console 里不应出现 `[WebSocket] 解析消息失败`

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/shared/composables/websocket.ts
git commit -m "feat(web): BaseWebSocket 支持二进制帧收发

onmessage 原来无条件 JSON.parse，收到 Yjs 二进制帧会落进 catch。
加 onBinary 钩子与 sendRaw，让 collab 通道能复用基类的重连与心跳。"
```

---

## Task 2: 后端 collab 通道 —— 求助表与控制面

只做控制面：学生发起/撤销求助，老师收到列表。房间与二进制转发在 Task 3。

**Files:**
- Create: `apps/api/src/collab/state.ts`
- Create: `apps/api/src/collab/handler.ts`
- Modify: `apps/api/src/websocket.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `SubmissionSocketData`（websocket.ts:52）、`TEACHER_ROLES`（routes/helpers.ts:74）、`touchSession`（auth/session.ts:161）
- Produces:
  - `state.ts`: `HelpRequest`、`CollabSocket` 类型；`addRequest`、`removeRequest`、`getRequest`、`listRequests`、`queueAheadOf`、`addTeacher`、`removeTeacher`、`hasTeacherOnline`、`teacherSockets`
  - `handler.ts`: `handleCollabOpen(ws)`、`handleCollabClose(ws)`、`handleCollabMessage(ws, raw)`、`handleCollabBinary(ws, data)`（Task 3 才填实现）、`broadcastRequests()`

- [ ] **Step 1: 写 state.ts**

Create `apps/api/src/collab/state.ts`:

```ts
/**
 * 课堂求助的内存状态。
 *
 * 不落库是有意的：求助是课堂上的即时行为，学生关掉页面这条请求就该消失。
 * 服务端只有一个 serve 进程（main.ts 单二进制 + 子命令，compose 里 oj-api 一个容器），
 * 所以内存态够用，不需要 Redis 同步。进程重启丢掉全部状态，两端重连后回到干净状态。
 */

export type CollabSocket = Bun.ServerWebSocket<import("../websocket").SubmissionSocketData>

export interface HelpRequest {
  studentId: number
  studentName: string
  className: string | null
  /** 题目的展示号（problem._id 列，前端一路用的都是它），不是自增主键 */
  problemId: string
  problemTitle: string
  createdAt: number
  status: "pending" | "active"
  teacherId?: number
  teacherName?: string
  socket: CollabSocket
}

/** 求助表，以学生为键 —— 一个学生同时只有一个求助 */
const requests = new Map<number, HelpRequest>()

/** 在线老师的连接。用于推列表，也用于判断 no_teacher */
const teachers = new Set<CollabSocket>()

export function addRequest(request: HelpRequest) {
  requests.set(request.studentId, request)
}

export function getRequest(studentId: number) {
  return requests.get(studentId)
}

export function removeRequest(studentId: number) {
  return requests.delete(studentId)
}

export function hasRequest(studentId: number) {
  return requests.has(studentId)
}

/** 按发起时间正序。老师端按等待时长排序展示，不强制先来先到 */
export function listRequests() {
  return Array.from(requests.values()).sort((a, b) => a.createdAt - b.createdAt)
}

/** 比自己早创建、且仍在排队的请求数 */
export function queueAheadOf(studentId: number) {
  const self = requests.get(studentId)
  if (!self) return 0
  let ahead = 0
  for (const request of requests.values()) {
    if (request.status === "pending" && request.createdAt < self.createdAt) ahead += 1
  }
  return ahead
}

export function addTeacher(ws: CollabSocket) {
  teachers.add(ws)
}

export function removeTeacher(ws: CollabSocket) {
  teachers.delete(ws)
}

export function hasTeacherOnline() {
  return teachers.size > 0
}

export function teacherSockets() {
  return teachers
}

/** 仅供进程退出或测试用，正常路径不该调 */
export function resetCollabState() {
  requests.clear()
  teachers.clear()
}
```

- [ ] **Step 2: 扩展 SubmissionSocketData**

Modify `apps/api/src/websocket.ts:52`，给接口加三个字段（`kind` 加一个取值）：

```ts
export interface SubmissionSocketData {
  userId: number
  /** 同一个 Bun.serve 只能挂一个 websocket handler，用它区分通道 */
  kind: "submissions" | "config" | "collab"
  /** 握手时那张会话的 token，留着定期确认它还没被登出 / 过期，见 sweepSessions */
  token: string
  /** 令牌桶，open 时初始化，见 allowMessage */
  rate?: { tokens: number; updatedAt: number }
  /** 以下两项只有 kind === "collab" 时才填，握手时从会话里读 */
  username?: string
  adminType?: string
  /** 当前所在协作房间的房主（学生）id，见 collab/handler.ts */
  roomOwnerId?: number
}
```

- [ ] **Step 3: 限流分档**

collab 的二进制帧是每敲一个字一条，现有的 20 突发 / 每秒 2 个（websocket.ts:69-70）几秒就会
`ws.close(1008)` 把人踢掉。在 `RATE_REFILL_PER_SECOND` 下面加一组常量：

```ts
/**
 * collab 通道的二进制帧（Yjs update / awareness）单独一档。
 *
 * 它不查库、不解析，纯内存按房间转发，成本和文本控制帧完全不是一个量级；
 * 而连续快速输入大约 5-10 帧/秒，用严格档几秒钟就会把正在协作的人踢下线。
 */
const COLLAB_BINARY_BURST = 200
const COLLAB_BINARY_REFILL_PER_SECOND = 100
```

把 `allowMessage` 改成接受档位参数：

```ts
function allowMessage(
  ws: Bun.ServerWebSocket<SubmissionSocketData>,
  burst = RATE_BURST,
  refillPerSecond = RATE_REFILL_PER_SECOND,
) {
  const now = Date.now()
  const rate = (ws.data.rate ??= { tokens: burst, updatedAt: now })
  const refill = ((now - rate.updatedAt) / 1000) * refillPerSecond
  rate.tokens = Math.min(burst, rate.tokens + refill)
  rate.updatedAt = now
  if (rate.tokens < 1) return false
  rate.tokens -= 1
  return true
}
```

注意：令牌桶是**每条连接一个**，而 collab 连接上文本帧很稀疏（求助、接单各一条），
所以两档共用同一个桶不会互相饿死 —— 二进制帧把桶按宽松档填，文本帧按严格档取，
实际效果是 collab 连接整体走宽松档。这是可以接受的：这条连接上的文本帧同样不查库
（`accept` 会查，但它一次会话只发一次）。

- [ ] **Step 4: 在 handler 里分派 collab**

Modify `apps/api/src/websocket.ts` 的 `submissionWebSocketHandler()`。在 `open`、`message`、
`close` 三处加 collab 分支（放在各自函数最前面，collab 不订阅 submission/config 的 topic）：

```ts
    open(ws) {
      liveSockets.add(ws)
      ws.data.rate = { tokens: RATE_BURST, updatedAt: Date.now() }
      if (ws.data.kind === "collab") {
        handleCollabOpen(ws)
        return
      }
      if (ws.data.kind === "config") {
        ws.subscribe(configTopic)
        return
      }
      ws.subscribe(userSubmissionTopic(ws.data.userId))
      ws.subscribe(userEventTopic(ws.data.userId))
    },
    message(ws, message) {
      if (ws.data.kind === "collab") {
        if (typeof message !== "string") {
          if (!allowMessage(ws, COLLAB_BINARY_BURST, COLLAB_BINARY_REFILL_PER_SECOND)) {
            ws.close(1008, "Too many messages")
            return
          }
          handleCollabBinary(ws, message)
          return
        }
        if (!allowMessage(ws)) {
          ws.close(1008, "Too many messages")
          return
        }
        handleCollabMessage(ws, message).catch((error) => {
          console.error("Failed to handle collab message", error)
          ws.send(JSON.stringify({ type: "error", message: "Internal error" }))
        })
        return
      }
      // ...以下原有逻辑原样保留...
    },
    close(ws) {
      liveSockets.delete(ws)
      if (ws.data.kind === "collab") {
        handleCollabClose(ws)
        return
      }
      // ...以下原有逻辑原样保留...
    },
```

文件顶部加 import：

```ts
import {
  handleCollabBinary,
  handleCollabClose,
  handleCollabMessage,
  handleCollabOpen,
} from "./collab/handler"
```

- [ ] **Step 5: 写 handler.ts 的控制面**

Create `apps/api/src/collab/handler.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm"

import { touchSession } from "../auth/session"
import { db, schema } from "../db"
import {
  addRequest,
  addTeacher,
  getRequest,
  hasTeacherOnline,
  listRequests,
  queueAheadOf,
  removeRequest,
  removeTeacher,
  teacherSockets,
  type CollabSocket,
  type HelpRequest,
} from "./state"

const TEACHER_ROLES = ["Teacher Admin", "Super Admin"]

function isTeacher(ws: CollabSocket) {
  return TEACHER_ROLES.includes(ws.data.adminType ?? "")
}

/** 推给老师的列表条目。不含 socket，也不含任何代码内容 */
function serializeRequest(request: HelpRequest) {
  return {
    studentId: request.studentId,
    studentName: request.studentName,
    className: request.className,
    problemId: request.problemId,
    problemTitle: request.problemTitle,
    createdAt: request.createdAt,
    status: request.status,
    teacherName: request.teacherName ?? null,
  }
}

export function broadcastRequests() {
  const payload = JSON.stringify({
    type: "requests",
    list: listRequests().map(serializeRequest),
  })
  for (const ws of teacherSockets()) ws.send(payload)
}

function sendHelpStatus(
  ws: CollabSocket,
  status: "pending" | "active" | "cancelled" | "no_teacher",
  extra: Record<string, unknown> = {},
) {
  ws.send(JSON.stringify({ type: "help_status", status, ...extra }))
}

export function handleCollabOpen(ws: CollabSocket) {
  if (isTeacher(ws)) {
    addTeacher(ws)
    // 新上线的老师要立刻看到当前队列，不能等下一次变更
    ws.send(
      JSON.stringify({ type: "requests", list: listRequests().map(serializeRequest) }),
    )
  }
}

export function handleCollabClose(ws: CollabSocket) {
  if (isTeacher(ws)) removeTeacher(ws)
  // 房间与请求的清理在 Task 3 补
}

export async function handleCollabMessage(ws: CollabSocket, raw: string) {
  let message: { type?: unknown; problemId?: unknown; studentId?: unknown }
  try {
    message = JSON.parse(raw) as typeof message
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
    return
  }

  // 心跳不查库，和 /ws/submissions 的处理一致
  if (message.type === "ping") {
    ws.send(JSON.stringify({ type: "pong", timestamp: (message as any).timestamp }))
    return
  }

  // 握手时校验过一次不算数 —— 这条连接能挂几个小时
  if (!(await touchSession(ws.data.token))) {
    ws.close(1008, "Session expired")
    return
  }

  switch (message.type) {
    case "help_request":
      await handleHelpRequest(ws, message.problemId)
      return
    case "help_cancel":
      handleHelpCancel(ws)
      return
    default:
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }))
  }
}

async function handleHelpRequest(ws: CollabSocket, problemId: unknown) {
  if (typeof problemId !== "string" || !problemId) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid problemId" }))
    return
  }
  if (isTeacher(ws)) {
    ws.send(JSON.stringify({ type: "error", message: "教师不能发起求助" }))
    return
  }
  if (!hasTeacherOnline()) {
    sendHelpStatus(ws, "no_teacher")
    return
  }

  // 只认非比赛题：contest_id 为空的那条。比赛题不提供求助
  const [problem] = await db
    .select({ title: schema.problem.title })
    .from(schema.problem)
    .where(
      and(
        eq(schema.problem.displayId, problemId),
        isNull(schema.problem.contestId),
      ),
    )
    .limit(1)
  if (!problem) {
    ws.send(JSON.stringify({ type: "error", message: "题目不存在或不支持求助" }))
    return
  }

  const existing = getRequest(ws.data.userId)
  // 已经在协作中就不重复登记，否则会把正在进行的房间挤掉
  if (existing?.status === "active") return

  addRequest({
    studentId: ws.data.userId,
    studentName: ws.data.username ?? "",
    className: null,
    problemId,
    problemTitle: problem.title,
    createdAt: Date.now(),
    status: "pending",
    socket: ws,
  })
  sendHelpStatus(ws, "pending", { queueAhead: queueAheadOf(ws.data.userId) })
  broadcastRequests()
}

function handleHelpCancel(ws: CollabSocket) {
  const request = getRequest(ws.data.userId)
  if (!request || request.status === "active") return
  removeRequest(ws.data.userId)
  broadcastRequests()
}
```

`className` 先填 `null`：它在 `user` 表上（schema.ts:663），握手时一并读出来更省事，
下一步就补。

- [ ] **Step 6: 握手时带上 username / adminType / className**

`getRequestSessionUser`（auth/session.ts:142）返回的 user 已含 `adminType`（session.ts:106）。
Modify `apps/api/src/index.ts:103` 那段 upgrade 分支：

```ts
		if (
			url.pathname === "/ws/submissions" ||
			url.pathname === "/ws/config" ||
			url.pathname === "/ws/collab"
		) {
			if (!isAllowedWebSocketOrigin(request.headers.get("origin"), url)) {
				return new Response("Forbidden", { status: 403 })
			}
			const user = await getRequestSessionUser(request)
			if (!user) return new Response("Unauthorized", { status: 401 })
			const kind =
				url.pathname === "/ws/config"
					? "config"
					: url.pathname === "/ws/collab"
						? "collab"
						: "submissions"
			if (
				bunServer.upgrade(request, {
					data: {
						userId: user.id,
						kind,
						token: readRequestSessionToken(request),
						username: user.username,
						adminType: user.adminType,
					},
				})
			) {
				return undefined
			}
			return new Response("WebSocket upgrade failed", { status: 400 })
		}
```

`className` 不在会话里，在 `handleHelpRequest` 里和题目一起查出来。把上一步 state 写入
改成：

```ts
  const [student] = await db
    .select({ className: schema.user.className })
    .from(schema.user)
    .where(eq(schema.user.id, ws.data.userId))
    .limit(1)

  addRequest({
    studentId: ws.data.userId,
    studentName: ws.data.username ?? "",
    className: student?.className ?? null,
    // ...其余不变
  })
```

- [ ] **Step 7: 验证控制面**

```bash
cd /home/xuyue/Projects/OJ/OJ2 && bun run dev
```

开两个浏览器 profile。**A 用教师账号登录，B 用学生账号登录**（`.env` 里的
`OJ2_DEV_USERNAME=student`）。两边 devtools Console 各跑：

```js
const ws = new WebSocket(`ws://localhost:5173/ws/collab`)
ws.onmessage = (e) => console.log("recv", e.data)
```

然后：
1. **A（教师）**连上后应立刻收到一条 `{"type":"requests","list":[]}`
2. **B（学生）**发 `ws.send(JSON.stringify({type:"help_request",problemId:"1"}))`
   （`problemId` 换成一道真实存在的非比赛题的展示号）
   - B 收到 `{"type":"help_status","status":"pending","queueAhead":0}`
   - A 收到 `requests`，list 里有一条，含 `studentName`、`problemTitle`、`className`
3. **B** 发 `{"type":"help_cancel"}` → A 收到空 list
4. **B** 发 `{"type":"help_request",problemId:"不存在的号"}` → 收到 `题目不存在或不支持求助`
5. **A（教师）**发 `help_request` → 收到 `教师不能发起求助`
6. 关掉 A 的连接，B 再发 `help_request` → 收到 `{"status":"no_teacher"}`
7. B 连着不动 60 秒以上，确认没有被限流踢掉（`allowMessage` 改动没写坏严格档）

- [ ] **Step 8: 提交**

```bash
git add apps/api/src/collab apps/api/src/websocket.ts apps/api/src/index.ts
git commit -m "feat(api): 新增 /ws/collab 通道与课堂求助控制面

学生发起/撤销求助，在线教师收到全量列表。求助只在内存，不落库。
二进制帧的限流单独一档，避免协作输入把连接踢掉。"
```

---
## Task 3: 后端房间与二进制转发

**Files:**
- Modify: `apps/api/src/collab/state.ts`
- Modify: `apps/api/src/collab/handler.ts`

**Interfaces:**
- Consumes: Task 2 的全部导出
- Produces:
  - `state.ts`: `Room` 类型；`openRoom`、`getRoom`、`closeRoom`、`roomOf`
  - `handler.ts`: `handleCollabBinary` 的实现；`accept` / `reject` / `leave` 三个消息的处理

- [ ] **Step 1: state.ts 加房间表**

在 `apps/api/src/collab/state.ts` 末尾（`resetCollabState` 之前）加：

```ts
export interface Room {
  /** 房主 = 学生。房间以学生为键，因为学生的代码是内容源 */
  studentId: number
  teacherId: number
  studentSocket: CollabSocket
  teacherSocket: CollabSocket
  problemId: string
}

const rooms = new Map<number, Room>()

export function openRoom(room: Room) {
  rooms.set(room.studentId, room)
}

export function getRoom(studentId: number) {
  return rooms.get(studentId)
}

export function closeRoom(studentId: number) {
  return rooms.delete(studentId)
}

/** 这条连接当前所在的房间。ws.data.roomOwnerId 是房主（学生）的 id */
export function roomOf(ws: CollabSocket) {
  const ownerId = ws.data.roomOwnerId
  return ownerId === undefined ? undefined : rooms.get(ownerId)
}
```

把 `resetCollabState` 补上 `rooms.clear()`。

- [ ] **Step 2: handler.ts 加 accept / reject / leave**

在 `handleCollabMessage` 的 switch 里补三个分支：

```ts
    case "accept":
      await handleAccept(ws, message.studentId)
      return
    case "reject":
      handleReject(ws, message.studentId)
      return
    case "leave":
      handleLeave(ws)
      return
```

然后加这四个函数：

```ts
async function handleAccept(ws: CollabSocket, studentId: unknown) {
  if (!isTeacher(ws)) {
    ws.send(JSON.stringify({ type: "error", message: "无权限" }))
    return
  }
  if (typeof studentId !== "number") {
    ws.send(JSON.stringify({ type: "error", message: "Invalid studentId" }))
    return
  }

  // 握手时的 adminType 是那一刻的快照，接单前按库里的真实身份复核一次。
  // 注意读的是库，不是前端传的任何东西 —— 前端的演示模式在这里没有意义
  const [teacher] = await db
    .select({ adminType: schema.user.adminType })
    .from(schema.user)
    .where(and(eq(schema.user.id, ws.data.userId), eq(schema.user.isDisabled, false)))
    .limit(1)
  if (!teacher || !TEACHER_ROLES.includes(teacher.adminType)) {
    ws.close(1008, "Permission revoked")
    return
  }

  // 老师同时只能在一个房间
  if (roomOf(ws)) {
    ws.send(JSON.stringify({ type: "error", message: "请先退出当前协作" }))
    return
  }

  const request = getRequest(studentId)
  if (!request || request.status === "active") {
    // 被别人接走了或者学生已经撤销 —— 回一份最新列表让老师端自己纠正
    ws.send(
      JSON.stringify({ type: "requests", list: listRequests().map(serializeRequest) }),
    )
    return
  }

  request.status = "active"
  request.teacherId = ws.data.userId
  request.teacherName = ws.data.username ?? ""

  ws.data.roomOwnerId = studentId
  request.socket.data.roomOwnerId = studentId
  openRoom({
    studentId,
    teacherId: ws.data.userId,
    studentSocket: request.socket,
    teacherSocket: ws,
    problemId: request.problemId,
  })

  const openFrame = (peerName: string, peerRole: "student" | "teacher") =>
    JSON.stringify({
      type: "room_open",
      peer: { name: peerName, role: peerRole },
      problemId: request.problemId,
    })
  request.socket.send(openFrame(request.teacherName, "teacher"))
  ws.send(openFrame(request.studentName, "student"))
  sendHelpStatus(request.socket, "active", { teacherName: request.teacherName })
  broadcastRequests()
}

function handleReject(ws: CollabSocket, studentId: unknown) {
  if (!isTeacher(ws) || typeof studentId !== "number") return
  const request = getRequest(studentId)
  // 已经在协作中的不能靠 reject 掐掉，那是 leave 的事
  if (!request || request.status === "active") return
  removeRequest(studentId)
  sendHelpStatus(request.socket, "cancelled")
  broadcastRequests()
}

/** 主动退出房间。老师点关闭、学生点结束都走这里 */
function handleLeave(ws: CollabSocket) {
  const room = roomOf(ws)
  if (!room) return
  teardownRoom(room, "done")
}

/**
 * 拆房间。reason 决定两端看到什么：
 *   done         —— 有人主动结束，双方都收到，请求一并清除
 *   peer_offline —— 有人断线，见 handleCollabClose
 */
function teardownRoom(room: Room, reason: "done" | "peer_offline") {
  closeRoom(room.studentId)
  room.studentSocket.data.roomOwnerId = undefined
  room.teacherSocket.data.roomOwnerId = undefined
  const frame = JSON.stringify({ type: "room_closed", reason })
  room.studentSocket.send(frame)
  room.teacherSocket.send(frame)
  if (reason === "done") removeRequest(room.studentId)
  broadcastRequests()
}
```

`state.ts` 的新导出要加进顶部 import：`openRoom`、`closeRoom`、`roomOf`、`type Room`。
（`getRoom` 本任务用不到，别顺手加进去。）

- [ ] **Step 3: 断线处理**

把 Task 2 里那个占位的 `handleCollabClose` 换成完整实现：

```ts
export function handleCollabClose(ws: CollabSocket) {
  if (isTeacher(ws)) removeTeacher(ws)

  const room = roomOf(ws)
  if (room) {
    closeRoom(room.studentId)
    room.studentSocket.data.roomOwnerId = undefined
    room.teacherSocket.data.roomOwnerId = undefined
    const peer = ws === room.teacherSocket ? room.studentSocket : room.teacherSocket
    peer.send(JSON.stringify({ type: "room_closed", reason: "peer_offline" }))

    if (ws === room.teacherSocket) {
      // 老师掉线：请求退回排队，学生不必重新点 —— 可能只是网络抖了一下
      const request = getRequest(room.studentId)
      if (request) {
        request.status = "pending"
        request.teacherId = undefined
        request.teacherName = undefined
        sendHelpStatus(request.socket, "pending", {
          queueAhead: queueAheadOf(room.studentId),
        })
      }
    } else {
      // 学生掉线：请求随人走
      removeRequest(room.studentId)
    }
  } else if (!isTeacher(ws)) {
    // 还在排队时关掉页面，请求也该消失
    removeRequest(ws.data.userId)
  }

  broadcastRequests()
}
```

- [ ] **Step 4: 二进制转发**

```ts
/**
 * Yjs 的 update / awareness 帧。服务端不解析、不留存，只转发给房间里的另一个人。
 *
 * 「服务端不知道代码内容」是有意的：这个通道要做的事只有认证和分房间，
 * 权限由 accept 时的库查询决定，与帧里装的是什么无关。
 */
export function handleCollabBinary(ws: CollabSocket, data: Buffer | Uint8Array) {
  const room = roomOf(ws)
  if (!room) return
  const peer = ws === room.teacherSocket ? room.studentSocket : room.teacherSocket
  peer.send(data)
}
```

- [ ] **Step 5: 验证房间与转发**

`bun run dev`，仍用两个 profile 的 Console（教师 A / 学生 B）：

```js
const ws = new WebSocket(`ws://localhost:5173/ws/collab`)
ws.binaryType = "arraybuffer"
ws.onmessage = (e) =>
  console.log("recv", typeof e.data === "string" ? e.data : new Uint8Array(e.data))
```

1. B 发 `help_request` → A 收到列表
2. A 发 `{"type":"accept","studentId":<B的用户id>}`
   - 双方各收到一条 `room_open`，`peer.name` 分别是对方的用户名
   - B 另收到 `{"type":"help_status","status":"active","teacherName":"..."}`
   - A 再收到 `requests`，那条的 `status` 变成 `active`
3. A 发二进制：`ws.send(new Uint8Array([1,2,3]))` → **B** 收到 `Uint8Array(3) [1,2,3]`；反向同样
4. A 再发一次 `accept`（换个学生）→ 收到 `请先退出当前协作`
5. A 发 `{"type":"leave"}` → 双方收到 `{"reason":"done"}`，A 的列表变空
6. 重新 accept 后**关掉 A 的标签页** → B 收到 `{"reason":"peer_offline"}`，
   再开一个教师连接，列表里那条应回到 `pending`
7. 重新 accept 后**关掉 B 的标签页** → A 收到 `peer_offline`，且列表里那条消失
8. 未在房间里时发二进制 → 无任何转发、不报错
9. 用学生账号发 `{"type":"accept","studentId":1}` → 收到 `无权限`
10. 连续快速发 100 条二进制帧，确认连接没被 1008 踢掉（限流宽松档生效）

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/collab
git commit -m "feat(api): collab 房间管理与 Yjs 帧转发

accept 时按库里的 adminType 复核身份，房间以学生为键。
服务端只按房间转发二进制帧，不解析内容。
老师掉线请求退回排队，学生掉线请求随人清除。"
```

---
## Task 4: 前端 collab store 与 WS 客户端

**Files:**
- Modify: `apps/web/src/shared/composables/websocket.ts`（加 `CollabWebSocket` 类）
- Create: `apps/web/src/shared/store/collab.ts`
- Modify: `apps/web/src/App.vue`

**Interfaces:**
- Consumes: Task 1 的 `onBinary` / `sendRaw`；Task 2、3 的服务端协议
- Produces: `useCollabStore()`，导出
  `connect()`、`disconnect()`、`requestHelp(problemId: string)`、`cancelHelp()`、
  `accept(studentId: number)`、`reject(studentId: number)`、`leave()`、
  `sendBinary(data: Uint8Array)`、`setBinaryHandler(fn: ((data: ArrayBuffer) => void) | null)`，
  以及只读状态 `requests`、`helpStatus`、`queueAhead`、`teacherName`、`room`

- [ ] **Step 1: 加 CollabWebSocket 类**

在 `apps/web/src/shared/composables/websocket.ts` 末尾（`useConfigWebSocket` 之后）加：

```ts
export interface CollabRequestItem {
  studentId: number
  studentName: string
  className: string | null
  problemId: string
  problemTitle: string
  createdAt: number
  status: "pending" | "active"
  teacherName: string | null
}

export interface CollabMessage extends WebSocketMessage {
  type:
    | "requests"
    | "help_status"
    | "room_open"
    | "room_closed"
    | "error"
}

/**
 * 课堂求助 / 协作通道。和另外两条的区别是它**双向**且**收发二进制** ——
 * 控制面是 JSON，Yjs 的 update / awareness 走 sendRaw 与 onBinary。
 */
export class CollabWebSocket extends BaseWebSocket<CollabMessage> {
  private binaryHandler: ((data: ArrayBuffer) => void) | null = null

  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    super({ url: `${protocol}//${window.location.host}/ws/collab` })
  }

  setBinaryHandler(handler: ((data: ArrayBuffer) => void) | null) {
    this.binaryHandler = handler
  }

  protected override onBinary(data: ArrayBuffer) {
    this.binaryHandler?.(data)
  }
}
```

- [ ] **Step 2: 写 store**

Create `apps/web/src/shared/store/collab.ts`:

```ts
import {
  CollabWebSocket,
  type CollabMessage,
  type CollabRequestItem,
} from "shared/composables/websocket"
import { useUserStore } from "shared/store/user"

export type HelpStatus = "idle" | "pending" | "active"

export interface RoomInfo {
  peerName: string
  peerRole: "student" | "teacher"
  problemId: string
}

/**
 * 课堂求助的全局状态。
 *
 * 连接是**全局常驻**的，不跟着题目页起落 —— 老师可能正在后台改题时收到求助，
 * 学生也需要在等待期间一直挂着。所以这里不用 onUnmounted，由 App.vue 按登录态开关。
 */
export const useCollabStore = defineStore("collab", () => {
  const userStore = useUserStore()

  const ws = new CollabWebSocket()

  /** 老师端：待处理列表 */
  const requests = ref<CollabRequestItem[]>([])
  /** 学生端：自己的求助状态 */
  const helpStatus = ref<HelpStatus>("idle")
  const queueAhead = ref(0)
  const teacherName = ref("")
  /** 双方：当前房间。null 表示不在协作中 */
  const room = ref<RoomInfo | null>(null)
  /** 一次性提示，由组件消费后清空 */
  const notice = ref("")

  const pendingCount = computed(
    () => requests.value.filter((it) => it.status === "pending").length,
  )

  /** 按题目聚合，同题多人时老师能一眼看出该停下来全班讲 */
  const groupedRequests = computed(() => {
    const groups = new Map<string, { problemId: string; problemTitle: string; items: CollabRequestItem[] }>()
    for (const item of requests.value) {
      const group = groups.get(item.problemId)
      if (group) group.items.push(item)
      else
        groups.set(item.problemId, {
          problemId: item.problemId,
          problemTitle: item.problemTitle,
          items: [item],
        })
    }
    // 人多的题排前面；人数相同按最久等待排
    return Array.from(groups.values()).sort(
      (a, b) =>
        b.items.length - a.items.length ||
        a.items[0].createdAt - b.items[0].createdAt,
    )
  })

  const handleMessage = (data: CollabMessage) => {
    switch (data.type) {
      case "requests":
        requests.value = (data.list ?? []) as CollabRequestItem[]
        return
      case "help_status":
        if (data.status === "pending") {
          helpStatus.value = "pending"
          queueAhead.value = Number(data.queueAhead ?? 0)
        } else if (data.status === "active") {
          helpStatus.value = "active"
          teacherName.value = String(data.teacherName ?? "")
        } else if (data.status === "cancelled") {
          helpStatus.value = "idle"
          notice.value = "老师已取消你的求助"
        } else if (data.status === "no_teacher") {
          helpStatus.value = "idle"
          notice.value = "当前没有老师在线"
        }
        return
      case "room_open":
        room.value = {
          peerName: String(data.peer?.name ?? ""),
          peerRole: data.peer?.role === "teacher" ? "teacher" : "student",
          problemId: String(data.problemId ?? ""),
        }
        return
      case "room_closed":
        room.value = null
        // 老师掉线时服务端会另发一条 help_status:pending，这里不抢着改学生状态
        if (data.reason === "done") helpStatus.value = "idle"
        notice.value =
          data.reason === "peer_offline" ? "对方已断开连接" : "协作已结束"
        return
      case "error":
        notice.value = String(data.message ?? "")
        return
    }
  }

  ws.addHandler(handleMessage)

  function connect() {
    ws.connect()
  }

  function disconnect() {
    ws.disconnect()
    requests.value = []
    helpStatus.value = "idle"
    room.value = null
  }

  function requestHelp(problemId: string) {
    ws.send({ type: "help_request", problemId })
  }

  function cancelHelp() {
    ws.send({ type: "help_cancel" })
    helpStatus.value = "idle"
  }

  function accept(studentId: number) {
    ws.send({ type: "accept", studentId })
  }

  function reject(studentId: number) {
    ws.send({ type: "reject", studentId })
  }

  function leave() {
    ws.send({ type: "leave" })
  }

  function sendBinary(data: Uint8Array) {
    ws.sendRaw(data)
  }

  function setBinaryHandler(handler: ((data: ArrayBuffer) => void) | null) {
    ws.setBinaryHandler(handler)
  }

  function consumeNotice() {
    const value = notice.value
    notice.value = ""
    return value
  }

  return {
    requests,
    pendingCount,
    groupedRequests,
    helpStatus,
    queueAhead,
    teacherName,
    room,
    notice,
    isTeacher: computed(() => userStore.isTeacherOrAbove),
    connect,
    disconnect,
    requestHelp,
    cancelHelp,
    accept,
    reject,
    leave,
    sendBinary,
    setBinaryHandler,
    consumeNotice,
  }
})
```

- [ ] **Step 3: App.vue 挂全局连接**

在 `apps/web/src/App.vue` 的 `useConfigUpdate()` / `useMaxKB()` 附近加：

```ts
import { useCollabStore } from "shared/store/collab"

const collabStore = useCollabStore()

// 课堂求助通道。和 /ws/config 一样是全局常驻的：老师可能正在后台改题时
// 收到求助，学生也要在排队期间一直挂着，所以不放在题目页里起落
watch(
  () => userStore.isAuthed,
  (isAuthed) => {
    if (isAuthed) collabStore.connect()
    else collabStore.disconnect()
  },
  { immediate: true },
)
```

- [ ] **Step 4: 验证**

`bun run dev`，两个 profile 登录后：

1. devtools Network → WS 里能看到 `/ws/collab` 连上，且**任何页面**（首页、后台、题目页）都在
2. 教师端 Console：`useCollabStore` 不好直接取，改在 Vue devtools 里看 pinia 的 `collab` store
   —— `requests` 初始为空数组
3. 学生端 Console 手动发一条求助（借用上一个任务的裸 WS 方式即可），教师端 store 的
   `requests` 应实时出现一条，`pendingCount` 变 1
4. 学生登出 → 连接断开；重新登录 → 自动重连
5. 停掉 api（`Ctrl-C`）再起来 → 前端应自动重连（`BaseWebSocket` 默认无限重连）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/shared/composables/websocket.ts apps/web/src/shared/store/collab.ts apps/web/src/App.vue
git commit -m "feat(web): 课堂求助 store 与全局 collab 连接

连接全局常驻，不跟题目页起落 —— 老师在任何页面都要能收到求助。
列表按题目聚合，同题多人时能一眼看出该全班讲。"
```

---

## Task 5: 学生端求助按钮

**Files:**
- Modify: `apps/web/src/oj/problem/components/Form.vue`
- Modify: `apps/web/src/oj/problem/components/ProblemEditor.vue`

**Interfaces:**
- Consumes: Task 4 的 `useCollabStore()`
- Produces: 学生能从题目页发起与撤销求助；`Form.vue` 不再 emit `toggleSync`，也不再 `injectSyncStatus`

- [ ] **Step 1: Form.vue 换掉同步按钮**

删掉这些 import 与状态：

```ts
import { injectSyncStatus } from "oj/composables/syncStatus"
import { SYNC_MESSAGES } from "shared/composables/sync"
// ...
const syncStatus = injectSyncStatus()
const syncEnabled = ref(false)
```

以及 `emit` 里的 `toggleSync`、`toggleSync()` 函数、`defineExpose({ resetSyncStatus })`、
`Props` 里的 `isConnected`。

换成：

```ts
import { useCollabStore } from "shared/store/collab"

const collabStore = useCollabStore()

// 可见条件沿用原来的 showSyncFeature，再加上「不是教师」——
// 教师端的入口在顶栏，不在题目页
const showHelpButton = computed(
  () =>
    isDesktop.value &&
    userStore.isAuthed &&
    !userStore.isTeacherOrAbove &&
    codeStore.code.language !== "Flowchart" &&
    !isContestMode.value,
)

const helpButtonText = computed(() => {
  if (collabStore.helpStatus === "active") return "老师正在帮你"
  if (collabStore.helpStatus === "pending") return "取消求助"
  return "求助"
})

const toggleHelp = () => {
  if (collabStore.helpStatus === "pending") collabStore.cancelHelp()
  else if (collabStore.helpStatus === "idle")
    collabStore.requestHelp(problem.value!._id)
}

// 服务端的一次性提示（没有老师在线、老师取消了求助）
watch(
  () => collabStore.notice,
  (text) => {
    if (text) message.info(collabStore.consumeNotice())
  },
)
```

模板里把原来 `<template v-if="showSyncFeature">` 那整段（Form.vue:253-278）换成：

```vue
    <template v-if="showHelpButton">
      <n-button
        :size="buttonSize"
        :type="collabStore.helpStatus === 'idle' ? 'default' : 'warning'"
        :disabled="collabStore.helpStatus === 'active'"
        @click="toggleHelp"
      >
        {{ helpButtonText }}
      </n-button>

      <n-tag v-if="collabStore.helpStatus === 'pending'" type="info">
        已求助{{ collabStore.queueAhead > 0 ? `，前面还有 ${collabStore.queueAhead} 人` : "，等待老师接入" }}
      </n-tag>
      <n-tag v-else-if="collabStore.helpStatus === 'active'" type="success">
        {{ collabStore.teacherName }} 老师正在帮你
      </n-tag>
    </template>
```

- [ ] **Step 2: ProblemEditor.vue 去掉 syncStatus**

删掉这些（ProblemEditor.vue:5, 27-29, 75-92, 100-106 的相关部分）：

```ts
import { provideSyncStatus } from "oj/composables/syncStatus"
const sync = ref(false)
const syncStatus = provideSyncStatus()
const toggleSync = ...
const handleSyncClosed = ...
const handleSyncStatusChange = ...
```

`<Form>` 上去掉 `ref="formRef"`、`:is-connected`、`@toggle-sync`（`formRef` 与
`useTemplateRef` 声明一并删）。`<SyncCodeEditor>` 上去掉 `:sync`、`@sync-closed`、
`@sync-status-change`，改成由 store 驱动（Task 7 再接上，本任务先让它编译过）：

```vue
    <SyncCodeEditor
      v-else
      v-model:value="codeStore.code.value"
      :problem="problem!._id"
      :language="codeStore.code.language"
      :height="editorHeight"
      @update:model-value="changeCode"
    />
```

`SyncCodeEditor.vue` 里把 `sync` 从 `Props` 去掉、把两个 `emit` 去掉、把
`watch(() => sync, ...)` 与 `handleEditorReady` 里的 `if (sync)` 去掉，
`initSync` / `cleanupSyncResources` 与 `useCodeSync` 的引用全部删掉，
只留一个干净的 CodeMirror 包装。Task 7 再把协作接回来。

- [ ] **Step 3: 验证**

`bun run dev`，学生账号打开任意一道非比赛题：

1. 题目页出现「求助」按钮（原来的「开启同步」不见了）
2. 教师账号在另一个 profile 登录并**保持任意页面打开**
3. 学生点「求助」→ 按钮变「取消求助」，旁边出现「已求助，等待老师接入」标签
4. 教师端 Vue devtools 里 `collab` store 的 `requests` 出现一条
5. 学生再点一次 → 撤销，标签消失，教师端列表变空
6. 教师账号打开题目页 → **不应**出现求助按钮
7. 比赛题页面、流程图语言、手机宽度下 → 不应出现求助按钮
8. 教师全部下线时学生点求助 → 弹出「当前没有老师在线」，按钮保持「求助」
9. 确认页面其余功能正常：切语言、提交代码、重置代码、比赛题页面能正常打开
   （`ContestEditor.vue` 里那个空 provide 还在，Task 8 才删）

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/oj/problem/components/Form.vue apps/web/src/oj/problem/components/ProblemEditor.vue apps/web/src/shared/components/SyncCodeEditor.vue
git commit -m "feat(web): 题目页的「开启同步」换成「求助」

学生发起求助，状态与排队位置显示在按钮旁。
教师端入口不在题目页，所以对教师隐藏这个按钮。"
```

---
## Task 6: 教师端顶栏求助列表

**Files:**
- Create: `apps/web/src/shared/components/HelpRequestList.vue`
- Modify: `apps/web/src/shared/components/Header.vue`

**Interfaces:**
- Consumes: Task 4 的 `useCollabStore()`（`groupedRequests`、`pendingCount`、`accept`、`reject`）
- Produces: 顶栏一个带数字角标的按钮，点开是分组列表；点某条触发 `accept`，点 × 触发 `reject`

- [ ] **Step 1: 写 HelpRequestList.vue**

Create `apps/web/src/shared/components/HelpRequestList.vue`:

```vue
<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useCollabStore } from "shared/store/collab"

const collabStore = useCollabStore()

// 等待时长要每秒走一格，所以自己转一个 now
const now = ref(Date.now())
let timer: number | null = null
onMounted(() => {
  timer = window.setInterval(() => (now.value = Date.now()), 1000)
})
onUnmounted(() => {
  if (timer !== null) window.clearInterval(timer)
})

const waited = (createdAt: number) => {
  const seconds = Math.max(0, Math.floor((now.value - createdAt) / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

const handleAccept = (studentId: number, status: string) => {
  // 已被别的老师接走的不能点
  if (status === "active") return
  collabStore.accept(studentId)
}
</script>

<template>
  <n-popover trigger="click" placement="bottom-end" style="padding: 0">
    <template #trigger>
      <n-badge :value="collabStore.pendingCount" :max="99">
        <n-button>
          <Icon icon="fluent-emoji:raising-hand" height="20" />
          <span style="padding-left: 8px">求助</span>
        </n-button>
      </n-badge>
    </template>

    <div style="width: 320px; max-height: 60vh; overflow: auto; padding: 8px">
      <n-empty v-if="collabStore.groupedRequests.length === 0" description="暂无求助" />

      <div v-for="group in collabStore.groupedRequests" :key="group.problemId">
        <!-- 同题多人是个教学信号：该停下来全班讲，而不是挨个救 -->
        <n-flex align="center" justify="space-between" style="padding: 6px 4px">
          <n-text depth="3" style="font-size: 12px">
            {{ group.problemId }} · {{ group.problemTitle }}
          </n-text>
          <n-tag v-if="group.items.length > 1" size="small" type="warning">
            {{ group.items.length }} 人
          </n-tag>
        </n-flex>

        <n-flex
          v-for="item in group.items"
          :key="item.studentId"
          align="center"
          justify="space-between"
          :style="{
            padding: '6px 8px',
            borderRadius: '4px',
            opacity: item.status === 'active' ? 0.5 : 1,
            cursor: item.status === 'active' ? 'default' : 'pointer',
          }"
          @click="handleAccept(item.studentId, item.status)"
        >
          <n-flex vertical :size="2">
            <n-text>
              {{ item.studentName }}
              <n-text depth="3" v-if="item.className">（{{ item.className }}）</n-text>
            </n-text>
            <n-text depth="3" style="font-size: 12px">
              {{
                item.status === "active"
                  ? `${item.teacherName} 处理中`
                  : `等了 ${waited(item.createdAt)}`
              }}
            </n-text>
          </n-flex>

          <n-button
            v-if="item.status === 'pending'"
            quaternary
            circle
            size="small"
            @click.stop="collabStore.reject(item.studentId)"
          >
            <Icon icon="mdi:close" height="16" />
          </n-button>
        </n-flex>

        <n-divider style="margin: 4px 0" />
      </div>
    </div>
  </n-popover>
</template>
```

- [ ] **Step 2: 塞进 Header.vue**

在 `apps/web/src/shared/components/Header.vue` 的 script 里加 import：

```ts
import HelpRequestList from "./HelpRequestList.vue"
```

模板里放在「切换屏幕模式」那个 `n-button` 之后、`<div v-if="userStore.isFinished">` 之前
（Header.vue:329 附近）：

```vue
      <HelpRequestList v-if="isDesktop && userStore.isTeacherOrAbove" />
```

只在桌面端出现 —— 协作编辑本身也只在桌面端可用。

- [ ] **Step 3: 验证**

`bun run dev`，教师账号 + 两三个学生账号（可以用同一台机器的多个隐私窗口）：

1. 教师顶栏出现「求助」按钮，角标为 0
2. 学生 B 对第 5 题求助 → 角标变 1，点开能看到 B 的名字、班级、等待时长在走
3. 学生 C 也对第 5 题求助 → 角标 2，两人归在同一组下，组标题旁出现「2 人」标签
4. 学生 D 对第 9 题求助 → 出现第二个分组；人多的第 5 题排在前面
5. 点某条的 × → 该学生收到「老师已取消你的求助」，条目消失，角标减 1
6. 点某条的空白处 → 触发 accept（此时还没有协作界面，Task 7 才有）；
   刷新后该条应显示为灰色的「XX 处理中」
7. 学生账号登录后顶栏**不应**出现这个按钮
8. 窗口缩到手机宽度 → 按钮消失

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/shared/components/HelpRequestList.vue apps/web/src/shared/components/Header.vue
git commit -m "feat(web): 教师顶栏的求助列表

按题目分组，同题多人时标出人数。按等待时长排序但不强制先来先到 ——
上课时有的问题一句话说清、有的要讲五分钟。"
```

---

## Task 7: 协作编辑

把 Yjs 接到 collab 通道上。这是内容源硬规则落地的地方。

**Files:**
- Create: `apps/web/src/shared/composables/collabDoc.ts`
- Create: `apps/web/src/shared/components/CollabModal.vue`
- Modify: `apps/web/src/shared/components/SyncCodeEditor.vue`
- Modify: `apps/web/src/shared/components/Header.vue`（挂 CollabModal）
- Modify: `apps/web/package.json`（显式依赖 y-protocols）

**Interfaces:**
- Consumes: Task 4 的 `sendBinary` / `setBinaryHandler` / `room`
- Produces: `useCollabDoc()` 返回 `{ start(options), stop(), getInitialExtension() }`，
  其中 `options: { editorView: EditorView; seedContent: string | null }` ——
  `seedContent` 为字符串时把它作为文档初始内容写入（学生端），为 `null` 时什么都不写（教师端）

- [ ] **Step 1: 显式依赖 y-protocols**

`y-protocols` 现在是靠 `y-webrtc` 带进来的，Task 8 会把 y-webrtc 删掉。先补成直接依赖：

```bash
cd /home/xuyue/Projects/OJ/OJ2/apps/web && bun add y-protocols@1.0.7
```

`lib0` 是 `y-codemirror.next` 的直接依赖，会一直在，不用单独加。

- [ ] **Step 2: 写 collabDoc.ts**

Create `apps/web/src/shared/composables/collabDoc.ts`:

```ts
import { Compartment } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { useCollabStore } from "shared/store/collab"
import { useUserStore } from "shared/store/user"

/** y-websocket 那套消息头，服务端不解析，只有两端认 */
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const TEACHER_COLOR = "#ff6b6b"
const STUDENT_COLOR = "#4dabf7"

interface StartOptions {
  editorView: EditorView
  /**
   * 文档的初始内容。
   *
   * **学生端传当前编辑器内容，教师端必须传 null。** 这是硬规则：
   * 求助是学生发起的，学生的代码是唯一内容源。老师端插入任何初始内容都会
   * 与学生的内容合并，结果就是两份代码拼在一起 —— 老实现的竞态就是这么来的。
   */
  seedContent: string | null
}

export function useCollabDoc() {
  const collabStore = useCollabStore()
  const userStore = useUserStore()
  const compartment = new Compartment()

  let doc: any = null
  let awareness: any = null
  let view: EditorView | null = null
  let detachDocUpdate: (() => void) | null = null
  let detachAwarenessUpdate: (() => void) | null = null

  async function start({ editorView, seedContent }: StartOptions) {
    const [Y, awarenessProtocol, syncProtocol, encoding, decoding, { yCollab }] =
      await Promise.all([
        import("yjs"),
        import("y-protocols/awareness"),
        import("y-protocols/sync"),
        import("lib0/encoding"),
        import("lib0/decoding"),
        import("y-codemirror.next"),
      ])

    view = editorView
    doc = new Y.Doc()
    const ytext = doc.getText("codemirror")
    awareness = new awarenessProtocol.Awareness(doc)

    // ★ 顺序不能反：先把内容写进 ytext，再挂 yCollab。
    // yCollab 挂上去时会用 ytext 覆盖编辑器内容，先挂就会把学生的代码清空。
    if (seedContent) ytext.insert(0, seedContent)

    const send = (build: (encoder: any) => void) => {
      const encoder = encoding.createEncoder()
      build(encoder)
      collabStore.sendBinary(encoding.toUint8Array(encoder))
    }

    collabStore.setBinaryHandler((data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data))
      const messageType = decoding.readVarUint(decoder)
      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, doc, "remote")
        // 只有需要回话时才发（readSyncMessage 可能什么都没写）
        if (encoding.length(encoder) > 1) {
          collabStore.sendBinary(encoding.toUint8Array(encoder))
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          "remote",
        )
      }
    })

    const onDocUpdate = (update: Uint8Array, origin: any) => {
      if (origin === "remote") return
      send((encoder) => {
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeUpdate(encoder, update)
      })
    }
    doc.on("update", onDocUpdate)
    detachDocUpdate = () => doc?.off("update", onDocUpdate)

    const onAwarenessUpdate = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: any,
    ) => {
      if (origin === "remote") return
      const changed = added.concat(updated, removed)
      send((encoder) => {
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
        )
      })
    }
    awareness.on("update", onAwarenessUpdate)
    detachAwarenessUpdate = () => awareness?.off("update", onAwarenessUpdate)

    awareness.setLocalStateField("user", {
      name: userStore.user?.username ?? "匿名",
      color: userStore.isTeacherOrAbove ? TEACHER_COLOR : STUDENT_COLOR,
    })

    editorView.dispatch({
      effects: compartment.reconfigure(yCollab(ytext, awareness)),
    })

    // 握手：双方都发 SyncStep1，各自回 Step2，两边收敛。
    // 服务端是哑转发，不参与同步，所以这一步必须由两端对称完成
    send((encoder) => {
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(encoder, doc)
    })
    send((encoder) => {
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
      )
    })
  }

  function stop() {
    collabStore.setBinaryHandler(null)
    detachDocUpdate?.()
    detachAwarenessUpdate?.()
    detachDocUpdate = null
    detachAwarenessUpdate = null

    if (view) {
      try {
        view.dispatch({ effects: compartment.reconfigure([]) })
      } catch (error) {
        console.warn("移除协同编辑扩展失败:", error)
      }
      view = null
    }
    awareness?.destroy()
    doc?.destroy()
    awareness = null
    doc = null
  }

  function getInitialExtension() {
    return compartment.of([])
  }

  return { start, stop, getInitialExtension }
}
```

- [ ] **Step 3: SyncCodeEditor.vue 接上（学生端）**

在 Task 5 精简后的 `SyncCodeEditor.vue` 上加回协作，由 store 的 `room` 驱动：

```ts
import { useCollabDoc } from "../composables/collabDoc"
import { useCollabStore } from "shared/store/collab"

const collabStore = useCollabStore()
const { start, stop, getInitialExtension } = useCollabDoc()
const editorView = ref<EditorView | null>(null)

const handleEditorReady = (payload: EditorReadyPayload) => {
  editorView.value = payload.view as EditorView
}

// 房间开了才建文档。学生点求助时什么都不做 —— 老师没来之前不该动他的编辑器
watch(
  () => collabStore.room,
  (room) => {
    if (room && editorView.value) {
      // 学生端：当前编辑器内容就是内容源
      start({
        editorView: editorView.value as EditorView,
        seedContent: editorView.value.state.doc.toString(),
      })
    } else {
      stop()
    }
  },
)

onUnmounted(stop)
```

`extensions` 的计算属性里保留 `getInitialExtension()`（原来就有，位置不动）。

- [ ] **Step 4: 写 CollabModal.vue（教师端）**

Create `apps/web/src/shared/components/CollabModal.vue`:

```vue
<script setup lang="ts">
import { cpp } from "@codemirror/lang-cpp"
import { python } from "@codemirror/lang-python"
import { sql, SQLite } from "@codemirror/lang-sql"
import { bracketMatching } from "@codemirror/language"
import { closeBrackets } from "@codemirror/autocomplete"
import type { EditorView } from "@codemirror/view"
import { Codemirror } from "vue-codemirror"
import { oneDark } from "../themes/oneDark"
import { smoothy } from "../themes/smoothy"
import { styleTheme } from "shared/extensions/baseTheme"
import { useCollabDoc } from "../composables/collabDoc"
import { useCollabStore } from "shared/store/collab"

const isDark = useDark()
const collabStore = useCollabStore()
const { start, stop, getInitialExtension } = useCollabDoc()

const code = ref("")
const editorView = ref<EditorView | null>(null)

// 教师端只在自己发起接单时开。学生端的协作在 SyncCodeEditor 里
const show = computed({
  get: () => collabStore.isTeacher && collabStore.room !== null,
  set: (value: boolean) => {
    if (!value) collabStore.leave()
  },
})

const extensions = computed(() => [
  styleTheme,
  cpp(),
  bracketMatching(),
  closeBrackets(),
  isDark.value ? oneDark : smoothy,
  getInitialExtension(),
])

const handleEditorReady = (payload: { view: EditorView }) => {
  editorView.value = payload.view
}

watch(
  () => collabStore.room,
  async (room) => {
    if (room && collabStore.isTeacher) {
      await nextTick()
      if (!editorView.value) return
      // ★ 教师端 seedContent 必须是 null —— 内容全部来自学生端
      start({ editorView: editorView.value as EditorView, seedContent: null })
    } else {
      stop()
    }
  },
)

onUnmounted(stop)
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :style="{ width: '80vw', maxWidth: '1100px' }"
    :title="`正在帮 ${collabStore.room?.peerName ?? ''} · ${collabStore.room?.problemId ?? ''}`"
  >
    <template #header-extra>
      <n-button
        text
        tag="a"
        target="_blank"
        :href="`/problem/${collabStore.room?.problemId}`"
      >
        打开题面
      </n-button>
    </template>

    <Codemirror
      v-model="code"
      indentWithTab
      :extensions="extensions"
      :tab-size="4"
      style="height: 60vh; font-size: 18px"
      @ready="handleEditorReady"
    />

    <template #footer>
      <n-flex justify="end">
        <n-button type="primary" @click="collabStore.leave()">结束协作</n-button>
      </n-flex>
    </template>
  </n-modal>
</template>
```

模态框里的语言高亮固定用 cpp —— 它对 C / C++ 都合适，而教师端拿不到题目的语言设置。
如果实跑时觉得 Python 题看着别扭，再从 `room` 里多带一个语言字段过来。

- [ ] **Step 5: 挂到 Header.vue**

`Header.vue` 的 script 里 import，模板最外层加一行（放在根 `n-flex` 之后，与它平级）：

```vue
  <CollabModal v-if="userStore.isTeacherOrAbove" />
```

放在 Header 里是因为它要跟着顶栏的求助列表走，而 Header 在每个页面都有。

- [ ] **Step 6: 验证协作**

`bun run dev`，教师 profile + 学生 profile：

1. 学生在第 5 题写几行代码，点「求助」
2. 教师点开列表，点那条 → **弹出模态框，里面出现学生写的那几行代码**
3. **确认学生那边的编辑器内容没有任何变化**（没被清空、没闪、没被覆盖）—— 这是本任务的核心
4. 教师在模态框里改代码 → 学生编辑器实时跟着变，且能看到教师的光标（红色）
5. 学生在自己编辑器里打字 → 教师模态框实时跟着变，光标蓝色
6. 两边同时在不同位置打字 → 不冲突、不丢字
7. 教师点「结束协作」→ 模态框关闭，**学生编辑器保留改后的代码**，求助按钮回到「求助」
8. 学生刷新页面 → 代码还在（localStorage 照常写入）
9. 再走一遍，这次教师直接关标签页 → 学生收到「对方已断开连接」，且求助自动回到排队状态
10. 再走一遍，这次学生关标签页 → 教师模态框关闭，列表里那条消失
11. 教师快速连续敲 100 个字符 → 连接不断（限流宽松档），学生端跟得上
12. Console 不应出现 `[WebSocket] 解析消息失败`

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/shared/composables/collabDoc.ts apps/web/src/shared/components/CollabModal.vue apps/web/src/shared/components/SyncCodeEditor.vue apps/web/src/shared/components/Header.vue apps/web/package.json bun.lock
git commit -m "feat(web): 协作编辑走 collab 通道

Yjs sync/awareness 协议直接跑在 /ws/collab 上，服务端哑转发。
内容源是学生：学生端先把编辑器内容写进 ytext 再挂 yCollab，
教师端 seedContent 恒为 null —— 这条根治了老实现里谁的代码活下来看运气的问题。"
```

---
## Task 8: 清理旧实现与文档

新实现跑通后才做这一步 —— 前面每个任务都要能独立回滚。

**Files:**
- Delete: `apps/web/src/shared/composables/sync.ts`
- Delete: `apps/web/src/oj/composables/syncStatus.ts`
- Modify: `apps/web/src/oj/problem/components/ContestEditor.vue`
- Modify: `apps/web/package.json`
- Modify: `apps/web/.env`、`.env.production`、`.env.staging`、`.env.test`
- Modify: `apps/web/src/env.d.ts`
- Modify: `apps/web/CLAUDE.md`

**Interfaces:**
- Consumes: Task 1-7 全部完成且验证通过
- Produces: 无新接口，仅移除

- [ ] **Step 1: 确认没有残留引用**

```bash
cd /home/xuyue/Projects/OJ/OJ2
grep -rn "useCodeSync\|SYNC_MESSAGES\|SYNC_ERROR_CODES\|syncStatus\|y-webrtc\|WebrtcProvider\|PUBLIC_SIGNALING_URL" apps/web/src apps/web/*.env* apps/web/package.json
```

预期只剩下待删的那几个文件自身、四个 `.env`、`env.d.ts`、`package.json`、`CLAUDE.md`。
如果还有别的业务文件引用，说明前面某个任务没改干净，先回去补。

- [ ] **Step 2: 删文件与空 provide**

```bash
rm apps/web/src/shared/composables/sync.ts apps/web/src/oj/composables/syncStatus.ts
```

`apps/web/src/oj/problem/components/ContestEditor.vue` 删掉这两行（原 8、21-23 行）：

```ts
import { provideSyncStatus } from "oj/composables/syncStatus"
// 提供空的同步状态，避免 Form 组件注入错误
// 在竞赛模式下，同步功能会被 showSyncFeature 自动禁用
provideSyncStatus()
```

这个空 provide 存在的唯一理由是 `injectSyncStatus()` 会抛错，随 `syncStatus.ts` 一起消失。

- [ ] **Step 3: 卸掉 y-webrtc**

```bash
cd /home/xuyue/Projects/OJ/OJ2/apps/web && bun remove y-webrtc
```

确认 `yjs`、`y-codemirror.next`、`y-protocols` 还在 —— 它们仍在用。

- [ ] **Step 4: 删环境变量**

四个 env 文件里删掉 `PUBLIC_SIGNALING_URL=...` 那一行：

```bash
cd /home/xuyue/Projects/OJ/OJ2/apps/web
sed -i '/^PUBLIC_SIGNALING_URL=/d' .env .env.production .env.staging .env.test
```

`apps/web/src/env.d.ts:9` 删掉：

```ts
  readonly PUBLIC_SIGNALING_URL: string
```

- [ ] **Step 5: 改 apps/web/CLAUDE.md**

两处：

1. 环境变量表里删掉这一行：
   ```
   | `PUBLIC_SIGNALING_URL` | WebRTC signaling server |
   ```
2. `### Real-time Features` 一节（约 108-110 行），把
   ```
   - Yjs + y-webrtc for collaborative editing in the flowchart editor
   ```
   改成
   ```
   - Yjs over the `/ws/collab` channel for classroom help requests and collaborative
     code editing (students raise a hand, teachers join their editor). The server is a
     dumb relay — it authenticates, assigns rooms, and forwards frames without parsing
     them. See `docs/specs/2026-08-28-collab-help-request-design.md`.
   ```
   原文说协作在流程图编辑器里，这本来就是错的 —— 协作在代码编辑器，流程图被显式排除。

（这份文档整体还是 ojnext 时代的内容，npm 命令、指向 `../OnlineJudge` 的 Django 后端都过期了。
本任务只改与本次改动直接相关的两节，整份翻新另计。）

- [ ] **Step 6: 全量验证**

```bash
cd /home/xuyue/Projects/OJ/OJ2
bun run build
```

构建必须干净通过（没有找不到模块、没有未使用的类型报错）。然后 `bun run dev` 走一遍完整回归：

1. 学生求助 → 教师接单 → 双向编辑 → 结束，学生代码保留
2. 多人求助的排序、同题聚合、取消
3. 无教师在线时求助的提示
4. 比赛题页面能正常打开且无求助按钮（`ContestEditor.vue` 改动后没有 inject 报错）
5. 流程图题目页面正常
6. 提交代码、判题状态实时刷新（`/ws/submissions` 没被 Task 2 的改动碰坏）
7. 超管改站点配置，其他页面不刷新就生效（`/ws/config` 同上）
8. 浏览器 Console 与 devtools Network → WS 里，**没有**任何指向
   `signaling.xuyue.cc` 或 `10.13.114.114:8085` 的请求

- [ ] **Step 7: 提交**

```bash
git add -A apps/web
git commit -m "refactor(web): 删掉 y-webrtc 协同编辑的旧实现

sync.ts / syncStatus.ts、y-webrtc 依赖、PUBLIC_SIGNALING_URL 全部移除，
外部信令服务器 signaling.xuyue.cc 不再被使用。
顺带修掉 CLAUDE.md 里「协作在流程图编辑器」这句一直是错的描述。"
```

---

## 收尾

全部任务完成后，`docs/specs/2026-08-28-collab-help-request-design.md` 的状态行从
「已确认，待实施」改成「已实施」，并提交。

外部信令服务器 `signaling.xuyue.cc` 在本次改动后已无任何调用方。它不在本仓库的
`docker/` 编排里，需要用户自行到部署它的地方下线 —— 计划不包含这一步，因为仓库里
查不到它怎么起。

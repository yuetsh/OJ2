import { flowchartUpdateSchema, submissionUpdateSchema } from "@oj2/contract"
import { and, eq } from "drizzle-orm"

import { touchSession } from "./auth/session"
import {
  handleCollabBinary,
  handleCollabClose,
  handleCollabMessage,
  handleCollabOpen,
} from "./collab/handler"
import { config } from "./config"
import { db, schema } from "./db"
import {
  parseSubmissionEvent,
  submissionUpdateChannel,
  userSubmissionTopic,
} from "./judge/events"
import { JudgeStatus } from "./judge/status"
import { createSubscriberRedis } from "./redis"
import {
  configTopic,
  configUpdateChannel,
  parseSessionRevoked,
  parseUserEvent,
  sessionRevokedChannel,
  userEventChannel,
  userEventTopic,
} from "./events"

/** 本机的几种写法。开发时 Vite 代理会让 Origin（5173）和 Host（3000）对不上 */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

/**
 * WebSocket 升级的来源校验。
 *
 * 会话 cookie 是 SameSite=Lax，而 WebSocket 握手不是导航，跨站页面本来就带不上
 * 这个 cookie —— 所以这里是防御纵深，不是唯一防线。
 *
 * 不发 Origin 的一律放行：真正的攻击面是「带着受害者 cookie 的浏览器页面」，
 * 而浏览器一定会带 Origin；脚本客户端本来就能伪造任意请求头，拦它没有意义。
 */
export function isAllowedWebSocketOrigin(origin: string | null, url: URL) {
  if (!origin) return true
  if (config.allowedWebSocketOrigins.includes(origin)) return true
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  if (originUrl.host === url.host) return true
  // 两边都是本机才放行。生产环境 url.hostname 是正式域名，这条永远不成立
  return (
    LOCAL_HOSTNAMES.has(originUrl.hostname) && LOCAL_HOSTNAMES.has(url.hostname)
  )
}

export interface SubmissionSocketData {
  userId: number
  /** 同一个 Bun.serve 只能挂一个 websocket handler，用它区分通道 */
  kind: "submissions" | "config" | "collab"
  /** 握手时那张会话的 token，留着定期确认它还没被登出 / 过期，见 sweepSessions */
  token: string
  /** 令牌桶，open 时初始化，见 allowMessage */
  rate?: { tokens: number; updatedAt: number }
  /** 握手时从会话里读，三种 kind 都会填；collab 通道用它判断老师身份、拼 room_open 里的姓名 */
  username?: string
  adminType?: string
  /** 当前所在协作房间的房主（学生）id，见 collab/handler.ts */
  roomOwnerId?: number
}

/**
 * 每条连接的消息限流。
 *
 * 一条 subscribe 在服务端是一到两次数据库查询，一个学生开着一条 socket 狂发就能
 * 压住库。正常流量离这个阈值很远：心跳 30 秒一条，订阅一次提交也就一两条，
 * 20 的突发额度 + 每秒 2 个的回填是几十倍的余量。
 */
const RATE_BURST = 20
const RATE_REFILL_PER_SECOND = 2

/**
 * collab 通道的二进制帧（Yjs update / awareness）单独一档。
 *
 * 它不查库、不解析，纯内存按房间转发，成本和文本控制帧完全不是一个量级；
 * 而连续快速输入大约 5-10 帧/秒，用严格档几秒钟就会把正在协作的人踢下线。
 */
const COLLAB_BINARY_BURST = 200
const COLLAB_BINARY_REFILL_PER_SECOND = 100

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

/**
 * 当前挂着的连接。Bun 不提供遍历连接的接口，要定期巡检就得自己登记。
 * open 时加入、close 时移除，见 sweepSessions。
 */
const liveSockets = new Set<Bun.ServerWebSocket<SubmissionSocketData>>()

/** 会话巡检间隔。够快到登出后一分钟内断开，又不至于让 Redis 忙起来 */
const SESSION_SWEEP_INTERVAL = 60_000

/** 先把 force_logout 帧发出去，再断连接，留一拍给它出门 */
const FORCE_LOGOUT_CLOSE_DELAY = 100

/**
 * 通知并断开一批连接。
 *
 * 之所以先发一帧再断：只断连接的话前端只看到一次普通掉线，会照常重连，页面上
 * 还显示着登录态；收到 force_logout 才知道要清掉身份、弹登录框或者提示被禁用。
 */
function forceLogout(
  targets: Bun.ServerWebSocket<SubmissionSocketData>[],
  reason: string,
) {
  if (targets.length === 0) return
  const frame = JSON.stringify({ type: "force_logout", reason })
  for (const ws of targets) ws.send(frame)
  setTimeout(() => {
    for (const ws of targets) ws.close(1008, "Session ended")
  }, FORCE_LOGOUT_CLOSE_DELAY)
}

/**
 * 定期把会话已经失效的连接断掉。
 *
 * 握手时校验过一次会话，但这条连接能挂几个小时 —— 期间用户可能在别的标签页登出，
 * 或者会话本身到期。只靠消息触发的校验不够：一条连接完全可能除了心跳什么都不发，
 * 而心跳是**故意**不查会话的（否则每客户端每 30 秒一趟 Redis 又回来了）。
 *
 * 注意这里不查 isDisabled：管理员禁用只改数据库列、不删会话，所以 token 校验
 * 覆盖不到它。禁用由推送路径上的 bridgeSubmissionEvents 挡着 —— 被禁用的学生
 * 收不到任何数据，socket 还挂着只是根空管子。
 */
export async function sweepSessions() {
  // 一个学生至少有配置和提交两条通道，多开几个标签页还会更多，而它们共用同一张
  // 会话 —— 一轮里同一个 token 只查一次
  const checked = new Map<string, boolean>()
  const dead: Bun.ServerWebSocket<SubmissionSocketData>[] = []
  for (const ws of liveSockets) {
    const token = ws.data.token
    let alive = checked.get(token)
    if (alive === undefined) {
      try {
        alive = await touchSession(token)
      } catch (error) {
        // Redis 抖一下不该把全班踢下线：这一轮直接放弃，下一轮再说
        console.error("Failed to verify websocket sessions", error)
        return
      }
      checked.set(token, alive)
    }
    if (!alive) dead.push(ws)
  }
  // 会话没了有两种可能：在别的标签页登出了，或者会话自己到期。对用户都是
  // 「要重新登录」，走 session-ended 这一支
  forceLogout(dead, "session-ended")
}

export function startSessionSweep() {
  const timer = setInterval(() => {
    void sweepSessions()
  }, SESSION_SWEEP_INTERVAL)
  timer.unref()
  return timer
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function submissionWebSocketHandler(): Bun.WebSocketHandler<SubmissionSocketData> {
  return {
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
      if (!allowMessage(ws)) {
        ws.close(1008, "Too many messages")
        return
      }
      // handleMessage 里有 DB 查询和会抛的 schema.parse。以前是裸的 `void`，
      // 库抖一下就是一个 unhandled rejection（隔壁 bridgeSubmissionEvents 两处
      // 都接住了，只有这里漏了）
      handleMessage(ws, String(message)).catch((error) => {
        console.error("Failed to handle websocket message", error)
        ws.send(JSON.stringify({ type: "error", message: "Internal error" }))
      })
    },
    close(ws) {
      liveSockets.delete(ws)
      if (ws.data.kind === "collab") {
        handleCollabClose(ws)
        return
      }
      if (ws.data.kind === "config") {
        ws.unsubscribe(configTopic)
        return
      }
      ws.unsubscribe(userSubmissionTopic(ws.data.userId))
      ws.unsubscribe(userEventTopic(ws.data.userId))
    },
  }
}

async function handleMessage(
  ws: Bun.ServerWebSocket<SubmissionSocketData>,
  raw: string,
) {
  let message: { type?: unknown; timestamp?: unknown; submissionId?: unknown }
  try {
    message = JSON.parse(raw) as typeof message
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
    return
  }

  // 心跳不查库。原来的顺序是「先查 user 再看消息类型」，于是每个客户端每 30 秒
  // 都要为一次 ping 打一趟数据库；一个题目页还开着两条连接，全班在线时纯空转。
  // 禁用用户不会因此漏网：往用户 topic 推之前 bridgeSubmissionEvents 会查一次，
  // 而 subscribe 这条真正读数据的路径下面照样查。
  if (message.type === "ping") {
    ws.send(JSON.stringify({ type: "pong", timestamp: message.timestamp }))
    return
  }
  if (message.type !== "subscribe" || typeof message.submissionId !== "string") {
    ws.send(JSON.stringify({ type: "error", message: "Invalid message" }))
    return
  }

  // 会话可能在连接期间就失效了：用户在别的标签页登出，或者会话自己到期。
  // 握手时校验过一次不算数 —— 这条连接能挂几个小时。
  if (!(await touchSession(ws.data.token))) {
    ws.close(1008, "Session expired")
    return
  }

  const [activeUser] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(
      and(
        eq(schema.user.id, ws.data.userId),
        eq(schema.user.isDisabled, false),
      ),
    )
    .limit(1)
  if (!activeUser) {
    ws.close(1008, "Account disabled")
    return
  }

  const [submission] = await db
    .select({
      id: schema.submission.id,
      result: schema.submission.result,
      statisticInfo: schema.submission.statisticInfo,
    })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.id, message.submissionId),
        eq(schema.submission.userId, ws.data.userId),
      ),
    )
    .limit(1)

  if (!submission) {
    const [flowchart] = await db
      .select({ id: schema.flowchartSubmission.id, status: schema.flowchartSubmission.status, score: schema.flowchartSubmission.aiScore, grade: schema.flowchartSubmission.aiGrade })
      .from(schema.flowchartSubmission)
      .where(and(eq(schema.flowchartSubmission.id, message.submissionId), eq(schema.flowchartSubmission.userId, ws.data.userId)))
      .limit(1)
    if (!flowchart) {
      ws.send(JSON.stringify({ type: "error", message: "Submission not found" }))
      return
    }
    const replay = flowchart.status === 2
      ? { type: "flowchart_evaluation_completed", submissionId: flowchart.id, score: flowchart.score ?? undefined, grade: flowchart.grade ?? undefined }
      : flowchart.status === 3
        ? { type: "flowchart_evaluation_failed", submissionId: flowchart.id }
        : { type: "flowchart_evaluation_update", submissionId: flowchart.id }
    ws.send(JSON.stringify(flowchartUpdateSchema.parse(replay)))
    return
  }

  const statistics = objectValue(submission.statisticInfo)
  const status =
    submission.result === JudgeStatus.PENDING
      ? "pending"
      : submission.result === JudgeStatus.JUDGING
        ? "judging"
        : submission.result === JudgeStatus.SYSTEM_ERROR
          ? "error"
          : "finished"
  const parsed = submissionUpdateSchema.safeParse({
    type: "submission_update",
    submissionId: submission.id,
    result: submission.result,
    status,
    score: statistics.score,
  })
  if (parsed.success) ws.send(JSON.stringify(parsed.data))
}

export async function bridgeSubmissionEvents(
  server: Bun.Server<SubmissionSocketData>,
) {
  const subscriber = createSubscriberRedis()
  subscriber.on("message", (channel, raw) => {
    if (channel === configUpdateChannel) {
      // 配置广播不校验用户：内容就是站点公开配置本身，且所有连着的人都该收到
      server.publish(configTopic, raw)
      return
    }
    if (channel === sessionRevokedChannel) {
      const revoked = parseSessionRevoked(raw)
      if (!revoked) return
      // 按 token 还是按 userId，取决于是「这张会话登出了」还是「这个账号被禁用了」
      forceLogout(
        [...liveSockets].filter((ws) =>
          revoked.token !== undefined
            ? ws.data.token === revoked.token
            : ws.data.userId === revoked.userId,
        ),
        revoked.reason,
      )
      return
    }
    if (channel === userEventChannel) {
      const event = parseUserEvent(raw)
      if (!event) return
      const topic = userEventTopic(event.userId)
      // 这台实例上没人订阅就到此为止：判题高峰期绝大多数事件的目标用户此刻并不
      // 在线，查一次库只为了 publish 给零个订阅者
      if (server.subscriberCount(topic) === 0) return
      void (async () => {
        const [activeUser] = await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(and(eq(schema.user.id, event.userId), eq(schema.user.isDisabled, false)))
          .limit(1)
        if (!activeUser) return
        server.publish(topic, JSON.stringify(event.data))
      })().catch((error) => {
        console.error("Failed to bridge user event", error)
      })
      return
    }
    if (channel !== submissionUpdateChannel) return
    const event = parseSubmissionEvent(raw)
    if (!event) return
    const topic = userSubmissionTopic(event.userId)
    if (server.subscriberCount(topic) === 0) return
    void (async () => {
      const [activeUser] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(
          and(
            eq(schema.user.id, event.userId),
            eq(schema.user.isDisabled, false),
          ),
        )
        .limit(1)
      if (!activeUser) return
      server.publish(topic, JSON.stringify(event.data))
    })().catch((error) => {
      console.error("Failed to bridge submission event", error)
    })
  })
  subscriber.on("error", (error) => {
    console.error("Submission event subscriber error", error)
  })
  await subscriber.subscribe(
    submissionUpdateChannel,
    userEventChannel,
    configUpdateChannel,
    sessionRevokedChannel,
  )
  return subscriber
}

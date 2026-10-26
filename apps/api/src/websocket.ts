import { submissionUpdateSchema, type FlowchartUpdate } from '@oj2/contract'
import { and, eq, inArray } from 'drizzle-orm'

import { touchSession } from './auth/session'
import { handleCollabBinary, handleCollabClose, handleCollabMessage, handleCollabOpen, refreshRequestLatest } from './collab/handler'
import { config } from './config'
import { db, schema } from './db'
import { parseSubmissionEvent, submissionUpdateChannel, userSubmissionTopic } from './judge/events'
import { JudgeStatus } from './judge/status'
import { createSubscriberRedis } from './redis'
import { asRecord } from './routes/helpers'
import { configTopic, configUpdateChannel, parseSessionRevoked, parseUserEvent, sessionRevokedChannel, userEventChannel, userEventTopic } from './events'

/** 本机的几种写法。开发时 Vite 代理会让 Origin（5173）和 Host（3000）对不上 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * WebSocket 升级的来源校验。
 *
 * 握手要带 access token（子协议），跨站页面拿不到别人 localStorage 里的 token，
 * 所以这里是防御纵深，不是唯一防线。
 *
 * 不发 Origin 的一律放行：浏览器一定会带 Origin；脚本客户端本来就能伪造任意请求头，
 * 拦它没有意义。
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
  return LOCAL_HOSTNAMES.has(originUrl.hostname) && LOCAL_HOSTNAMES.has(url.hostname)
}

interface RateBucket {
  tokens: number
  updatedAt: number
}

export interface SubmissionSocketData {
  userId: number
  /** 同一个 Bun.serve 只能挂一个 websocket handler，用它区分通道 */
  kind: 'submissions' | 'config' | 'collab'
  /** 握手时那张会话的 id，留着定期确认它还没被登出 / 过期，见 sweepSessions */
  sid: string
  /** 握手时 access token 里签的 token_version，巡检时和库里比，见 sweepSessions */
  tokenVersion: number
  /** 文本控制帧的令牌桶，open 时初始化，见 allowMessage */
  rate?: RateBucket
  /**
   * collab 二进制帧的令牌桶，和 rate 分开。
   *
   * 共用一个桶的话宽松档名存实亡：每条文本帧（含 30 秒一次的心跳）都会
   * `Math.min(RATE_BURST, ...)` 把桶压回 20，二进制帧再怎么标 200 突发也拿不到。
   * 实测连打 150 帧会在第 101 帧被 1008 踢下线。
   */
  binaryRate?: RateBucket
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

function consume(bucket: RateBucket, burst: number, refillPerSecond: number) {
  const now = Date.now()
  const refill = ((now - bucket.updatedAt) / 1000) * refillPerSecond
  bucket.tokens = Math.min(burst, bucket.tokens + refill)
  bucket.updatedAt = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

/** 文本帧：严格档。会查库，走这一档的都按最坏情况算 */
function allowMessage(ws: Bun.ServerWebSocket<SubmissionSocketData>) {
  const bucket = (ws.data.rate ??= {
    tokens: RATE_BURST,
    updatedAt: Date.now(),
  })
  return consume(bucket, RATE_BURST, RATE_REFILL_PER_SECOND)
}

/** collab 二进制帧：宽松档，独立的桶 —— 见 binaryRate 的注释 */
function allowCollabBinary(ws: Bun.ServerWebSocket<SubmissionSocketData>) {
  const bucket = (ws.data.binaryRate ??= {
    tokens: COLLAB_BINARY_BURST,
    updatedAt: Date.now(),
  })
  return consume(bucket, COLLAB_BINARY_BURST, COLLAB_BINARY_REFILL_PER_SECOND)
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
function forceLogout(targets: Bun.ServerWebSocket<SubmissionSocketData>[], reason: string) {
  if (targets.length === 0) return
  const frame = JSON.stringify({ type: 'force_logout', reason })
  for (const ws of targets) ws.send(frame)
  setTimeout(() => {
    for (const ws of targets) ws.close(1008, 'Session ended')
  }, FORCE_LOGOUT_CLOSE_DELAY)
}

/**
 * 定期把会话已经失效的连接断掉。
 *
 * 握手时校验过一次，但这条连接能挂几个小时 —— 期间用户可能在别的标签页登出，
 * 或者会话本身到期，或者在另一个站点被改了密码、禁用了。只靠消息触发的校验不够：
 * 一条连接完全可能除了心跳什么都不发，而心跳是**故意**不查会话的
 * （否则每客户端每 30 秒一趟 Redis 又回来了）。
 *
 * 两步：Redis 里会话还在不在（顺带续期、记在线），库里 token_version 变没变、
 * 禁没禁用。后者一轮只打一条 IN 查询。本站改密码、禁用会走 publishSessionRevoked
 * 立刻断，这里兜的是另一个站点做的 —— 两边共用库、不共用 Redis 的 pub/sub。
 */
export async function sweepSessions() {
  // 一个学生至少有配置和提交两条通道，多开几个标签页还会更多，而它们共用同一张
  // 会话 —— 一轮里同一个会话只查一次
  const checked = new Map<string, boolean>()
  const sockets = [...liveSockets]
  let users: { id: number; tokenVersion: number; isDisabled: boolean }[]
  try {
    for (const ws of sockets) {
      if (checked.has(ws.data.sid)) continue
      checked.set(ws.data.sid, await touchSession(ws.data.sid, ws.data.userId))
    }
    const userIds = [...new Set(sockets.map((ws) => ws.data.userId))]
    users = userIds.length
      ? await db
          .select({
            id: schema.user.id,
            tokenVersion: schema.user.tokenVersion,
            isDisabled: schema.user.isDisabled,
          })
          .from(schema.user)
          .where(inArray(schema.user.id, userIds))
      : []
  } catch (error) {
    // Redis 或库抖一下不该把全班踢下线：这一轮直接放弃，下一轮再说
    console.error('Failed to verify websocket sessions', error)
    return
  }
  const byId = new Map(users.map((user) => [user.id, user]))
  const ended: Bun.ServerWebSocket<SubmissionSocketData>[] = []
  const disabled: Bun.ServerWebSocket<SubmissionSocketData>[] = []
  for (const ws of sockets) {
    const user = byId.get(ws.data.userId)
    if (user?.isDisabled) disabled.push(ws)
    else if (!checked.get(ws.data.sid) || user?.tokenVersion !== ws.data.tokenVersion) {
      ended.push(ws)
    }
  }
  // 会话没了有几种可能：在别的标签页登出、会话自己到期、改了密码。对用户都是
  // 「要重新登录」，走 session-ended 这一支
  forceLogout(ended, 'session-ended')
  forceLogout(disabled, 'account-disabled')
}

export function startSessionSweep() {
  const timer = setInterval(() => {
    void sweepSessions()
  }, SESSION_SWEEP_INTERVAL)
  timer.unref()
  return timer
}

export function submissionWebSocketHandler(): Bun.WebSocketHandler<SubmissionSocketData> {
  return {
    open(ws) {
      liveSockets.add(ws)
      ws.data.rate = { tokens: RATE_BURST, updatedAt: Date.now() }
      if (ws.data.kind === 'collab') {
        ws.data.binaryRate = {
          tokens: COLLAB_BINARY_BURST,
          updatedAt: Date.now(),
        }
        handleCollabOpen(ws)
        return
      }
      if (ws.data.kind === 'config') {
        ws.subscribe(configTopic)
        return
      }
      ws.subscribe(userSubmissionTopic(ws.data.userId))
      ws.subscribe(userEventTopic(ws.data.userId))
    },
    message(ws, message) {
      if (ws.data.kind === 'collab') {
        if (typeof message !== 'string') {
          if (!allowCollabBinary(ws)) {
            ws.close(1008, 'Too many messages')
            return
          }
          handleCollabBinary(ws, message)
          return
        }
        if (!allowMessage(ws)) {
          ws.close(1008, 'Too many messages')
          return
        }
        handleCollabMessage(ws, message).catch((error) => {
          console.error('Failed to handle collab message', error)
          ws.send(JSON.stringify({ type: 'error', message: 'Internal error' }))
        })
        return
      }
      if (!allowMessage(ws)) {
        ws.close(1008, 'Too many messages')
        return
      }
      // handleMessage 里有 DB 查询和会抛的 schema.parse。以前是裸的 `void`，
      // 库抖一下就是一个 unhandled rejection（隔壁 bridgeSubmissionEvents 两处
      // 都接住了，只有这里漏了）
      handleMessage(ws, String(message)).catch((error) => {
        console.error('Failed to handle websocket message', error)
        ws.send(JSON.stringify({ type: 'error', message: 'Internal error' }))
      })
    },
    close(ws) {
      liveSockets.delete(ws)
      if (ws.data.kind === 'collab') {
        handleCollabClose(ws)
        return
      }
      if (ws.data.kind === 'config') {
        ws.unsubscribe(configTopic)
        return
      }
      ws.unsubscribe(userSubmissionTopic(ws.data.userId))
      ws.unsubscribe(userEventTopic(ws.data.userId))
    },
  }
}

async function handleMessage(ws: Bun.ServerWebSocket<SubmissionSocketData>, raw: string) {
  let message: { type?: unknown; timestamp?: unknown; submissionId?: unknown }
  try {
    message = JSON.parse(raw) as typeof message
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
    return
  }

  // 心跳不查库。原来的顺序是「先查 user 再看消息类型」，于是每个客户端每 30 秒
  // 都要为一次 ping 打一趟数据库；一个题目页还开着两条连接，全班在线时纯空转。
  // 禁用用户不会因此漏网：往用户 topic 推之前 bridgeSubmissionEvents 会查一次，
  // 而 subscribe 这条真正读数据的路径下面照样查。
  if (message.type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong', timestamp: message.timestamp }))
    return
  }
  if (message.type !== 'subscribe' || typeof message.submissionId !== 'string') {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }))
    return
  }

  // 会话可能在连接期间就失效了：用户在别的标签页登出，或者会话自己到期。
  // 握手时校验过一次不算数 —— 这条连接能挂几个小时。
  if (!(await touchSession(ws.data.sid, ws.data.userId))) {
    ws.close(1008, 'Session expired')
    return
  }

  const [activeUser] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(eq(schema.user.id, ws.data.userId), eq(schema.user.isDisabled, false)))
    .limit(1)
  if (!activeUser) {
    ws.close(1008, 'Account disabled')
    return
  }

  const [submission] = await db
    .select({
      id: schema.submission.id,
      result: schema.submission.result,
      statisticInfo: schema.submission.statisticInfo,
    })
    .from(schema.submission)
    .where(and(eq(schema.submission.id, message.submissionId), eq(schema.submission.userId, ws.data.userId)))
    .limit(1)

  if (!submission) {
    const [flowchart] = await db
      .select({
        id: schema.flowchartSubmission.id,
        status: schema.flowchartSubmission.status,
        score: schema.flowchartSubmission.aiScore,
        grade: schema.flowchartSubmission.aiGrade,
      })
      .from(schema.flowchartSubmission)
      .where(and(eq(schema.flowchartSubmission.id, message.submissionId), eq(schema.flowchartSubmission.userId, ws.data.userId)))
      .limit(1)
    if (!flowchart) {
      ws.send(JSON.stringify({ type: 'error', message: 'Submission not found' }))
      return
    }
    const replay =
      flowchart.status === 2
        ? {
            type: 'flowchart_evaluation_completed' as const,
            submissionId: flowchart.id,
            score: flowchart.score ?? undefined,
            grade: flowchart.grade ?? undefined,
          }
        : flowchart.status === 3
          ? {
              type: 'flowchart_evaluation_failed' as const,
              submissionId: flowchart.id,
            }
          : {
              type: 'flowchart_evaluation_update' as const,
              submissionId: flowchart.id,
            }
    ws.send(JSON.stringify(replay satisfies FlowchartUpdate))
    return
  }

  const statistics = asRecord(submission.statisticInfo)
  const status =
    submission.result === JudgeStatus.PENDING
      ? 'pending'
      : submission.result === JudgeStatus.JUDGING
        ? 'judging'
        : submission.result === JudgeStatus.SYSTEM_ERROR
          ? 'error'
          : 'finished'
  const parsed = submissionUpdateSchema.safeParse({
    type: 'submission_update',
    submissionId: submission.id,
    result: submission.result,
    status,
    score: statistics.score,
  })
  if (parsed.success) ws.send(JSON.stringify(parsed.data))
}

export async function bridgeSubmissionEvents(server: Bun.Server<SubmissionSocketData>) {
  const subscriber = createSubscriberRedis()
  subscriber.on('message', (channel, raw) => {
    if (channel === configUpdateChannel) {
      // 配置广播不校验用户：内容就是站点公开配置本身，且所有连着的人都该收到
      server.publish(configTopic, raw)
      return
    }
    if (channel === sessionRevokedChannel) {
      const revoked = parseSessionRevoked(raw)
      if (!revoked) return
      // 按会话还是按 userId，取决于是「这张会话登出了」还是「这个账号被禁用 / 改密码了」
      forceLogout(
        [...liveSockets].filter((ws) => (revoked.sid !== undefined ? ws.data.sid === revoked.sid : ws.data.userId === revoked.userId)),
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
        console.error('Failed to bridge user event', error)
      })
      return
    }
    if (channel !== submissionUpdateChannel) return
    const event = parseSubmissionEvent(raw)
    if (!event) return
    // 举着手的人又判完一次：老师举手面板上他那条的错法跟着刷新（没举手的直接返回，不查库）
    if (event.data.status === 'finished') {
      refreshRequestLatest(event.userId).catch((error) => {
        console.error('Failed to refresh help request', error)
      })
    }
    const topic = userSubmissionTopic(event.userId)
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
      console.error('Failed to bridge submission event', error)
    })
  })
  // 连接层的 error 已经由 createSubscriberRedis 里的 withErrorLogging 打了
  // （带连接名），这里再挂一个只会把同一条错误打两遍
  await subscriber.subscribe(submissionUpdateChannel, userEventChannel, configUpdateChannel, sessionRevokedChannel)
  return subscriber
}

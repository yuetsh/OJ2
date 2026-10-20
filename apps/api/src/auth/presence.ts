import type { ChainableCommander } from "ioredis"

import { redis } from "../redis"
import { calendarDay } from "../time"

/**
 * 「谁现在在线」。member = userId，score = 最后一次活动的毫秒时间戳。
 *
 * 会话本身判定不了在线：`auth-session:<sid>` 的 TTL 是 7 天且每次请求都续期，
 * 「有会话」只说明这人一周内来过。所以这里单独记一个活动时间戳 ——
 * 写入一律搭在已有的 pipeline 上（登录、每个带鉴权的请求、WebSocket 巡检），
 * 不多一趟往返。
 */
const PRESENCE_KEY = "online-users"

/**
 * 多久没动就算离线。挂着页面不操作的人靠 sweepSessions 每 60 秒续一次
 * （见 websocket.ts），窗口必须明显大于那个间隔，否则开着页面的学生会一闪一闪。
 */
const ONLINE_WINDOW_MS = 5 * 60 * 1000

/**
 * 「今天谁上过线、最后一次是几点」，一天一个 key，同样是 userId → 毫秒时间戳。
 *
 * 课堂看板拿它判断谁今天没来：机房有两人共用一台电脑的，同一时刻只有一个人登着，
 * 只看「此刻在不在线」会把坐在旁边的同桌当成没来。上过线的人不管现在登没登着都算来过。
 * 上面那张会被修剪到最近 5 分钟，留不住这个，所以单记一张，放两天自己过期。
 */
const seenTodayKey = (day: string) => `online-users:${day}`
const SEEN_TODAY_TTL_SECONDS = 2 * 24 * 60 * 60

/** 记一笔活动。传 pipeline 而不是自己发命令：调用点都在热路径上 */
export function markOnline(pipeline: ChainableCommander, userId: number) {
  const now = Date.now()
  const seenKey = seenTodayKey(calendarDay(now))
  pipeline
    .zadd(PRESENCE_KEY, now, String(userId))
    .zadd(seenKey, now, String(userId))
    .expire(seenKey, SEEN_TODAY_TTL_SECONDS)
}

/**
 * 当前在线的用户 id。
 *
 * 顺手把过期成员删掉 —— 这是唯一的清理时机（整个 key 不能设 TTL：ZADD 不会重置
 * key 的 TTL，到期会把还在线的人一起抹掉）。读这张表的只有后台用户列表，
 * 不清理最坏也就是攒下全站用户数量级的成员，远谈不上要单开一个定时任务。
 */
export async function onlineUserIds() {
  const cutoff = Date.now() - ONLINE_WINDOW_MS
  const results = await redis
    .pipeline()
    .zremrangebyscore(PRESENCE_KEY, "-inf", `(${cutoff}`)
    .zrange(PRESENCE_KEY, "0", "-1")
    .exec()
  const members = (results?.[1]?.[1] ?? []) as string[]
  return new Set(members.map(Number).filter(Number.isInteger))
}

/** 登出、被禁用、被踢下线：立刻从在线名单里摘掉，别等窗口自然过期 */
export async function clearOnline(userId: number) {
  await redis.zrem(PRESENCE_KEY, String(userId))
}

/** 单个用户在不在线。列表页用上面那个，别在循环里调这个 */
export async function isUserOnline(userId: number) {
  const score = await redis.zscore(PRESENCE_KEY, String(userId))
  return score !== null && Number(score) >= Date.now() - ONLINE_WINDOW_MS
}

/**
 * 这批人今天最后一次上线的时刻（毫秒），今天没上过线的不在结果里。
 * `online` 和 onlineUserIds 同一个窗口
 */
export async function seenToday(userIds: number[]) {
  const seen = new Map<number, { at: number; online: boolean }>()
  if (!userIds.length) return seen
  const scores = await redis.zmscore(seenTodayKey(calendarDay()), ...userIds.map(String))
  const cutoff = Date.now() - ONLINE_WINDOW_MS
  userIds.forEach((userId, i) => {
    const score = scores[i]
    if (score === null || score === undefined) return
    const at = Number(score)
    seen.set(userId, { at, online: at >= cutoff })
  })
  return seen
}

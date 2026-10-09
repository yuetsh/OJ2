import type { ChainableCommander } from "ioredis"

import { redis } from "../redis"

/**
 * 「谁现在在线」。member = userId，score = 最后一次活动的毫秒时间戳。
 *
 * 会话本身判定不了在线：`session:<token>` 的 TTL 是 7 天且每次请求都续期，
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

/** 记一笔活动。传 pipeline 而不是自己发命令：调用点都在热路径上 */
export function markOnline(pipeline: ChainableCommander, userId: number) {
  pipeline.zadd(PRESENCE_KEY, Date.now(), String(userId))
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

import Redis from "ioredis"

import { config } from "./config"

/**
 * 每条连接都要挂 error 监听。
 *
 * ioredis 对没有监听者的 error 走 silentEmit —— 不会像普通 EventEmitter 那样崩进程，
 * 但会把连接错误直接 `console.error("[ioredis] Unhandled error event:", ...)` 打到
 * stderr，绕开这里的日志，而且不说是哪条连接出的事。这个进程同时开着会话读写、
 * 两条队列、一条订阅，出问题时「哪条」正是要先知道的。
 */
function withErrorLogging(client: Redis, name: string) {
  client.on("error", (error) => {
    console.error(`Redis connection error (${name})`, error)
  })
  return client
}

/**
 * 会话、限流、发布事件都走这条。`maxRetriesPerRequest: 1` 是故意的：每个带鉴权的
 * 请求都要读一次会话，Redis 不可用时快速失败成 500，比让请求挂在重试里更好。
 */
export const redis = withErrorLogging(
  new Redis(config.redisUrl, { maxRetriesPerRequest: 1 }),
  "main",
)

export function createBlockingRedis() {
  return withErrorLogging(
    new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
    "blocking",
  )
}

export function createSubscriberRedis() {
  return withErrorLogging(
    new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
    "subscriber",
  )
}

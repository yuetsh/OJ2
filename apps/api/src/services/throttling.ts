import { redis } from "../redis"
import { getOptions } from "./options"

/**
 * 令牌桶限流，搬运自旧后端 `utils/throttling.py` 的 TokenBucket。
 *
 * 参数与旧后端 `options/options.py:120` 的默认值逐字对齐：
 *   user: { capacity: 20, fill_rate: 0.03, default_capacity: 10 }
 * 和旧后端一样，实际值以数据库 `throttling` 配置项为准，缺失时用上面的默认值。
 *
 * 旧后端还有一个按 IP 计数的桶，OJ2 从来没调用过（机房整个班共用一个出口 IP，
 * 按 IP 限流等于按班限流），已随其余 IP 功能一并删除。库里 `throttling` 配置项
 * 残留的 `ip` 键读不到就忽略，不用清。
 *
 * 旧实现在注释里写明「对于单个 key 的操作不是线程安全的」；这里改用 Lua 脚本做成原子操作，
 * 算法和参数不变 —— 限流要挡的正是并发突发，读改写有竞态的话等于没挡。
 */

export type BucketConfig = {
  capacity: number
  fill_rate: number
  default_capacity: number
}

export const throttlingDefaults: Record<"user", BucketConfig> = {
  user: { capacity: 20, fill_rate: 0.03, default_capacity: 10 },
}

// KEYS[1] = bucket key
// ARGV = capacity, fill_rate, default_capacity, now(seconds), num, ttl(seconds)
const CONSUME_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local fill_rate = tonumber(ARGV[2])
local default_capacity = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local num = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])

local last_capacity = tonumber(redis.call('HGET', key, 'last_capacity'))
local last_timestamp = tonumber(redis.call('HGET', key, 'last_timestamp'))
if last_capacity == nil or last_timestamp == nil then
  last_capacity = default_capacity
  last_timestamp = now
end

local current = last_capacity + fill_rate * (now - last_timestamp)
if current > capacity then current = capacity end

local allowed = 0
local wait = 0
if current >= num then
  current = current - num
  allowed = 1
else
  wait = (num - current) / fill_rate
end

redis.call('HSET', key, 'last_capacity', tostring(current), 'last_timestamp', tostring(now))
redis.call('EXPIRE', key, ttl)
return { allowed, tostring(wait) }
`

/**
 * 注册成自定义命令而不是每次 `redis.eval`：eval 会把上面 900 多字节的脚本全文
 * 一起发过去，而限流点在提交判题、AI 分析、流程图评分上，判题高峰期每条提交都要发
 * 一遍。ioredis 的 defineCommand 走 EVALSHA，只发 40 字节的 sha1，遇到 NOSCRIPT
 * 自动回退成一次 EVAL 把脚本重新灌进去 —— Redis 重启或 SCRIPT FLUSH 之后不用管。
 */
redis.defineCommand("throttleConsume", { numberOfKeys: 1, lua: CONSUME_SCRIPT })

type ThrottleRedis = typeof redis & {
  throttleConsume(
    key: string,
    capacity: string,
    fillRate: string,
    defaultCapacity: string,
    now: string,
    num: string,
    ttl: string,
  ): Promise<[number, string]>
}

function parseBucketConfig(value: unknown, fallback: BucketConfig): BucketConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback
  const raw = value as Record<string, unknown>
  const pick = (key: keyof BucketConfig) =>
    typeof raw[key] === "number" && Number.isFinite(raw[key]) && (raw[key] as number) > 0
      ? (raw[key] as number)
      : fallback[key]
  return {
    capacity: pick("capacity"),
    fill_rate: pick("fill_rate"),
    default_capacity: pick("default_capacity"),
  }
}

/**
 * 桶参数的进程内缓存。
 *
 * 限流点在提交判题、AI 分析、流程图评分上，原来每检查一次就查一次 `throttling`
 * 配置项 —— 判题高峰期等于每条提交多一趟数据库，只为读一个几乎从不变的值。
 * 上一代在 `options/options.py` 的 my_property 里也是带 TTL 缓存的，重写时漏掉了。
 *
 * 放进程内而不是 Redis：值只有几十字节，跨进程共享省不下什么，反倒要多一趟网络。
 * `throttling` 没有后台界面，只能直接改库，改完最多一分钟后生效。
 */
const BUCKET_CACHE_TTL = 60_000
const bucketCache = new Map<"user", { value: BucketConfig; expiresAt: number }>()

export async function getBucketConfig(scope: "user"): Promise<BucketConfig> {
  const cached = bucketCache.get(scope)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const fallback = throttlingDefaults[scope]
  let value: BucketConfig
  try {
    const values = await getOptions(["throttling"])
    const throttling = values.throttling
    value = !throttling || typeof throttling !== "object" || Array.isArray(throttling)
      ? fallback
      : parseBucketConfig((throttling as Record<string, unknown>)[scope], fallback)
  } catch {
    // 读不到就退回默认值，但**不写缓存** —— 数据库抖一下不该让接下来一整分钟
    // 全站都按默认参数限流
    return fallback
  }
  bucketCache.set(scope, { value, expiresAt: Date.now() + BUCKET_CACHE_TTL })
  return value
}

export type ConsumeResult = { allowed: true } | { allowed: false; wait: number }

export async function consumeToken(
  scope: "user",
  identity: string,
  num = 1,
): Promise<ConsumeResult> {
  const bucket = await getBucketConfig(scope)
  // 桶全满需要 capacity / fill_rate 秒；留出余量后过期，避免残留 key 无限堆积。
  // 每次调用都会刷新 TTL，因此只有长时间无提交才会过期，届时桶早已回满，
  // 重新按 default_capacity 初始化只会更严，不会放水。
  const ttl = Math.ceil(bucket.capacity / bucket.fill_rate) + 60
  const result = await (redis as ThrottleRedis).throttleConsume(
    `throttling:${scope}:${identity}`,
    String(bucket.capacity),
    String(bucket.fill_rate),
    String(bucket.default_capacity),
    String(Date.now() / 1000),
    String(num),
    String(ttl),
  )
  if (Number(result[0]) === 1) return { allowed: true }
  return { allowed: false, wait: Number(result[1]) || 0 }
}

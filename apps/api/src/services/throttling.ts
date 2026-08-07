import { redis } from "../redis"
import { getOptions } from "./options"

/**
 * 令牌桶限流，搬运自旧后端 `utils/throttling.py` 的 TokenBucket。
 *
 * 参数与旧后端 `options/options.py:120` 的默认值逐字对齐：
 *   user: { capacity: 20, fill_rate: 0.03, default_capacity: 10 }
 *   ip:   { capacity: 100, fill_rate: 0.1, default_capacity: 50 }
 * 和旧后端一样，实际值以数据库 `throttling` 配置项为准，缺失时用上面的默认值。
 *
 * 旧实现在注释里写明「对于单个 key 的操作不是线程安全的」；这里改用 Lua 脚本做成原子操作，
 * 算法和参数不变 —— 限流要挡的正是并发突发，读改写有竞态的话等于没挡。
 */

export type BucketConfig = {
  capacity: number
  fill_rate: number
  default_capacity: number
}

export const throttlingDefaults: Record<"ip" | "user", BucketConfig> = {
  ip: { capacity: 100, fill_rate: 0.1, default_capacity: 50 },
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

export async function getBucketConfig(scope: "ip" | "user"): Promise<BucketConfig> {
  const fallback = throttlingDefaults[scope]
  try {
    const values = await getOptions(["throttling"])
    const throttling = values.throttling
    if (!throttling || typeof throttling !== "object" || Array.isArray(throttling)) return fallback
    return parseBucketConfig((throttling as Record<string, unknown>)[scope], fallback)
  } catch {
    return fallback
  }
}

export type ConsumeResult = { allowed: true } | { allowed: false; wait: number }

export async function consumeToken(
  scope: "ip" | "user",
  identity: string,
  num = 1,
): Promise<ConsumeResult> {
  const bucket = await getBucketConfig(scope)
  // 桶全满需要 capacity / fill_rate 秒；留出余量后过期，避免残留 key 无限堆积。
  // 每次调用都会刷新 TTL，因此只有长时间无提交才会过期，届时桶早已回满，
  // 重新按 default_capacity 初始化只会更严，不会放水。
  const ttl = Math.ceil(bucket.capacity / bucket.fill_rate) + 60
  const result = (await redis.eval(
    CONSUME_SCRIPT,
    1,
    `throttling:${scope}:${identity}`,
    String(bucket.capacity),
    String(bucket.fill_rate),
    String(bucket.default_capacity),
    String(Date.now() / 1000),
    String(num),
    String(ttl),
  )) as [number, string]
  if (Number(result[0]) === 1) return { allowed: true }
  return { allowed: false, wait: Number(result[1]) || 0 }
}

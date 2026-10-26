import { randomUUID } from 'node:crypto'

import { config } from '../config'
import { redis } from '../redis'

/**
 * 判题沙箱的名额，按池在 Redis 里数。
 *
 * 原来是四道各管各的闸：worker 判题 2、api 试运行 2、api 提交前编译检查 2、worker 里
 * 流程图评分又起一道试运行 2 —— 峰值 8 个程序同时压在服务器那两个核上，判题机按墙钟
 * 判超时（CPU 时限的 3 倍），挤到一定程度就会把本来不超时的程序判成超时。
 * api 和 worker 是两个进程，进程内的计数管不到对方，所以放 Redis。每个站点有自己的
 * Redis 和判题机，按站各数各的正好。
 *
 * 两个池，名额不互相借：
 * - `judge`：后台的 —— 正式判题、诊断重跑、流程图评分的试运行。上限 JUDGE_CONCURRENCY；
 * - `interactive`：学生在页面上等着的 —— 运行例子、自己输入、生成测试点、提交前的编译检查。
 *   上限 TRIAL_CONCURRENCY。单独留着，正式判题排再长也不会把它挤掉，反过来也一样。
 *
 * 每个名额是一份租约（有序集合里一个成员，分数是到期时刻）：拿着名额的进程被杀了，
 * 到期后自动作废，不会永远占着。Redis 出错时直接放行 —— 判题比限流要紧，
 * 而 Redis 真挂了，会话也读不出来，整站本来就不可用。
 */
export type JudgePool = 'judge' | 'interactive'

const LIMITS: Record<JudgePool, number> = {
  judge: config.judgeConcurrency,
  interactive: config.trialConcurrency,
}

// KEYS[1] = 池的有序集合
// ARGV = now(ms), expireAt(ms), token, limit
const ACQUIRE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
return 1
`

redis.defineCommand('judgeSlotAcquire', { numberOfKeys: 1, lua: ACQUIRE_SCRIPT })

type SlotRedis = typeof redis & {
  judgeSlotAcquire(key: string, now: string, expireAt: string, token: string, limit: string): Promise<number>
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 拿到一个名额再跑 `run`，跑完（不论成败）还回去。
 *
 * - `holdMs`：租约多长。要比 `run` 最长可能跑的时间长，否则跑到一半名额被别人拿走；
 *   调用方都给的是自己的请求超时再加 30 秒。
 * - `signal`：等名额等到它 abort 就放弃，抛它的 reason。不给就一直等（正式判题：
 *   job 在 BullMQ 里本来就是排着的，多等一会儿不要紧）。
 *
 * 等的方式是隔一会儿问一次（50ms 起翻倍到 500ms）。同时在等的最多也就十来个
 * （两个池的上限加上两个进程里各自排着的），这点 Redis 往返不值得为它上阻塞队列。
 */
export async function withJudgeSlot<T>(pool: JudgePool, options: { holdMs: number; signal?: AbortSignal }, run: () => Promise<T>): Promise<T> {
  const key = `judge-slots:${pool}`
  const token = randomUUID()
  let acquired = false
  for (let delay = 50; ; delay = Math.min(500, delay * 2)) {
    options.signal?.throwIfAborted()
    try {
      const now = Date.now()
      acquired = (await (redis as SlotRedis).judgeSlotAcquire(key, String(now), String(now + options.holdMs), token, String(LIMITS[pool]))) === 1
    } catch (error) {
      console.warn(`[judge-slots] Redis 不可用，不排队直接判`, error)
      return run()
    }
    if (acquired) break
    await sleep(delay, options.signal)
  }
  try {
    return await run()
  } finally {
    await redis.zrem(key, token).catch((error: unknown) => {
      // 还不回去也不要紧，租约到期自己作废
      console.warn(`[judge-slots] 归还名额失败`, error)
    })
  }
}

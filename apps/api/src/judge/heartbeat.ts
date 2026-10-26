import { cpus, freemem, totalmem } from 'node:os'

import { eq } from 'drizzle-orm'

import { config } from '../config'
import { db, schema } from '../db'
import { sandboxVersion } from './sandbox'

/**
 * 后台「判题机列表」和概览页「N 台在线」的数据来源。
 *
 * 原来的 JudgeServer 自己每 5 秒往 api 报一次心跳；go-judge 不会主动报，改成 worker
 * 每 5 秒去问一次判题机的 /version，问得通就替它记一笔。放在 worker 里而不是 api：
 * 判题是 worker 在调判题机，worker 挂了判题机再好也判不了，这时候列表里显示离线才对。
 *
 * 两个站点共用一个库、各有各的判题机，所以每台按 JUDGE_SERVER_NAME 记一行（compose 里
 * 分别是「服务器」和「机房」）。CPU、内存是 worker 所在这台机器的（和判题机是同一台），
 * 原来 JudgeServer 报的也是整机的数。
 */
const INTERVAL_MS = 5000

/** 两次采样之间整机 CPU 的忙碌比例，第一次没有上一次可比，记 0 */
let previous: { idle: number; total: number } | null = null
function cpuUsage() {
  let idle = 0
  let total = 0
  for (const cpu of cpus()) {
    idle += cpu.times.idle
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle
  }
  const last = previous
  previous = { idle, total }
  if (!last || total <= last.total) return 0
  return Math.round((1 - (idle - last.idle) / (total - last.total)) * 1000) / 10
}

async function beat() {
  const version = await sandboxVersion(AbortSignal.timeout(INTERVAL_MS))
  const now = new Date().toISOString()
  const values = {
    judgerVersion: `go-judge ${version}`,
    cpuCore: cpus().length,
    memoryUsage: Math.round((1 - freemem() / totalmem()) * 1000) / 10,
    cpuUsage: cpuUsage(),
    lastHeartbeat: now,
    serviceUrl: config.judgeServerUrl,
  }
  const [existing] = await db
    .select({ id: schema.judgeServer.id })
    .from(schema.judgeServer)
    .where(eq(schema.judgeServer.hostname, config.judgeServerName))
    .limit(1)
  if (existing) {
    await db.update(schema.judgeServer).set(values).where(eq(schema.judgeServer.id, existing.id))
  } else {
    await db.insert(schema.judgeServer).values({ ...values, hostname: config.judgeServerName, createTime: now, taskNumber: 0, isDisabled: false })
  }
}

export function startJudgeHeartbeat() {
  let failing = false
  const tick = () =>
    beat().then(
      () => {
        if (failing) console.log('[judge] 判题机又连上了')
        failing = false
      },
      (error: unknown) => {
        // 连不上就不记，后台过几秒自己显示离线。只在刚断的那一下打一行日志，别每 5 秒刷屏
        if (!failing) console.warn('[judge] 判题机连不上：', error instanceof Error ? error.message : error)
        failing = true
      },
    )
  void tick()
  const timer = setInterval(tick, INTERVAL_MS)
  return () => clearInterval(timer)
}

import { Worker } from 'bullmq'
import { writeFileSync } from 'node:fs'

import { config } from './config'
import { startJudgeHeartbeat } from './judge/heartbeat'
import { judgeQueueName, type JudgeJobData } from './judge/job'
import { failAbandonedSubmission, judgeSubmission } from './judge/run'
import { flowchartQueueName, type FlowchartJobData } from './flowchart/job'
import { evaluateFlowchart } from './flowchart/run'
import { createBlockingRedis } from './redis'

const judgeConnection = createBlockingRedis()
const flowchartConnection = createBlockingRedis()

const worker = new Worker<JudgeJobData>(judgeQueueName, async (job) => judgeSubmission(job.data), {
  connection: judgeConnection,
  concurrency: config.judgeConcurrency,
})

const flowchartWorker = new Worker<FlowchartJobData>(
  flowchartQueueName,
  // attemptsMade 是「此前已经失败过几次」，当前这次还没计进去，
  // 所以最后一次尝试的判据是 attemptsMade + 1 >= attempts
  async (job) =>
    evaluateFlowchart(job.data, {
      isFinalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
    }),
  { connection: flowchartConnection, concurrency: 2 },
)

worker.on('ready', () => {
  console.log(`Judge worker ready (concurrency=${config.judgeConcurrency})`)
})
worker.on('failed', async (job, error) => {
  console.error(`Judge job ${job?.id ?? 'unknown'} failed`, error)
  // 队列没配 attempts，失败即终局；worker 被杀掉那种 BullMQ 走完 stalled 重试也会
  // 落到这里。不在这里写一个终态，提交就永远停在「等待评分」，没有任何人会再管它。
  const submissionId = job?.data.submissionId
  if (!submissionId) return
  try {
    await failAbandonedSubmission(submissionId, error)
  } catch (markError) {
    console.error(`Failed to mark submission ${submissionId} as system error`, markError)
  }
})
worker.on('error', (error) => {
  console.error('Judge worker error', error)
})
flowchartWorker.on('ready', () => console.log('Flowchart worker ready (concurrency=2)'))
flowchartWorker.on('failed', (job, error) => console.error(`Flowchart job ${job?.id ?? 'unknown'} failed`, error))
flowchartWorker.on('error', (error) => console.error('Flowchart worker error', error))

const stopHeartbeat = startJudgeHeartbeat()

/**
 * 给 `oj2-api healthcheck --worker` 看的「还活着」：两个消费者都在跑、连 Redis 的连接都正常，
 * 才每 10 秒刷一次时间戳。事件循环卡死、和 Redis 断了、消费者停了，时间戳都会停下来，
 * 容器就被判成 unhealthy —— 原来 worker 没有健康检查，挂死了 docker 照样显示 running，
 * 判题队列静默积压
 */
// main.ts 的 healthcheck 写死了同一个路径：那边不能 import 这个文件（一 import 就把 worker 起来了）
const WORKER_ALIVE_FILE = '/tmp/oj2-worker-alive'
const markAlive = () => {
  if (!worker.isRunning() || !flowchartWorker.isRunning()) return
  if (judgeConnection.status !== 'ready' || flowchartConnection.status !== 'ready') return
  try {
    writeFileSync(WORKER_ALIVE_FILE, String(Date.now()))
  } catch (error) {
    console.error('Failed to write worker alive file', error)
  }
}
const aliveTimer = setInterval(markAlive, 10_000)
worker.on('ready', markAlive)

async function shutdown() {
  clearInterval(aliveTimer)
  stopHeartbeat()
  await worker.close()
  await flowchartWorker.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

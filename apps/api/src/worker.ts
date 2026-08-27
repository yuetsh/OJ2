import { Worker } from "bullmq"

import { config } from "./config"
import { judgeQueueName, type JudgeJobData } from "./judge/job"
import { judgeSubmission } from "./judge/run"
import { flowchartQueueName, type FlowchartJobData } from "./flowchart/job"
import { evaluateFlowchart } from "./flowchart/run"
import { createBlockingRedis } from "./redis"

const worker = new Worker<JudgeJobData>(
  judgeQueueName,
  async (job) => judgeSubmission(job.data),
  {
    connection: createBlockingRedis(),
    concurrency: config.judgeConcurrency,
  },
)

const flowchartWorker = new Worker<FlowchartJobData>(
  flowchartQueueName,
  // attemptsMade 是「此前已经失败过几次」，当前这次还没计进去，
  // 所以最后一次尝试的判据是 attemptsMade + 1 >= attempts
  async (job) => evaluateFlowchart(job.data, {
    isFinalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
  }),
  { connection: createBlockingRedis(), concurrency: 2 },
)

worker.on("ready", () => {
  console.log(`Judge worker ready (concurrency=${config.judgeConcurrency})`)
})
worker.on("failed", (job, error) => {
  console.error(`Judge job ${job?.id ?? "unknown"} failed`, error)
})
worker.on("error", (error) => {
  console.error("Judge worker error", error)
})
flowchartWorker.on("ready", () => console.log("Flowchart worker ready (concurrency=2)"))
flowchartWorker.on("failed", (job, error) => console.error(`Flowchart job ${job?.id ?? "unknown"} failed`, error))
flowchartWorker.on("error", (error) => console.error("Flowchart worker error", error))

async function shutdown() {
  await worker.close()
  await flowchartWorker.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

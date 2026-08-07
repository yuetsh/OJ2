import { Worker } from "bullmq"

import { config } from "./config"
import { judgeQueueName, type JudgeJobData } from "./judge/job"
import { judgeSubmission } from "./judge/run"
import { createBlockingRedis } from "./redis"

const worker = new Worker<JudgeJobData>(
  judgeQueueName,
  async (job) => judgeSubmission(job.data),
  {
    connection: createBlockingRedis(),
    concurrency: config.judgeConcurrency,
  },
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

async function shutdown() {
  await worker.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

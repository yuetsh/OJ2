import { Queue } from "bullmq"

import { judgeQueueName, type JudgeJobData } from "./judge/job"
import { flowchartQueueName, type FlowchartJobData } from "./flowchart/job"
import { createBlockingRedis } from "./redis"

export const judgeQueue = new Queue<JudgeJobData>(judgeQueueName, {
  connection: createBlockingRedis(),
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
  },
})

export const flowchartQueue = new Queue<FlowchartJobData>(flowchartQueueName, {
  connection: createBlockingRedis(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
})

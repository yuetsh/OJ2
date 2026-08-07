import { Queue } from "bullmq"

import { judgeQueueName, type JudgeJobData } from "./judge/job"
import { createBlockingRedis } from "./redis"

export const judgeQueue = new Queue<JudgeJobData>(judgeQueueName, {
  connection: createBlockingRedis(),
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
  },
})

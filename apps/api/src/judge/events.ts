import {
  submissionUpdateSchema,
  type SubmissionUpdate,
} from "@oj2/contract"

import { redis } from "../redis"

export const submissionUpdateChannel = "submission:updates"

interface SubmissionEvent {
  userId: number
  data: SubmissionUpdate
}

export function userSubmissionTopic(userId: number) {
  return `submission:user:${userId}`
}

export async function publishSubmissionUpdate(
  userId: number,
  data: SubmissionUpdate,
) {
  const event: SubmissionEvent = {
    userId,
    data: submissionUpdateSchema.parse(data),
  }
  await redis.publish(submissionUpdateChannel, JSON.stringify(event))
}

export function parseSubmissionEvent(raw: string): SubmissionEvent | null {
  try {
    const value = JSON.parse(raw) as { userId?: unknown; data?: unknown }
    if (typeof value.userId !== "number") return null
    return {
      userId: value.userId,
      data: submissionUpdateSchema.parse(value.data),
    }
  } catch {
    return null
  }
}

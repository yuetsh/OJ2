import { flowchartUpdateSchema, submissionUpdateSchema } from "@oj2/contract"
import { and, eq } from "drizzle-orm"

import { db, schema } from "./db"
import {
  parseSubmissionEvent,
  submissionUpdateChannel,
  userSubmissionTopic,
} from "./judge/events"
import { JudgeStatus } from "./judge/status"
import { createSubscriberRedis } from "./redis"
import { configTopic, configUpdateChannel, parseUserEvent, userEventChannel, userEventTopic } from "./events"

export interface SubmissionSocketData {
  userId: number
  username: string
  /** 同一个 Bun.serve 只能挂一个 websocket handler，用它区分两条通道 */
  kind: "submissions" | "config"
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function submissionWebSocketHandler(): Bun.WebSocketHandler<SubmissionSocketData> {
  return {
    open(ws) {
      if (ws.data.kind === "config") {
        ws.subscribe(configTopic)
        return
      }
      ws.subscribe(userSubmissionTopic(ws.data.userId))
      ws.subscribe(userEventTopic(ws.data.userId))
    },
    message(ws, message) {
      void handleMessage(ws, String(message))
    },
    close(ws) {
      if (ws.data.kind === "config") {
        ws.unsubscribe(configTopic)
        return
      }
      ws.unsubscribe(userSubmissionTopic(ws.data.userId))
      ws.unsubscribe(userEventTopic(ws.data.userId))
    },
  }
}

async function handleMessage(
  ws: Bun.ServerWebSocket<SubmissionSocketData>,
  raw: string,
) {
  const [activeUser] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(
      and(
        eq(schema.user.id, ws.data.userId),
        eq(schema.user.isDisabled, false),
      ),
    )
    .limit(1)
  if (!activeUser) {
    ws.close(1008, "Account disabled")
    return
  }

  let message: { type?: unknown; timestamp?: unknown; submission_id?: unknown }
  try {
    message = JSON.parse(raw) as typeof message
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
    return
  }

  if (message.type === "ping") {
    ws.send(JSON.stringify({ type: "pong", timestamp: message.timestamp }))
    return
  }
  if (message.type !== "subscribe" || typeof message.submission_id !== "string") {
    ws.send(JSON.stringify({ type: "error", message: "Invalid message" }))
    return
  }

  const [submission] = await db
    .select({
      id: schema.submission.id,
      result: schema.submission.result,
      statisticInfo: schema.submission.statisticInfo,
    })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.id, message.submission_id),
        eq(schema.submission.userId, ws.data.userId),
      ),
    )
    .limit(1)

  if (!submission) {
    const [flowchart] = await db
      .select({ id: schema.flowchartSubmission.id, status: schema.flowchartSubmission.status, score: schema.flowchartSubmission.aiScore, grade: schema.flowchartSubmission.aiGrade })
      .from(schema.flowchartSubmission)
      .where(and(eq(schema.flowchartSubmission.id, message.submission_id), eq(schema.flowchartSubmission.userId, ws.data.userId)))
      .limit(1)
    if (!flowchart) {
      ws.send(JSON.stringify({ type: "error", message: "Submission not found" }))
      return
    }
    const replay = flowchart.status === 2
      ? { type: "flowchart_evaluation_completed", submission_id: flowchart.id, score: flowchart.score ?? undefined, grade: flowchart.grade ?? undefined }
      : flowchart.status === 3
        ? { type: "flowchart_evaluation_failed", submission_id: flowchart.id, error: "Evaluation failed" }
        : { type: "flowchart_evaluation_update", submission_id: flowchart.id }
    ws.send(JSON.stringify(flowchartUpdateSchema.parse(replay)))
    return
  }

  const statistics = objectValue(submission.statisticInfo)
  const status =
    submission.result === JudgeStatus.PENDING
      ? "pending"
      : submission.result === JudgeStatus.JUDGING
        ? "judging"
        : submission.result === JudgeStatus.SYSTEM_ERROR
          ? "error"
          : "finished"
  const parsed = submissionUpdateSchema.safeParse({
    type: "submission_update",
    submission_id: submission.id,
    result: submission.result,
    status,
    time_cost: statistics.time_cost,
    memory_cost: statistics.memory_cost,
    score: statistics.score,
    err_info: statistics.err_info,
  })
  if (parsed.success) ws.send(JSON.stringify(parsed.data))
}

export async function bridgeSubmissionEvents(
  server: Bun.Server<SubmissionSocketData>,
) {
  const subscriber = createSubscriberRedis()
  subscriber.on("message", (channel, raw) => {
    if (channel === configUpdateChannel) {
      // 配置广播不校验用户：内容就是站点公开配置本身，且所有连着的人都该收到
      server.publish(configTopic, raw)
      return
    }
    if (channel === userEventChannel) {
      const event = parseUserEvent(raw)
      if (!event) return
      void (async () => {
        const [activeUser] = await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(and(eq(schema.user.id, event.userId), eq(schema.user.isDisabled, false)))
          .limit(1)
        if (!activeUser) return
        server.publish(userEventTopic(event.userId), JSON.stringify(event.data))
      })().catch((error) => {
        console.error("Failed to bridge user event", error)
      })
      return
    }
    if (channel !== submissionUpdateChannel) return
    const event = parseSubmissionEvent(raw)
    if (!event) return
    void (async () => {
      const [activeUser] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(
          and(
            eq(schema.user.id, event.userId),
            eq(schema.user.isDisabled, false),
          ),
        )
        .limit(1)
      if (!activeUser) return
      server.publish(
        userSubmissionTopic(event.userId),
        JSON.stringify(event.data),
      )
    })().catch((error) => {
      console.error("Failed to bridge submission event", error)
    })
  })
  subscriber.on("error", (error) => {
    console.error("Submission event subscriber error", error)
  })
  await subscriber.subscribe(submissionUpdateChannel, userEventChannel, configUpdateChannel)
  return subscriber
}

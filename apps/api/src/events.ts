import { flowchartUpdateSchema, type FlowchartUpdate } from "@oj2/contract"

import { redis } from "./redis"

export const userEventChannel = "user:events"

interface UserEvent {
  userId: number
  data: FlowchartUpdate | Record<string, unknown>
}

interface AchievementNotification {
  id: number
  name: string
  description: string
  icon: string
  rarity: string
  kind: "achievement" | "badge"
}

export function userEventTopic(userId: number) {
  return `events:user:${userId}`
}

export async function publishFlowchartUpdate(userId: number, data: FlowchartUpdate) {
  await redis.publish(userEventChannel, JSON.stringify({ userId, data: flowchartUpdateSchema.parse(data) }))
}

export async function publishAchievementNotification(
  userId: number,
  achievements: AchievementNotification[],
) {
  if (!achievements.length) return
  await redis.publish(userEventChannel, JSON.stringify({
    userId,
    data: { type: "achievement_unlocked", achievements },
  }))
}

export function parseUserEvent(raw: string): UserEvent | null {
  try {
    const value = JSON.parse(raw) as UserEvent
    if (!Number.isInteger(value.userId) || !value.data || typeof value.data !== "object") return null
    return value
  } catch {
    return null
  }
}

import { z } from "zod"

export const achievementRaritySchema = z.enum(["bronze", "silver", "gold", "platinum"])

export const achievementSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  rarity: achievementRaritySchema,
  hidden: z.boolean(),
  metric: z.string().nullable(),
  operator: z.enum(["gte", "lte"]).nullable(),
  threshold: z.number().int().nullable(),
  unlocked: z.boolean(),
  unlockTime: z.string().nullable(),
  backfilled: z.boolean(),
  progress: z.number().nullable(),
  unlockRate: z.number(),
})

export const achievementListSchema = z.object({
  username: z.string(),
  achievements: z.array(achievementSchema),
})

export const pendingAchievementSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  rarity: achievementRaritySchema,
})

export const achievementRarityStatSchema = z.object({
  rarity: achievementRaritySchema,
  label: z.string(),
  total: z.number().int(),
  unlocked: z.number().int(),
})

/**
 * WebSocket 推来的解锁通知。比 `/achievements/pending` 多一个 `kind` ——
 * 题单奖章和成就来自两张表、id 会重叠，前端靠它区分（见 events.ts 的 publishAchievementNotification）。
 */
export const achievementNotificationSchema = pendingAchievementSchema.extend({
  kind: z.enum(["achievement", "badge"]),
})

export const achievementSummarySchema = z.object({
  username: z.string(),
  total: z.number().int(),
  unlocked: z.number().int(),
  percent: z.number(),
  rarity: z.array(achievementRarityStatSchema),
  recent: z.array(pendingAchievementSchema),
})

export const markAchievementsReadSchema = z.object({
  ids: z.array(z.number().int()),
})

export type Achievement = z.infer<typeof achievementSchema>
export type AchievementList = z.infer<typeof achievementListSchema>
export type PendingAchievement = z.infer<typeof pendingAchievementSchema>
export type AchievementSummary = z.infer<typeof achievementSummarySchema>
export type AchievementRarity = z.infer<typeof achievementRaritySchema>
export type AchievementRarityStat = z.infer<typeof achievementRarityStatSchema>
export type AchievementNotification = z.infer<typeof achievementNotificationSchema>

export type MarkAchievementsRead = z.infer<typeof markAchievementsReadSchema>

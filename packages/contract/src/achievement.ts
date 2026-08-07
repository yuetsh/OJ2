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

export const achievementSummarySchema = z.object({
  username: z.string(),
  total: z.number().int(),
  unlocked: z.number().int(),
  percent: z.number(),
  rarity: z.array(z.object({
    rarity: achievementRaritySchema,
    label: z.string(),
    total: z.number().int(),
    unlocked: z.number().int(),
  })),
  recent: z.array(pendingAchievementSchema),
})

export const markAchievementsReadSchema = z.object({
  ids: z.array(z.number().int()),
})

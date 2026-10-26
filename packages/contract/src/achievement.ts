import { z } from 'zod'

export const achievementRaritySchema = z.enum(['bronze', 'silver', 'gold', 'platinum'])

export const achievementSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  rarity: achievementRaritySchema,
  hidden: z.boolean(),
  metric: z.string().nullable(),
  operator: z.enum(['gte', 'lte']).nullable(),
  threshold: z.number().int().nullable(),
  unlocked: z.boolean(),
  unlockTime: z.string().nullable(),
  backfilled: z.boolean(),
  /** 连续几周那一串给的是「现在连着几周」，不是历史最长 —— 要拿下一档得从现在数起 */
  progress: z.number().nullable(),
  /** 全站几人有 */
  holders: z.number().int(),
  /** 本班（被看的人的班）几人有；没有班级是 null */
  classHolders: z.number().int().nullable(),
})

/** 「本班」那张卡：只在看自己、而且有班级时给 */
export const achievementClassBoardSchema = z.object({
  className: z.string(),
  /** 本班最近拿到的（补发的不算），新的在前 */
  recent: z.array(
    z.object({
      username: z.string(),
      achievementId: z.number().int(),
      unlockTime: z.string(),
    }),
  ),
  /** 本班成就最多的前几名；一样多的名次相同，先拿到的排前面 */
  most: z.array(
    z.object({
      username: z.string(),
      count: z.number().int(),
      rank: z.number().int(),
    }),
  ),
  /** 自己不在 most 里时的名次；不计入排名的人是 null */
  me: z.object({ rank: z.number().int(), count: z.number().int() }).nullable(),
})

export const achievementListSchema = z.object({
  username: z.string(),
  achievements: z.array(achievementSchema),
  classBoard: achievementClassBoardSchema.nullable(),
})

export const pendingAchievementSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  rarity: achievementRaritySchema,
})

/**
 * WebSocket 推来的解锁通知。比 `/achievements/pending` 多一个 `kind` ——
 * 题单奖章和成就来自两张表、id 会重叠，前端靠它区分（见 events.ts 的 publishAchievementNotification）。
 */
export const achievementNotificationSchema = pendingAchievementSchema.extend({
  kind: z.enum(['achievement', 'badge']),
})

export const markAchievementsReadSchema = z.object({
  ids: z.array(z.number().int()),
})

export type Achievement = z.infer<typeof achievementSchema>
export type AchievementList = z.infer<typeof achievementListSchema>
export type PendingAchievement = z.infer<typeof pendingAchievementSchema>
export type AchievementClassBoard = z.infer<typeof achievementClassBoardSchema>
export type AchievementRarity = z.infer<typeof achievementRaritySchema>
export type AchievementNotification = z.infer<typeof achievementNotificationSchema>

export type MarkAchievementsRead = z.infer<typeof markAchievementsReadSchema>

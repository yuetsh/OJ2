import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"
import { userProfileSchema } from "./auth"

export const registerRequestSchema = z.object({
  username: z.string().trim().min(1).max(32),
  email: z.email().max(64),
  password: z.string().min(6).max(20),
})

export const updateProfileRequestSchema = z.object({
  realName: z.string().max(32).nullable().optional(),
  avatar: z.string().max(256).optional(),
  mood: z.string().max(256).nullable().optional(),
})

export const metricsSchema = z.object({
  now: z.string(),
  latest: z.string(),
  first: z.string(),
})

export const rankProfileSchema = z.object({
  id: z.number().int(),
  user: sampleUserSchema,
  acceptedNumber: z.number().int(),
  submissionNumber: z.number().int(),
  mood: z.string().nullable(),
})

/**
 * 榜单里「我」的位置。`rank` 是**全服名次**，与当前翻到第几页无关 ——
 * 前 100 名之外的学生也拿得到，页面靠它单独显示一行。
 *
 * 名次口径与列表的排序完全一致（AC 降序 → 提交数升序 → id 升序），
 * 所以「我的名次」和「我在表格里的行号」永远对得上；三个键都相同才算并列。
 */
export const myRankSchema = rankProfileSchema.extend({
  rank: z.number().int().positive(),
})

export const userRankSchema = paginatedSchema(rankProfileSchema).extend({
  /** 未登录、或身份不入榜（教师/超管）时为 null */
  me: myRankSchema.nullable(),
})

export const activityRankItemSchema = z.object({
  username: z.string(),
  count: z.number().int().nonnegative(),
})

export const problemRankSchema = z.object({
  className: z.string(),
  rank: z.number().int(),
  classAcCount: z.number().int().nonnegative(),
  allAcCount: z.number().int().nonnegative(),
})

export const publicProfileSchema = userProfileSchema

export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
export type ProblemRank = z.infer<typeof problemRankSchema>
export type RankProfile = z.infer<typeof rankProfileSchema>
export type UserRank = z.infer<typeof userRankSchema>
export type MyRank = z.infer<typeof myRankSchema>
export type ActivityRankItem = z.infer<typeof activityRankItemSchema>
export type Metrics = z.infer<typeof metricsSchema>

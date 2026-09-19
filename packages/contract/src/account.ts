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
  /** 有提交的日历天数（东八区），不是首末提交之间跨了多少天 */
  activeDays: z.number().int(),
})

export const rankProfileSchema = z.object({
  id: z.number().int(),
  user: sampleUserSchema,
  acceptedNumber: z.number().int(),
  submissionNumber: z.number().int(),
  mood: z.string().nullable(),
  /**
   * 在线与否。**null 表示「这个调用方不该知道」** —— 学生之间互相盯着谁在刷题
   * 不合适，所以只对老师及以上下发 true/false，其余一律 null。
   * 三态是有意的：写成 boolean 的话，学生看到的 false 和真的离线分不开。
   */
  isOnline: z.boolean().nullable().default(null),
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

/**
 * 周榜的一行。`solvedCount` 是**本周首次 AC 的题目数** —— 不是「本周 AC 过的去重题数」。
 * 后者会把上周就做出来的题重交一次也算成本周成绩，等于给刷榜留了个口子；
 * 而周榜的全部意义是「这一周你往前走了多少」，只有首次通过才算往前走。
 */
export const weeklyRankItemSchema = z.object({
  user: sampleUserSchema,
  solvedCount: z.number().int().positive(),
  submissionCount: z.number().int().nonnegative(),
  rank: z.number().int().positive(),
})

export const weeklyRankSchema = z.object({
  /** 本周一 0:00（东八区）对应的 UTC 时刻，前端拿它显示统计区间 */
  start: z.string(),
  scope: z.enum(["global", "class"]),
  /** `scope = "class"` 时是我的班号，全服榜为 null */
  className: z.string().nullable(),
  /** 本周有新增 AC 的总人数。榜面只回前几名，这个数是全量 */
  total: z.number().int().nonnegative(),
  results: z.array(weeklyRankItemSchema),
  /**
   * 我这周的位置。**本周一题没做出来就是 null**，和「没登录」「身份不入榜」同一个值 ——
   * 这三种情况前端都该显示「做出 1 题就能上榜」那句，不需要区分。
   */
  me: weeklyRankItemSchema.nullable(),
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
export type WeeklyRankItem = z.infer<typeof weeklyRankItemSchema>
export type WeeklyRank = z.infer<typeof weeklyRankSchema>
export type Metrics = z.infer<typeof metricsSchema>

export type PublicProfile = z.infer<typeof publicProfileSchema>

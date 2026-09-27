import { z } from "zod"

export const classRankItemSchema = z.object({
  className: z.string(),
  userCount: z.number().int(),
  totalAc: z.number().int(),
  totalSubmission: z.number().int(),
  avgAc: z.number(),
  acRate: z.number(),
  rank: z.number().int(),
})

export const classUserRankItemSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  acceptedNumber: z.number().int(),
  submissionNumber: z.number().int(),
  rank: z.number().int(),
})

export const classUserRankSchema = z.object({
  className: z.string(),
  myRank: z.number().int(),
  total: z.number().int(),
  ranks: z.array(classUserRankItemSchema),
})

export const classComparisonSchema = z.object({
  className: z.string(),
  userCount: z.number().int(),
  totalAc: z.number().int(),
  totalSubmission: z.number().int(),
  avgAc: z.number(),
  medianAc: z.number(),
  q1Ac: z.number(),
  q3Ac: z.number(),
  iqr: z.number(),
  stdDev: z.number(),
  top10Avg: z.number(),
  middle80Avg: z.number(),
  bottom10Avg: z.number(),
  excellentRate: z.number(),
  passRate: z.number(),
  activeRate: z.number(),
  acRate: z.number(),
  compositeScore: z.number(),
  recentTotalAc: z.number().int().optional(),
  recentTotalSubmission: z.number().int().optional(),
  recentAvgAc: z.number().optional(),
  recentMedianAc: z.number().optional(),
  recentTop10Avg: z.number().optional(),
  recentActiveCount: z.number().int().optional(),
})

export const classComparisonRequestSchema = z.object({
  classNames: z.array(z.string()).min(1),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
})

export const classComparisonResponseSchema = z.object({
  comparisons: z.array(classComparisonSchema),
  hasTimeRange: z.boolean(),
})

/**
 * 「班里在做」：同班同一天有好几个人做的题，基本就是老师在课上点名的那几道。
 * `day` 是东八区日历日；最近 7 天都没有这样的题时为 null，`problems` 为空。
 */
export const classActivityProblemSchema = z.object({
  problemDisplayId: z.string(),
  title: z.string(),
  /** 那天做过这道题的同班人数（含自己） */
  userCount: z.number().int(),
  /** 其中那天通过了的人数 */
  acceptedCount: z.number().int(),
  /** 我自己在题库里（不含比赛）做这道题的状态，不限那一天 */
  myStatus: z.enum(["accepted", "tried", "none"]),
})

export const classActivitySchema = z.object({
  className: z.string().nullable(),
  day: z.string().nullable(),
  problems: z.array(classActivityProblemSchema),
})

export type ClassRankItem = z.infer<typeof classRankItemSchema>
export type ClassUserRank = z.infer<typeof classUserRankSchema>
export type ClassComparison = z.infer<typeof classComparisonSchema>
export type ClassComparisonResponse = z.infer<typeof classComparisonResponseSchema>

export type ClassActivity = z.infer<typeof classActivitySchema>
export type ClassActivityProblem = z.infer<typeof classActivityProblemSchema>

export type ClassUserRankItem = z.infer<typeof classUserRankItemSchema>
export type ClassComparisonRequest = z.infer<typeof classComparisonRequestSchema>

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

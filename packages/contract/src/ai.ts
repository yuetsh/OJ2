import { z } from "zod"

export const durationDataSchema = z.object({
  unit: z.string(),
  index: z.number().int(),
  start: z.string(),
  end: z.string(),
  grade: z.string(),
  problemCount: z.number().int(),
  submissionCount: z.number().int(),
})

export const solvedProblemSchema = z.object({
  problem: z.object({
    title: z.string(),
    displayId: z.string(),
    contestTitle: z.string(),
    contestId: z.number().int().nullable(),
  }),
  acTime: z.string(),
  rank: z.number().int().nullable(),
  acCount: z.number().int(),
  grade: z.string(),
  periodRank: z.number().int().nullable(),
  periodAcCount: z.number().int(),
  difficulty: z.string(),
})

export const flowchartSummarySchema = z.object({
  problemId: z.string(),
  problemTitle: z.string(),
  submissionCount: z.number().int(),
  bestScore: z.number(),
  bestGrade: z.string(),
  latestSubmissionTime: z.string(),
  avgScore: z.number(),
})

export const aiDetailSchema = z.object({
  user: z.string(),
  className: z.string().nullable(),
  start: z.string(),
  end: z.string(),
  solved: z.array(solvedProblemSchema),
  flowcharts: z.array(flowchartSummarySchema),
  grade: z.string(),
  tags: z.record(z.string(), z.number().int()),
  difficulty: z.record(z.string(), z.number().int()),
  contestCount: z.number().int(),
})

export const aiAnalysisRequestSchema = z.object({
  details: z.unknown(),
  duration: z.unknown(),
})

export const aiHintRequestSchema = z.object({ submissionId: z.string().min(1) })

export const classAnalysisRequestSchema = z.object({
  comparison: z.record(z.string(), z.unknown()),
})

export const classPkAnalysisRequestSchema = z.object({
  comparisons: z.array(z.record(z.string(), z.unknown())).min(2),
  timeRangeLabel: z.string().default("全部时间"),
})

export const heatmapItemSchema = z.object({
  timestamp: z.number(),
  value: z.number().int(),
})

export const aiAnalysisRecordSchema = z.object({
  id: z.number().int(),
  provider: z.string(),
  model: z.string(),
  data: z.record(z.string(), z.unknown()),
  analysis: z.string(),
  createTime: z.string(),
  isPinned: z.boolean(),
  username: z.string().optional(),
})

export const loginSummarySchema = z.object({
  summary: z.object({
    start: z.string(),
    end: z.string(),
    newProblemCount: z.number().int(),
    submissionCount: z.number().int(),
    acceptedCount: z.number().int(),
    solvedCount: z.number().int(),
    flowchartSubmissionCount: z.number().int(),
  }),
  analysis: z.string(),
  analysisError: z.string().optional(),
})

import { z } from "zod"

/**
 * 评级。`grade()` 返回 S/A/B/C，`averageGrade()` 在没有可用数据时返回空串 ——
 * 空串是真会下发的值，别把它从这里去掉，前端要按「无评级」处理。
 */
export const gradeSchema = z.enum(["S", "A", "B", "C", ""])

export const durationDataSchema = z.object({
  unit: z.string(),
  index: z.number().int(),
  start: z.string(),
  end: z.string(),
  grade: gradeSchema,
  problemCount: z.number().int(),
  /** 该周期内判为通过的提交数。problemCount 是去重后的题数，两者不能互相代替 */
  acceptedCount: z.number().int(),
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
  grade: gradeSchema,
  periodRank: z.number().int().nullable(),
  periodAcCount: z.number().int(),
  difficulty: z.string(),
  /** 到首次通过为止在这道题上提交了几次（含通过那次）。1 就是一次过 */
  attempts: z.number().int(),
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

/**
 * 时间活跃度的一个格子。星期和时段都按东八区切，和热力图同一个口径 ——
 * 别让容器或数据库的 TZ 决定「学生周几晚上做题多」。
 */
export const activityBucketSchema = z.object({
  /** 0=周日 … 6=周六 */
  weekday: z.number().int().min(0).max(6),
  /** 0=凌晨(0-6) 1=上午(6-12) 2=下午(12-18) 3=晚上(18-24) */
  period: z.number().int().min(0).max(3),
  count: z.number().int(),
})

export const aiDetailSchema = z.object({
  user: z.string(),
  className: z.string().nullable(),
  start: z.string(),
  end: z.string(),
  solved: z.array(solvedProblemSchema),
  flowcharts: z.array(flowchartSummarySchema),
  grade: gradeSchema,
  tags: z.record(z.string(), z.number().int()),
  difficulty: z.record(z.string(), z.number().int()),
  contestCount: z.number().int(),
  /** 时间活跃度：按**全部提交**统计，不是只统计 AC */
  activity: z.array(activityBucketSchema),
  /**
   * 判完的失败提交按状态码分组，多的在前。状态码是落库的值，
   * 前端用 utils/constants 的 JUDGE_STATUS 翻成中文，两边必须一致。
   */
  errors: z.array(z.object({
    result: z.number().int(),
    count: z.number().int(),
  })),
  /**
   * solved 里的 rank/acCount 是在哪个范围里排的。班里只有一个人时后端会回退到全服，
   * 前端不能只看 className 有没有值就写「班级排名」。
   */
  rankScope: z.enum(["class", "global"]),
})

/**
 * 请求只说「看谁、哪段时间、按什么粒度」，学情数据由服务端自己算。
 * 以前是 `details: z.unknown()` / `duration: z.unknown()` —— 前端算好的整包 POST 回去，
 * 原样进 prompt 又原样写进 ai_analysis 表，等于让任何登录用户决定喂给模型什么。
 */
export const aiAnalysisRequestSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  duration: z.string().min(1),
  username: z.string().optional(),
})

export const aiHintRequestSchema = z.object({ submissionId: z.string().min(1) })

export const classAnalysisRequestSchema = z.object({
  comparison: z.record(z.string(), z.unknown()),
})

export const classPkAnalysisRequestSchema = z.object({
  comparisons: z.array(z.record(z.string(), z.unknown())).min(2),
  timeRangeLabel: z.string().default("全部时间"),
})

/**
 * 热力图的一格 = **一周**（不是一天）。timestamp 是那一周周一的本地零点，
 * value 是整周的提交次数。按天切的话一年 365 格里三百多格是空的，
 * 中职学生一年也就在二三十天有提交，整张图看着像没用过。
 */
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

export type Grade = z.infer<typeof gradeSchema>
export type DurationData = z.infer<typeof durationDataSchema>
export type SolvedProblem = z.infer<typeof solvedProblemSchema>
export type FlowchartSummary = z.infer<typeof flowchartSummarySchema>
export type ActivityBucket = z.infer<typeof activityBucketSchema>
export type AiDetail = z.infer<typeof aiDetailSchema>
export type HeatmapItem = z.infer<typeof heatmapItemSchema>
export type AiAnalysisRecord = z.infer<typeof aiAnalysisRecordSchema>
export type LoginSummary = z.infer<typeof loginSummarySchema>

export type AiAnalysisRequest = z.infer<typeof aiAnalysisRequestSchema>
export type AiHintRequest = z.infer<typeof aiHintRequestSchema>
export type ClassAnalysisRequest = z.infer<typeof classAnalysisRequestSchema>
export type ClassPkAnalysisRequest = z.infer<typeof classPkAnalysisRequestSchema>

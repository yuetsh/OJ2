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
  /** teacher = 老师在课堂看板里布置的；inferred = 从同班提交记录推断的 */
  source: z.enum(["teacher", "inferred"]).nullable(),
  problems: z.array(classActivityProblemSchema),
})

/** 课堂看板里老师布置这节课的题：按输入顺序给展示题号，最多 20 道，空数组 = 清掉 */
export const classLessonRequestSchema = z.object({
  className: z.string().trim().min(1),
  problemDisplayIds: z.array(z.string().trim().min(1)).max(20),
})

export const classBoardProblemSchema = z.object({
  problemId: z.number().int(),
  problemDisplayId: z.string(),
  title: z.string(),
})

export const classBoardCellSchema = z.object({
  /** accepted 看的是题库里（不含比赛）有没有通过过，不限今天 —— 以前做过的也算做完 */
  status: z.enum(["accepted", "tried", "none"]),
  /** 今天在这道题上交了几次 */
  attempts: z.number().int(),
  /** 第一次通过的时刻；今天之前通过的，前端显示成「之前」 */
  acceptedAt: z.string().nullable(),
})

export const classBoardStudentSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  realName: z.string().nullable(),
  /** 和 problems 同序 */
  cells: z.array(classBoardCellSchema),
  /** 今天最后一次提交（任何题），没交过为 null */
  lastSubmitAt: z.string().nullable(),
  /** 最近几节课（不含今天，个数见 ClassBoard.recentLessons）里交过题的有几节 */
  recentAttended: z.number().int(),
})

/**
 * 课堂看板：一个班、今天、这节课的几道题 × 全班学生。
 * className 为 null = 没指定班级、最近两小时也没有哪个班在交（没法猜）。
 */
export const classBoardSchema = z.object({
  className: z.string().nullable(),
  day: z.string(),
  source: z.enum(["teacher", "inferred"]).nullable(),
  problems: z.array(classBoardProblemSchema),
  students: z.array(classBoardStudentSchema),
  /**
   * 「最近几节课」一共几节（最多 5，不含今天）。一节课 = 这个班同学一起做题的一天
   * （同班同一天 ≥ 5 人做同一道题，和「班里在做」同一个判据）。新班、开学头几周不满 5。
   */
  recentLessons: z.number().int(),
})

export type ClassRankItem = z.infer<typeof classRankItemSchema>
export type ClassUserRank = z.infer<typeof classUserRankSchema>
export type ClassComparison = z.infer<typeof classComparisonSchema>
export type ClassComparisonResponse = z.infer<typeof classComparisonResponseSchema>

export type ClassActivity = z.infer<typeof classActivitySchema>
export type ClassLessonRequest = z.infer<typeof classLessonRequestSchema>
export type ClassBoard = z.infer<typeof classBoardSchema>
export type ClassBoardProblem = z.infer<typeof classBoardProblemSchema>
export type ClassBoardStudent = z.infer<typeof classBoardStudentSchema>
export type ClassBoardCell = z.infer<typeof classBoardCellSchema>
export type ClassActivityProblem = z.infer<typeof classActivityProblemSchema>

export type ClassUserRankItem = z.infer<typeof classUserRankItemSchema>
export type ClassComparisonRequest = z.infer<typeof classComparisonRequestSchema>

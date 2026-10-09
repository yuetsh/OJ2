import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"
import { maskedProblemDifficultySchema } from "./problem"

/**
 * 我在这份题单里的进度。
 *
 * 两个计数口径不同，别混用：
 *   - completedCount / totalCount 只数**必做题**，进度条和「做完了」看它；
 *   - solvedCount 数做对的**全部**题（含选做），「做对 N 道」奖章看它 ——
 *     和后端 eligibleForBadge 的 problem_count 同一个口径。
 */
export const problemSetUserProgressSummarySchema = z.object({
  isJoined: z.boolean(),
  joinTime: z.string().nullable(),
  completedCount: z.number().int(),
  totalCount: z.number().int(),
  solvedCount: z.number().int(),
  isCompleted: z.boolean(),
  completeTime: z.string().nullable(),
})

/** 奖章只有两种条件：全部做完、做对 N 道（「总分达到 N」随分数一起拿掉了，0026 换算过） */
export const badgeConditionTypeSchema = z.enum(["all_problems", "problem_count"])

export const problemSetBadgeSchema = z.object({
  id: z.number().int(),
  problemSetId: z.number().int(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  conditionType: badgeConditionTypeSchema,
  conditionValue: z.number().int(),
  isEarned: z.boolean().optional(),
  /** 我拿到它的时刻；没拿到、没登录为 null */
  earnedTime: z.string().nullable().optional(),
})

export const problemSetSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  createdBy: sampleUserSchema,
  createTime: z.string(),
  /** 布置到哪天（东八区当天结束的时刻）；null = 没布置 */
  assignedUntil: z.string().nullable(),
  /** 现在是不是在布置期内。服务端按自己的钟算好，前端不用拿本机时间去比 */
  assigning: z.boolean(),
  /** 全部题数（含选做） */
  problemsCount: z.number().int(),
  /** 必做题数（一道必做都没标时等于全部题数）——「做完」的分母，没加入时也要用 */
  requiredCount: z.number().int(),
  /** 加入过的人数 */
  joinedCount: z.number().int(),
  userProgress: problemSetUserProgressSummarySchema,
  badges: z.array(problemSetBadgeSchema),
})

export const problemSetListSchema = paginatedSchema(problemSetSchema)

/**
 * 题单页的题目行只渲染题号、标题，所以只下发这几样（外加题目主键）。
 * 以前复用 problemListItemSchema，服务端每次要多 join 一次 user / 标签表，
 * 而那些字段题单页一个都不渲染。
 */
export const problemSetProblemItemSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
  difficulty: maskedProblemDifficultySchema,
})

export const problemSetProblemSchema = z.object({
  id: z.number().int(),
  problemSetId: z.number().int(),
  problem: problemSetProblemItemSchema,
  order: z.number().int(),
  isRequired: z.boolean(),
  /** 在这份题单里做对了没有（代码通过，或流程图拿到 A / S） */
  isCompleted: z.boolean(),
  /** 在这份题单里做对的时刻 */
  solvedTime: z.string().nullable(),
  /** 在这份题单里交错了几次（还没做对时显示「交过 n 次」） */
  wrongCount: z.number().int(),
  /**
   * 布置期内、以前做对过、旧代码正被藏着 —— 行上标「以前做对过 · 旧代码先藏着」。
   * 规则见后端 services/problemset.ts 的 problemSetLockCutoffs
   */
  oldCodeHidden: z.boolean(),
})

export const joinProblemSetRequestSchema = z.object({
  problemSetId: z.number().int().positive(),
})

/** 老师看某个班在这份题单里的情况：真名 × 每道题 */
export const problemSetClassCellSchema = z.object({
  /** 在题单里做对的时刻 */
  solvedTime: z.string().nullable(),
  /** 在题单里交错的次数 */
  wrongCount: z.number().int(),
  /** 加入之前就做对过这道题（任何入口） */
  solvedBefore: z.boolean(),
})

export const problemSetClassStudentSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  realName: z.string().nullable(),
  /** 没加入为 null */
  joinTime: z.string().nullable(),
  /** 做对的必做题数 */
  completedCount: z.number().int(),
  cells: z.array(problemSetClassCellSchema),
})

export const problemSetClassViewSchema = z.object({
  /** 加入过这份题单的学生分属哪些班：三分之一以上的人加入了的班在前（按最近一次加入），零星几个人的在后 */
  classes: z.array(
    z.object({ className: z.string(), joined: z.number().int(), size: z.number().int() }),
  ),
  /** 这次看的是哪个班；谁都没加入时为 null */
  className: z.string().nullable(),
  problems: z.array(
    z.object({
      id: z.number().int(),
      _id: z.string(),
      title: z.string(),
      isRequired: z.boolean(),
      /** 这个班在题单里做对的人数 */
      solved: z.number().int(),
    }),
  ),
  /** 必做题数（全是选做时等于全部题数），「做完」的分母 */
  totalCount: z.number().int(),
  /** 这个班的全部学生（按学号），没加入的 joinTime 为 null */
  students: z.array(problemSetClassStudentSchema),
})

/** 某道题为什么藏着旧代码：落在哪些正在布置的题单里 */
export const problemSetLockSchema = z.object({
  problemSetId: z.number().int(),
  title: z.string(),
  assignedUntil: z.string(),
})

export const userBadgeSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  badge: problemSetBadgeSchema,
  earnedTime: z.string(),
  problemSet: z.object({ id: z.number().int(), title: z.string() }),
})

export type ProblemSet = z.infer<typeof problemSetSchema>
export type ProblemSetList = z.infer<typeof problemSetListSchema>
export type ProblemSetBadge = z.infer<typeof problemSetBadgeSchema>
export type ProblemSetProblem = z.infer<typeof problemSetProblemSchema>
export type ProblemSetClassView = z.infer<typeof problemSetClassViewSchema>
export type ProblemSetClassStudent = z.infer<typeof problemSetClassStudentSchema>
export type ProblemSetLock = z.infer<typeof problemSetLockSchema>
export type UserBadge = z.infer<typeof userBadgeSchema>
export type BadgeConditionType = z.infer<typeof badgeConditionTypeSchema>

export type ProblemSetUserProgressSummary = z.infer<typeof problemSetUserProgressSummarySchema>
export type JoinProblemSetRequest = z.infer<typeof joinProblemSetRequestSchema>

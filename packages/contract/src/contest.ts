import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"
import { problemDetailSchema, problemListItemSchema } from "./problem"

export const contestStatusSchema = z.enum(["-1", "0", "1"])

export const contestSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  tag: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  createTime: z.string(),
  lastUpdateTime: z.string(),
  createdBy: sampleUserSchema,
  status: contestStatusSchema,
  contestType: z.enum(["Public", "Password Protected"]),
  now: z.string().optional(),
  /** 列表才带：几道题（可见的）、几个学生交过题 */
  problemCount: z.number().int().optional(),
  participantCount: z.number().int().optional(),
  /**
   * 列表才带，登录了才有：我在这场里的成绩，没参加是 null。
   * `rank` 在期中 / 期末进行中是 null —— 那时排名不公布（见 {@link isExamTag}）
   */
  mine: z
    .object({
      rank: z.number().int().nullable(),
      total: z.number().int(),
      solved: z.number().int(),
    })
    .nullable()
    .optional(),
})

export const contestListSchema = paginatedSchema(contestSchema)

export const contestPasswordRequestSchema = z.object({
  password: z.string().min(1).max(128),
})

export const contestAccessSchema = z.object({ access: z.boolean() })
export const contestProblemsSchema = z.array(z.union([problemListItemSchema, problemDetailSchema]))

/**
 * `acm_contest_rank.submission_info` 的 JSONB 原文。
 *
 * 键名是**判题链路写进去的 snake_case**（历史比赛的榜单行也是这个形状），
 * 不要跟着响应字段一起改成 camelCase。只有真正提交过的题目才会有自己的键，
 * 键一旦存在，前四个字段判题链路一定会写全；`checked` 是前端本地标「已看」时补的，
 * 所以只有它可选。生产库 2401 行榜单实测全部符合。
 *
 * 原来契约这里是 `z.record(z.string(), z.unknown())`，于是前端不得不
 * 自己再声明一份 `SubmissionInfo` 去覆盖它（utils/types 的 ContestRank）。
 * 形状搬进来之后那个覆盖就没有内容了。
 */
export const contestSubmissionInfoSchema = z.object({
  is_ac: z.boolean(),
  ac_time: z.number(),
  is_first_ac: z.boolean(),
  error_number: z.number().int(),
  checked: z.boolean().optional(),
})

/**
 * 期中、期末：进行中学生看不到排名、每题做对人数、谁最先做对，考完一起公布（2026-10 用户定的）。
 * 练习照常全看得到 —— 「我需要竞争」。标签只有 练习 / 期中 / 期末 三个值
 */
export const EXAM_TAGS = ["期中", "期末"] as const
export function isExamTag(tag: string) {
  return (EXAM_TAGS as readonly string[]).includes(tag)
}

/** 榜单上一个人一道题的格子。时间都是秒，从比赛开始算 */
export const contestScoreCellSchema = z.object({
  isAc: z.boolean(),
  acTime: z.number(),
  /** 做对的题：做对前错了几次（编译失败不算）；没做对的题：到现在错了几次 */
  errors: z.number().int(),
  /** 学生里最先做对这题的（同一秒并列都算）。不用库里的 is_first_ac：老师赛中试做也会占掉它 */
  firstAc: z.boolean(),
  /** 老师在成绩页标的「看过了」 */
  checked: z.boolean(),
})

export const contestScoreRowSchema = z.object({
  /** acm_contest_rank.id，标「看过了」要用 */
  rankId: z.number().int(),
  userId: z.number().int(),
  username: z.string(),
  /** 只给老师 */
  realName: z.string().nullable(),
  className: z.string().nullable(),
  /** 名次（1 起）。排名不公布时自己那一行是 null */
  rank: z.number().int().nullable(),
  /** 5 分钟前的名次，比赛结束后是 null（名次不再变） */
  prevRank: z.number().int().nullable(),
  solved: z.number().int(),
  /** 罚时，秒：每道做对的题做对时是第几秒，加起来，错一次多 20 分钟 */
  totalTime: z.number().int(),
  /** 题目 id → 格子，只有交过的题有 */
  cells: z.record(z.string(), contestScoreCellSchema),
})

export const contestScoreProblemSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
  solvedUsers: z.number().int(),
  triedUsers: z.number().int(),
  firstSolver: z.object({ username: z.string(), acTime: z.number() }).nullable(),
})

/**
 * 比赛的整张榜，一次全给（一场最多百来人）：学生比赛页右边的名次、排名页、老师的全班情况都用它。
 * `hidden` = 期中期末进行中、看的人是学生：problems 的人数清零，rows 只有自己那一行
 */
export const contestScoreboardSchema = z.object({
  hidden: z.boolean(),
  problems: z.array(contestScoreProblemSchema),
  rows: z.array(contestScoreRowSchema),
})

/**
 * 老师看的「全班情况 / 成绩」：在榜单之外，多每个人最后一次交的时间，和没进来的人。
 * 比赛不绑班：参赛的人里，一个班来了一半以上就算这场是这个班的，没进来的从这些班的名单里找
 */
export const contestClassViewSchema = contestScoreboardSchema.extend({
  lastSubmit: z.record(z.string(), z.object({ time: z.string(), problemId: z.number().int() })),
  classes: z.array(z.string()),
  absent: z.array(
    z.object({
      userId: z.number().int(),
      username: z.string(),
      realName: z.string().nullable(),
      className: z.string().nullable(),
    }),
  ),
})

export type Contest = z.infer<typeof contestSchema>
export type ContestList = z.infer<typeof contestListSchema>
export type ContestAccess = z.infer<typeof contestAccessSchema>
export type ContestSubmissionInfo = z.infer<typeof contestSubmissionInfoSchema>

export type ContestScoreCell = z.infer<typeof contestScoreCellSchema>
export type ContestScoreRow = z.infer<typeof contestScoreRowSchema>
export type ContestScoreProblem = z.infer<typeof contestScoreProblemSchema>
export type ContestScoreboard = z.infer<typeof contestScoreboardSchema>
export type ContestClassView = z.infer<typeof contestClassViewSchema>

export type ContestStatus = z.infer<typeof contestStatusSchema>
export type ContestPasswordRequest = z.infer<typeof contestPasswordRequestSchema>
export type ContestProblems = z.infer<typeof contestProblemsSchema>

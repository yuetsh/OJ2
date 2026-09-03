import { z } from "zod"

import { paginatedSchema } from "./common"

export const judgeStatusSchema = z.union([
  z.literal(-2),
  z.literal(-1),
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(10),
])

export const createSubmissionRequestSchema = z.object({
  problemId: z.number().int().positive(),
  language: z.string().min(1).max(32),
  code: z.string().min(1).max(1024 * 1024),
  contestId: z.number().int().positive().optional(),
  /**
   * 来源题单。学生从 `/problemset/:id/problem/:pid` 那个入口提交时前端带上，
   * 后端落进 `submission.problemset_id`，提交列表据此标出「这条是刷题单刷出来的」。
   *
   * 只是**来源标记**，不参与判题、也不参与题单进度记账 —— 进度由判完之后的
   * `recordSolvedProblem` 记进所有已加入且含这道题的题单，和从哪个入口进来无关。
   * 所以这里带错了顶多是标记不准，不会影响成绩。
   */
  problemSetId: z.number().int().positive().optional(),
})

export const createSubmissionResponseSchema = z.object({
  submissionId: z.string(),
})

export const submissionDetailSchema = z.object({
  id: z.string(),
  createTime: z.string(),
  userId: z.number().int(),
  username: z.string(),
  code: z.string(),
  result: judgeStatusSchema,
  info: z.unknown(),
  language: z.string(),
  shared: z.boolean(),
  statisticInfo: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  contestId: z.number().int().nullable(),
  problemId: z.number().int(),
  /**
   * 题目的展示编号（problem._id）。**独立的 /submission/:id 页面要靠它** ——
   * 那条路由只喂 submissionID，组件拿不到 display id，而「复制回到题目」要用它
   * 拼路由。原来只给内部数字 id，于是那个按钮在这条路由上一点就抛
   * `Missing required param "problemID"`。
   */
  problemDisplayId: z.string(),
  showLink: z.boolean(),
  canUnshare: z.boolean(),
})

/**
 * 内嵌在别处（目前只有站内信）的提交对象。对齐旧后端的
 * `SubmissionSafeModelSerializer(exclude=("info", "contest", "ip"))` ——
 * 这三个键**根本不出现**，而不是出现但值为空。
 *
 * 独立成一个 schema 而不是复用 submissionDetailSchema 传空值：形状一致了，
 * 将来有人「顺手」把空值改成真值就不会变成泄露，因为这里压根没有这三个字段。
 */
export const embeddedSubmissionSchema = submissionDetailSchema
  .omit({ info: true, ip: true, contestId: true, problemId: true })
  // 旧 SubmissionSafeModelSerializer 里 problem 是
  // `SlugRelatedField(slug_field="_id")`，即**展示用题号**而非数字主键。
  // 站内信页面拿它拼 `/problem/<题号>` 链接，给数字 id 会拼出打不开的地址。
  .extend({ problem: z.string() })

/**
 * 判题进度推送。**只带前端真正要用的东西**：靠 submissionId 认领、靠 result /
 * status 决定是继续等还是去拉详情。
 *
 * 这里曾经还带着 time_cost / memory_cost / err_info —— 从 statistic_info 原样
 * 抄一份出来，前端一处都没读过。耗时和错误信息在提交详情里本来就有，判完了去
 * 拉一次就是了，不必让推送顺带背一份 JSONB 的形状。
 */
export const submissionUpdateSchema = z.object({
  type: z.literal("submission_update"),
  submissionId: z.string(),
  result: judgeStatusSchema,
  status: z.enum(["pending", "judging", "finished", "error"]),
  score: z.number().optional(),
})

export const submissionListItemSchema = z.object({
  id: z.string(),
  problem: z.string(),
  problemTitle: z.string(),
  showLink: z.boolean(),
  createTime: z.string(),
  userId: z.number().int(),
  username: z.string(),
  result: judgeStatusSchema,
  language: z.string(),
  shared: z.boolean(),
  statisticInfo: z.record(z.string(), z.unknown()),
  /**
   * 来源题单，非题单入口提交的为 null。比赛提交恒为 null（比赛题不会进题单）。
   * 历史提交里只有「当年首次 AC 那一条」有值 —— 迁移 0007 从 problemset_submission
   * 回填的就是这些，其余老提交无从判断入口，一律留空。
   */
  problemSet: z.object({ id: z.number().int(), title: z.string() }).nullable(),
})

export const submissionListSchema = paginatedSchema(submissionListItemSchema)

export const shareSubmissionRequestSchema = z.object({ shared: z.boolean() })

/**
 * 未完成学生。`realName` 是从用户名里剥掉 `ks<班级号>` 前缀后剩下的那一段，
 * 不是 user.real_name 列 —— 与 F2「真名默认不下发」不冲突：这里只有教师能看到，
 * 且教师面板的用途正是点名谁没做。
 */
export const unacceptedStudentSchema = z.object({
  username: z.string(),
  realName: z.string(),
})

export const submissionStatisticsUserSchema = z.object({
  username: z.string(),
  className: z.string().nullable(),
  submissionCount: z.number().int(),
  acceptedCount: z.number().int(),
  // 百分比数值，不带 %。旧后端返回 "85.5%" 字符串，展示格式化交给前端。
  correctRate: z.number(),
  submissionItems: z.array(
    z.object({ id: z.string(), result: judgeStatusSchema }),
  ),
})

export const submissionStatisticsSchema = z.object({
  submissionCount: z.number().int(),
  acceptedCount: z.number().int(),
  correctRate: z.number(),
  personCount: z.number().int(),
  personRate: z.number(),
  data: z.array(submissionStatisticsUserSchema),
  dataUnaccepted: z.array(unacceptedStudentSchema),
})

export const formatCodeRequestSchema = z.object({
  code: z.string().max(1024 * 1024),
  language: z.enum(["python", "c", "cpp", "sql"]),
})

export const formatCodeResponseSchema = z.object({ code: z.string() })

export type JudgeStatus = z.infer<typeof judgeStatusSchema>
export type CreateSubmissionRequest = z.infer<
  typeof createSubmissionRequestSchema
>
export type SubmissionDetail = z.infer<typeof submissionDetailSchema>
export type SubmissionUpdate = z.infer<typeof submissionUpdateSchema>
export type SubmissionStatistics = z.infer<typeof submissionStatisticsSchema>
export type SubmissionStatisticsUser = z.infer<
  typeof submissionStatisticsUserSchema
>
export type UnacceptedStudent = z.infer<typeof unacceptedStudentSchema>

export type SubmissionListItem = z.infer<typeof submissionListItemSchema>
export type SubmissionList = z.infer<typeof submissionListSchema>
export type EmbeddedSubmission = z.infer<typeof embeddedSubmissionSchema>
export type CreateSubmissionResponse = z.infer<typeof createSubmissionResponseSchema>
export type FormatCodeResponse = z.infer<typeof formatCodeResponseSchema>

export type ShareSubmissionRequest = z.infer<typeof shareSubmissionRequestSchema>
export type FormatCodeRequest = z.infer<typeof formatCodeRequestSchema>

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
  showLink: z.boolean(),
  canUnshare: z.boolean(),
})

export const submissionUpdateSchema = z.object({
  type: z.literal("submission_update"),
  submission_id: z.string(),
  result: judgeStatusSchema,
  status: z.enum(["pending", "judging", "finished", "error"]),
  time_cost: z.number().optional(),
  memory_cost: z.number().optional(),
  score: z.number().optional(),
  err_info: z.string().optional(),
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

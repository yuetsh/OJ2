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
 * 不要跟着响应字段一起改成 camelCase。字段全部可选：只有真正提交过的题目键
 * 才会出现，`checked` 更是前端在本地标「已看」时补的。
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

export const contestRankItemSchema = z.object({
  id: z.number().int(),
  user: sampleUserSchema,
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
  totalTime: z.number().int(),
  submissionInfo: z.record(z.string(), contestSubmissionInfoSchema),
  contestId: z.number().int(),
})

export const contestRankSchema = paginatedSchema(contestRankItemSchema)

export type Contest = z.infer<typeof contestSchema>
export type ContestList = z.infer<typeof contestListSchema>
export type ContestRankItem = z.infer<typeof contestRankItemSchema>
export type ContestRank = z.infer<typeof contestRankSchema>
export type ContestAccess = z.infer<typeof contestAccessSchema>
export type ContestSubmissionInfo = z.infer<typeof contestSubmissionInfoSchema>

export type ContestStatus = z.infer<typeof contestStatusSchema>
export type ContestPasswordRequest = z.infer<typeof contestPasswordRequestSchema>
export type ContestProblems = z.infer<typeof contestProblemsSchema>

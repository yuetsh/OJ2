import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"
import { userProfileSchema } from "./auth"

export const registerRequestSchema = z.object({
  username: z.string().trim().min(1).max(32),
  email: z.email().max(64),
  password: z.string().min(6).max(20),
})

/**
 * 对齐旧后端 `account/serializers.py:125,127` 的 `serializers.URLField`：
 * 这两个字段会被前端渲染成可点击链接，放任自由字符串等于允许写入
 * `javascript:` 一类的伪协议。只放行 http/https，空串与 null 表示「清空」。
 */
const linkField = z
  .string()
  .max(256)
  .refine(
    (value) => value === "" || /^https?:\/\/\S+$/i.test(value),
    "必须是以 http:// 或 https:// 开头的网址",
  )

export const updateProfileRequestSchema = z.object({
  realName: z.string().max(32).nullable().optional(),
  avatar: z.string().max(256).optional(),
  blog: linkField.nullable().optional(),
  mood: z.string().max(256).nullable().optional(),
  github: linkField.nullable().optional(),
  school: z.string().max(64).nullable().optional(),
  major: z.string().max(64).nullable().optional(),
  language: z.string().max(32).nullable().optional(),
})

export const metricsSchema = z.object({
  now: z.string(),
  latest: z.string(),
  first: z.string(),
})

export const rankProfileSchema = z.object({
  id: z.number().int(),
  user: sampleUserSchema,
  acceptedNumber: z.number().int(),
  submissionNumber: z.number().int(),
  mood: z.string().nullable(),
})

export const userRankSchema = paginatedSchema(rankProfileSchema)

export const activityRankItemSchema = z.object({
  username: z.string(),
  count: z.number().int().nonnegative(),
})

export const problemRankSchema = z.object({
  className: z.string(),
  rank: z.number().int(),
  classAcCount: z.number().int().nonnegative(),
  allAcCount: z.number().int().nonnegative(),
})

export const publicProfileSchema = userProfileSchema

export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>

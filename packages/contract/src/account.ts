import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"
import { userProfileSchema } from "./auth"

export const registerRequestSchema = z.object({
  username: z.string().trim().min(1).max(32),
  email: z.email().max(64),
  password: z.string().min(6).max(20),
})

export const updateProfileRequestSchema = z.object({
  realName: z.string().max(32).nullable().optional(),
  avatar: z.string().max(256).optional(),
  blog: z.string().max(256).nullable().optional(),
  mood: z.string().max(256).nullable().optional(),
  github: z.string().max(256).nullable().optional(),
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

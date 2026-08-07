import { z } from "zod"

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(150),
  password: z.string().min(1).max(1024),
})

export const sessionUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  email: z.string().nullable(),
  adminType: z.string(),
  problemPermission: z.string(),
  createTime: z.string().nullable(),
  lastLogin: z.string().nullable(),
  openApi: z.boolean(),
  isDisabled: z.boolean(),
  className: z.string().nullable(),
})

export const userProfileSchema = z.object({
  id: z.number().int(),
  user: sessionUserSchema,
  realName: z.string().nullable(),
  acmProblemsStatus: z.record(z.string(), z.unknown()),
  avatar: z.string(),
  blog: z.string().nullable(),
  mood: z.string().nullable(),
  github: z.string().nullable(),
  school: z.string().nullable(),
  major: z.string().nullable(),
  language: z.string().nullable(),
  acceptedNumber: z.number().int(),
  submissionNumber: z.number().int(),
})

export type LoginRequest = z.infer<typeof loginRequestSchema>
export type SessionUser = z.infer<typeof sessionUserSchema>
export type UserProfile = z.infer<typeof userProfileSchema>

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

export const contestRankItemSchema = z.object({
  id: z.number().int(),
  user: sampleUserSchema,
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
  totalTime: z.number().int(),
  submissionInfo: z.record(z.string(), z.unknown()),
  contestId: z.number().int(),
})

export const contestRankSchema = paginatedSchema(contestRankItemSchema)

export type Contest = z.infer<typeof contestSchema>
export type ContestList = z.infer<typeof contestListSchema>
export type ContestRankItem = z.infer<typeof contestRankItemSchema>
export type ContestRank = z.infer<typeof contestRankSchema>

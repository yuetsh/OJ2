import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"
import { embeddedSubmissionSchema } from "./submission"

export const announcementSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  tag: z.string(),
  content: z.string().optional(),
  top: z.boolean(),
  createdBy: sampleUserSchema,
  createTime: z.string(),
  lastUpdateTime: z.string(),
})

export const announcementListSchema = paginatedSchema(announcementSchema)

export const messageSchema = z.object({
  id: z.number().int(),
  sender: sampleUserSchema,
  createTime: z.string(),
  message: z.string(),
  submission: embeddedSubmissionSchema,
})

export const messageListSchema = paginatedSchema(messageSchema)

export const createMessageRequestSchema = z.object({
  recipientId: z.number().int().positive(),
  submissionId: z.string().min(1),
  message: z.string().min(1).max(1024 * 1024),
})

export const reactionKeySchema = z.enum([
  "too_easy",
  "too_hard",
  "confusing",
  "buggy",
  "learned",
  "interesting",
  "want_explain",
])

export const reactionCountsSchema = z.record(reactionKeySchema, z.number().int())
export const reactionStateSchema = z.object({
  mine: reactionKeySchema.nullable(),
  counts: reactionCountsSchema.nullable(),
})

export const setReactionRequestSchema = z.object({ type: reactionKeySchema })

export const tutorialSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
})

export const tutorialSchema = tutorialSummarySchema.extend({
  content: z.string(),
  code: z.string().nullable(),
  isPublic: z.boolean(),
  order: z.number().int(),
  type: z.enum(["python", "c"]),
  createdBy: sampleUserSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const exerciseSchema = z.object({
  id: z.number().int(),
  type: z.enum(["mcq", "sort", "fill", "match", "predict", "debug", "group"]),
  data: z.record(z.string(), z.unknown()),
  order: z.number().int(),
})

export type Message = z.infer<typeof messageSchema>
export type MessageList = z.infer<typeof messageListSchema>
export type Announcement = z.infer<typeof announcementSchema>
export type TutorialSummary = z.infer<typeof tutorialSummarySchema>

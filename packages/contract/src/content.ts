import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"
import { embeddedSubmissionSchema } from "./submission"

export const announcementSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  tag: z.string(),
  content: z.string(),
  top: z.boolean(),
  createdBy: sampleUserSchema,
  createTime: z.string(),
  lastUpdateTime: z.string(),
})

/**
 * 列表不下发正文：公告是 8MB 上限的富文本，列表页只显示标题。
 * 原来 content 写成 `.optional()` 让一个 schema 兼两种形态，结果详情页
 * 拿到的 content 类型上也是 `string | undefined`，组件只能 ?? 兜底。
 * 与后台侧 adminAnnouncementListItemSchema 同一个套路。
 */
export const announcementListItemSchema = announcementSchema.omit({
  content: true,
})

export const announcementListSchema = paginatedSchema(
  announcementListItemSchema,
)

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
export type AnnouncementListItem = z.infer<typeof announcementListItemSchema>
export type TutorialSummary = z.infer<typeof tutorialSummarySchema>

export type AnnouncementList = z.infer<typeof announcementListSchema>
export type CreateMessageRequest = z.infer<typeof createMessageRequestSchema>
export type ReactionKey = z.infer<typeof reactionKeySchema>
export type ReactionCounts = z.infer<typeof reactionCountsSchema>
export type ReactionState = z.infer<typeof reactionStateSchema>
export type SetReactionRequest = z.infer<typeof setReactionRequestSchema>
export type Tutorial = z.infer<typeof tutorialSchema>
export type Exercise = z.infer<typeof exerciseSchema>

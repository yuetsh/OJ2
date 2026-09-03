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

/**
 * 自学留痕的上报。前端每进一课发一次 `opened: true`（`seconds` 为 0），
 * 之后按心跳补时长发 `opened: false`。
 *
 * `seconds` 卡在 1 小时以内：一次上报最多也就攒几分钟，超出这个量级只可能是
 * 客户端算错或有人手造请求，直接拒掉比默默入库好——停留时长是要给老师看的。
 */
export const tutorialProgressPingSchema = z.object({
  seconds: z.number().int().min(0).max(3600),
  opened: z.boolean(),
})

/**
 * 学习页目录要的整套进度：**每篇公开教程都有一行**，没读过的就是一行零。
 * 让前端 `progress[id]` 永远取得到，省得目录里每处都判一次 undefined。
 */
export const tutorialProgressSchema = z.object({
  tutorialId: z.number().int(),
  viewCount: z.number().int(),
  totalSeconds: z.number().int(),
  // 没读过时是 null，不是假的零时间
  firstViewedAt: z.string().nullable(),
  lastViewedAt: z.string().nullable(),
  exerciseTotal: z.number().int(),
  exerciseSolved: z.number().int(),
})

/**
 * 一次练一练的作答。
 *
 * `answer` 是前端拼好的一句人话（「选了 A、C」），只在做错时留下来给老师看；
 * 做对了没什么好看的。长度卡在 200 字符：它是给人扫一眼的摘要，不是完整作答，
 * 填空题写一整段进来只会把后台表格撑爆。
 */
export const exerciseAttemptRequestSchema = z.object({
  correct: z.boolean(),
  answer: z.string().max(200).optional(),
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
export type TutorialProgress = z.infer<typeof tutorialProgressSchema>
export type TutorialProgressPing = z.infer<typeof tutorialProgressPingSchema>
export type ExerciseAttemptRequest = z.infer<typeof exerciseAttemptRequestSchema>

/**
 * 「已读」的门槛：累计停留满 3 分钟才算读过这一课。
 *
 * 之前只要打开过（`viewCount > 0`）就记成已读，于是「点开看一眼就退」和「认真读完」
 * 在老师那张表上长得一模一样，「已读 17/17」并不说明他学了。3 分钟是按最短的一课
 * 定的下限——读不完还翻不动的课文，扫一眼是到不了这个数的。
 *
 * 门槛只管**「已读」这个口径**（学生端的 ✓、后台的已读课数与读过的人数），
 * 不动累计时长：时长记的是真实停留，不满 3 分钟的那些秒数照样算进去，
 * 「已读 0 课、累计 25 分钟」正是要让老师看见的一种情况。
 */
export const TUTORIAL_READ_SECONDS = 180

import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"

/**
 * 后台侧的契约。与 oj 侧分开放：同一张表在两侧下发的字段集通常不同
 * （后台要 `visible` 这类管理字段，oj 侧连键都不该出现），
 * 混在一个 schema 里迟早会有人为了省事在 oj 侧复用后台那个。
 */

export const adminAnnouncementSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  tag: z.string(),
  content: z.string(),
  visible: z.boolean(),
  top: z.boolean(),
  createdBy: sampleUserSchema,
  createTime: z.string(),
  lastUpdateTime: z.string(),
})

export const adminAnnouncementListSchema = paginatedSchema(
  // 列表不带 content：公告正文是 8MB 上限的富文本，列表页只显示标题
  adminAnnouncementSchema.omit({ content: true }),
)

export const createAnnouncementRequestSchema = z.object({
  title: z.string().trim().min(1).max(64),
  tag: z.string().max(64),
  content: z.string().max(1024 * 1024 * 8),
  visible: z.boolean(),
  top: z.boolean(),
})

export const updateAnnouncementRequestSchema = createAnnouncementRequestSchema

export type AdminAnnouncement = z.infer<typeof adminAnnouncementSchema>

// ---------------------------------------------------------------- 教程 / 练习

export const tutorialTypeSchema = z.enum(["python", "c"])

export const adminTutorialSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  content: z.string(),
  code: z.string().nullable(),
  isPublic: z.boolean(),
  order: z.number().int(),
  type: tutorialTypeSchema,
  createdBy: sampleUserSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminTutorialListItemSchema = adminTutorialSchema.omit({
  // 教程正文是整篇 markdown，列表页只排序和切换可见性，不需要它
  content: true,
  code: true,
})

/** 后台教程列表按语言分组返回，对齐旧 TutorialAdminAPI.get 的 `{python, c}` 形状 */
export const adminTutorialGroupsSchema = z.object({
  python: z.array(adminTutorialListItemSchema),
  c: z.array(adminTutorialListItemSchema),
})

export const createTutorialRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  content: z.string(),
  code: z.string().nullable().default(null),
  isPublic: z.boolean().default(false),
  order: z.number().int().default(0),
  type: tutorialTypeSchema,
})

export const updateTutorialRequestSchema = createTutorialRequestSchema
export const setTutorialVisibilityRequestSchema = z.object({ isPublic: z.boolean() })

export const exerciseTypeSchema = z.enum([
  "mcq",
  "sort",
  "fill",
  "match",
  "predict",
  "debug",
  "group",
])

export const adminExerciseSchema = z.object({
  id: z.number().int(),
  type: exerciseTypeSchema,
  data: z.record(z.string(), z.unknown()),
  order: z.number().int(),
})

export const createExerciseRequestSchema = z.object({
  tutorialId: z.number().int().positive(),
  type: exerciseTypeSchema,
  data: z.record(z.string(), z.unknown()),
  order: z.number().int().default(0),
})

export const updateExerciseRequestSchema = createExerciseRequestSchema.omit({
  // 练习不支持改挂到别的教程下 —— 旧 EditExerciseSerializer 也没有 tutorial_id
  tutorialId: true,
})

// ---------------------------------------------------------------- AI 报告

/**
 * 列表只给摘要，正文要点开详情才拿 —— 与旧 AIAnalysisListSerializer 一致。
 * `data`（原始 prompt 与结构化输入）和 `system_prompt` / `user_prompt` 两侧都不下发。
 */
export const adminAiReportListItemSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  createTime: z.string(),
  analysisExcerpt: z.string(),
  isPinned: z.boolean(),
})

export const adminAiReportSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  className: z.string().nullable(),
  createTime: z.string(),
  analysis: z.string(),
})

export const adminAiReportListSchema = paginatedSchema(adminAiReportListItemSchema)
export const toggleAiReportPinResponseSchema = z.object({ isPinned: z.boolean() })

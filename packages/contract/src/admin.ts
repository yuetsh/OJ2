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

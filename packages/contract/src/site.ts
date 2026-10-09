import { z } from "zod"

export const websiteConfigSchema = z.object({
  websiteBaseUrl: z.string(),
  websiteName: z.string(),
  websiteNameShortcut: z.string(),
  websiteFooter: z.string(),
  allowRegister: z.boolean(),
  submissionListShowAll: z.boolean(),
  classList: z.array(z.string()),
  enableMaxkb: z.boolean(),
})

/**
 * 一言。`from` 是出处（作品），`fromWho` 是谁说的，`type` 是数据集的分类名（动画、诗词……，界面不显示，
 * 只拿来判断出处要不要加书名号），
 * 后两个数据集里可能没有。原来是 string | Record 的宽类型，前端拿到再猜形状；
 * 出参是后端自己拼的，直接给定形
 */
export const quoteSchema = z.object({
  hitokoto: z.string(),
  from: z.string(),
  fromWho: z.string().nullable(),
  type: z.string().nullable(),
})

export type WebsiteConfig = z.infer<typeof websiteConfigSchema>
export type Quote = z.infer<typeof quoteSchema>

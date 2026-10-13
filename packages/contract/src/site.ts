import { z } from "zod"

/**
 * 站点配置。网址、简称、页脚三项 2026-10-13 删了（前后端从来没读过，改了也看不到变化），
 * AI 小助手（MaxKB 挂件）连同开关一起删了。options 表里那几行旧值留着，没人读
 */
export const websiteConfigSchema = z.object({
  websiteName: z.string(),
  allowRegister: z.boolean(),
  submissionListShowAll: z.boolean(),
  classList: z.array(z.string()),
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

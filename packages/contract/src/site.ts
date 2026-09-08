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

/** 当前在线人数。只有聚合值 —— 「某某在不在线」是个人状态，不往匿名接口放 */
export const onlineCountSchema = z.object({
  count: z.number().int().nonnegative(),
})

export const quoteSchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
])

export type WebsiteConfig = z.infer<typeof websiteConfigSchema>
export type Quote = z.infer<typeof quoteSchema>
export type OnlineCount = z.infer<typeof onlineCountSchema>

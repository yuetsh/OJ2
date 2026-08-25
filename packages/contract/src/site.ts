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

export const quoteSchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
])

export type WebsiteConfig = z.infer<typeof websiteConfigSchema>
export type Quote = z.infer<typeof quoteSchema>

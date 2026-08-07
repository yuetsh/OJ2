import { quoteSchema, websiteConfigSchema } from "@oj2/contract"
import { asc, desc, eq } from "drizzle-orm"
import { Hono } from "hono"

import { db, schema } from "../db"
import { failure, success } from "../http"
import { getWebsiteOptions } from "../services/options"

export const siteRoutes = new Hono()

siteRoutes.get("/site", async (c) => {
  const options = await getWebsiteOptions()
  return success(c, websiteConfigSchema.parse({
    websiteBaseUrl: options.website_base_url,
    websiteName: options.website_name,
    websiteNameShortcut: options.website_name_shortcut,
    websiteFooter: options.website_footer,
    allowRegister: options.allow_register,
    submissionListShowAll: options.submission_list_show_all,
    classList: options.class_list,
    enableMaxkb: options.enable_maxkb,
  }))
})

const quotes = [
  { hitokoto: "程序首先是写给人读的，其次才是让机器执行。", from: "Structure and Interpretation of Computer Programs" },
  { hitokoto: "把大问题拆成足够小的问题，答案就会浮现。", from: "判题狗" },
  { hitokoto: "一次没通过，只是多得到了一条线索。", from: "判题狗" },
]

siteRoutes.get("/quotes/random", (c) => {
  const item = quotes[Math.floor(Math.random() * quotes.length)] ?? quotes[0]
  return success(c, quoteSchema.parse(item))
})

siteRoutes.get("/classes/:className/usernames", async (c) => {
  const className = c.req.param("className").trim()
  if (!/^\d{3,4}$/.test(className)) {
    return failure(c, 400, "invalid-class", "Class name must contain 3 or 4 digits")
  }
  const rows = await db
    .select({ username: schema.user.username })
    .from(schema.user)
    .where(eq(schema.user.className, className))
    .orderBy(desc(schema.user.createTime), asc(schema.user.id))
  return success(c, rows.map(({ username }) => username.replace(`ks${className}`, "")))
})

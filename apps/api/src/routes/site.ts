import { quoteSchema, websiteConfigSchema } from "@oj2/contract"
import { asc, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { resolve } from "node:path"

import { config } from "../config"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { getWebsiteOptions } from "../services/options"
import { stripClassPrefix } from "./helpers"

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

// 数据集读不到时的兜底（本机 dev 没挂 data/hitokoto 就会走这里）
const fallbackQuotes = [
  { hitokoto: "程序首先是写给人读的，其次才是让机器执行。", from: "Structure and Interpretation of Computer Programs" },
  { hitokoto: "把大问题拆成足够小的问题，答案就会浮现。", from: "判题狗" },
  { hitokoto: "一次没通过，只是多得到了一条线索。", from: "判题狗" },
]

// categories.json 里的 path 形如 "./sentences/a.json"，12 个分类合计 20MB。
// 按分类懒加载并常驻缓存，但**只留前端用得上的两个字段** —— 原样缓存的话，
// 解析后的对象要占 60~100MB，而 api 容器只有 512m。裁完全量也就几 MB。
let categoryPaths: string[] | null = null
const sentenceCache = new Map<string, Quote[]>()

interface Quote {
  hitokoto: string
  from: string
}

async function loadSentences(path: string) {
  const cached = sentenceCache.get(path)
  if (cached) return cached
  const raw = await Bun.file(resolve(config.hitokotoDirectory, path)).json() as { hitokoto?: unknown, from?: unknown }[]
  const rows = (Array.isArray(raw) ? raw : [])
    .filter((it) => typeof it.hitokoto === "string" && it.hitokoto.length > 0)
    .map((it) => ({ hitokoto: it.hitokoto as string, from: typeof it.from === "string" ? it.from : "佚名" }))
  if (rows.length === 0) throw new Error(`empty hitokoto category: ${path}`)
  sentenceCache.set(path, rows)
  return rows
}

async function randomQuote() {
  if (!categoryPaths) {
    const categories = await Bun.file(resolve(config.hitokotoDirectory, "categories.json")).json() as { path?: string }[]
    const paths = categories.map((it) => it.path).filter((it): it is string => typeof it === "string")
    if (paths.length === 0) throw new Error("no hitokoto categories")
    categoryPaths = paths
  }
  const path = categoryPaths[Math.floor(Math.random() * categoryPaths.length)]!
  const sentences = await loadSentences(path)
  return sentences[Math.floor(Math.random() * sentences.length)]!
}

siteRoutes.get("/quotes/random", async (c) => {
  try {
    return success(c, quoteSchema.parse(await randomQuote()))
  } catch {
    const item = fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)]!
    return success(c, quoteSchema.parse(item))
  }
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
  // 用 stripClassPrefix 而不是 replace：replace 会把中间的匹配也删掉，前缀对不上时截出乱码
  return success(c, rows.map(({ username }) => stripClassPrefix(username, className)))
})

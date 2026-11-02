import { CLASS_NAME_RE, displayName, type ClassMember, type Quote, type WebsiteConfig } from '@oj2/contract'
import { asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { resolve } from 'node:path'

import { config } from '../config'
import { db, schema } from '../db'
import { failure, success } from '../http'
import { getWebsiteOptions } from '../services/options'
import { stripClassPrefix } from './helpers'

export const siteRoutes = new Hono()

siteRoutes.get('/site', async (c) => {
  const options = await getWebsiteOptions()
  return success(c, {
    websiteName: options.website_name,
    allowRegister: options.allow_register,
    submissionListShowAll: options.submission_list_show_all,
    classList: options.class_list,
  } satisfies WebsiteConfig)
})

// 数据集读不到时的兜底（本机旁边没有 sentences-bundle 就会走这里）
const fallbackQuotes = [
  {
    hitokoto: '程序首先是写给人读的，其次才是让机器执行。',
    from: 'Structure and Interpretation of Computer Programs',
    fromWho: null,
    type: null,
  },
  {
    hitokoto: '把大问题拆成足够小的问题，答案就会浮现。',
    from: '判题狗',
    fromWho: null,
    type: null,
  },
  { hitokoto: '一次没通过，只是多得到了一条线索。', from: '判题狗', fromWho: null, type: null },
] satisfies Quote[]

// categories.json 里的 path 形如 "./sentences/a.json"，12 个分类合计 20MB。
// 按分类懒加载并常驻缓存，但**只留前端用得上的几个字段**（句子、出处、谁说的、分类名）——
// 原样缓存的话，解析后的对象要占 60~100MB，而 api 容器只有 512m。裁完全量也就几 MB。
let categories: { path: string; name: string | null }[] | null = null
const sentenceCache = new Map<string, Quote[]>()

async function loadSentences(path: string, type: string | null) {
  const cached = sentenceCache.get(path)
  if (cached) return cached
  const raw = (await Bun.file(resolve(config.hitokotoDirectory, path)).json()) as {
    hitokoto?: unknown
    from?: unknown
    from_who?: unknown
  }[]
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const rows = (Array.isArray(raw) ? raw : [])
    .filter((it) => typeof it.hitokoto === 'string' && it.hitokoto.length > 0)
    .map((it) => ({
      hitokoto: it.hitokoto as string,
      from: text(it.from) ?? '佚名',
      fromWho: text(it.from_who),
      type,
    }))
  if (rows.length === 0) throw new Error(`empty hitokoto category: ${path}`)
  sentenceCache.set(path, rows)
  return rows
}

async function randomQuote() {
  if (!categories) {
    const list = (await Bun.file(resolve(config.hitokotoDirectory, 'categories.json')).json()) as {
      path?: unknown
      name?: unknown
    }[]
    const parsed = list
      .filter((it): it is { path: string; name?: unknown } => typeof it.path === 'string')
      .map((it) => ({ path: it.path, name: typeof it.name === 'string' ? it.name : null }))
    if (parsed.length === 0) throw new Error('no hitokoto categories')
    categories = parsed
  }
  const category = categories[Math.floor(Math.random() * categories.length)]!
  const sentences = await loadSentences(category.path, category.name)
  return sentences[Math.floor(Math.random() * sentences.length)]!
}

siteRoutes.get('/quotes/random', async (c) => {
  try {
    return success(c, (await randomQuote()) satisfies Quote)
  } catch {
    const item = fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)]!
    return success(c, item satisfies Quote)
  }
})

/**
 * 登录框点名字的名单：名字给人点，用户名拿去登录（老号 ks232张三，新号就是名字）。名字按界面上的显示规则剥，
 * 和 UserName 一致 —— 不能只剥「ks + 当前班号」：班级现在能在后台改，换过班的老号会露出整串
 */
siteRoutes.get('/classes/:className/members', async (c) => {
  const className = c.req.param('className').trim()
  if (!CLASS_NAME_RE.test(className)) {
    return failure(c, 400, 'invalid-class', 'Class name must contain 3 or 4 digits')
  }
  const rows = await db
    .select({ username: schema.user.username })
    .from(schema.user)
    .where(eq(schema.user.className, className))
    .orderBy(desc(schema.user.createTime), asc(schema.user.id))
  return success(
    c,
    rows.map(({ username }) => ({ name: displayName(username), username }) satisfies ClassMember),
  )
})

/**
 * 旧版登录框的名单：只回名字，前端拼「ks + 班号 + 名字」去登录。2026-11 的新前端改走上面的 /members；
 * 这条原样留着，是给上线时还开着旧登录页、没刷新的机房电脑用的（老号照样登得上）。过一阵可以删
 */
siteRoutes.get('/classes/:className/usernames', async (c) => {
  const className = c.req.param('className').trim()
  if (!CLASS_NAME_RE.test(className)) {
    return failure(c, 400, 'invalid-class', 'Class name must contain 3 or 4 digits')
  }
  const rows = await db
    .select({ username: schema.user.username })
    .from(schema.user)
    .where(eq(schema.user.className, className))
    .orderBy(desc(schema.user.createTime), asc(schema.user.id))
  return success(
    c,
    rows.map(({ username }) => stripClassPrefix(username, className)),
  )
})

import { ilike, inArray, or, type SQL } from 'drizzle-orm'
import { match } from 'pinyin-pro'

import { db, schema } from '../db'
import { cached } from './cache'

/**
 * 按用户名搜人：包含匹配，外加**拼音和拼音缩写**（张三 ← zhangsan / zs / san）。
 *
 * 新号的用户名就是中文名字（库里九成以上是），老师在机房电脑上搜人懒得切输入法，
 * 登录框早就支持拼音了（Login.vue），各处搜索框跟它一个口径。
 *
 * 拼音没法在 SQL 里算，所以把全部用户名拉进进程（两千多个，缓存一分钟）逐个用
 * pinyin-pro 的 match 比 —— 和登录框同一个函数，多音字两个读音都认（单 ← s / d）。
 * 两千人比一遍约 15ms，同一个词一分钟内只比一次。
 *
 * 只有输入是纯字母、至少两个时才走拼音：`ks248`、学号、单个字母都只按包含匹配，
 * 单个字母的拼音首字母会圈进半个学校。
 */
const PINYIN_KEYWORD = /^[a-z]{2,}$/i
const TTL_MS = 60_000

function allUsernames() {
  return cached('username-search:all', TTL_MS, () => db.select({ id: schema.user.id, username: schema.user.username }).from(schema.user))
}

/** 拼音能对上的账号 id；输入不像拼音时返回空 */
export function pinyinMatchedUserIds(keyword: string): Promise<number[]> {
  const word = keyword.trim().toLowerCase()
  if (!PINYIN_KEYWORD.test(word)) return Promise.resolve([])
  return cached(`username-search:${word}`, TTL_MS, async () =>
    (await allUsernames()).filter((row) => /[^a-z0-9_]/i.test(row.username) && match(row.username, word, { continuous: true }) !== null).map((row) => row.id),
  )
}

/** `user` 表上的用户名条件：包含匹配 ∪ 拼音匹配 */
export async function usernameCondition(keyword: string): Promise<SQL> {
  const contains = ilike(schema.user.username, `%${keyword}%`)
  const ids = await pinyinMatchedUserIds(keyword)
  return ids.length ? or(contains, inArray(schema.user.id, ids))! : contains
}

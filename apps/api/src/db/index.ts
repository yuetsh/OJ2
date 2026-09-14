import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema"

const url = process.env.DATABASE_URL ?? "postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge"

// 不设会话时区：日历语义的 SQL 一律显式 `at time zone`（`../time` 的 localTime），
// 不靠会话默认值兜底 —— 兜底会把漏写的地方在线上掩盖掉，dev 上又是另一个答案。
const client = postgres(url)

export const db = drizzle(client, { schema })

/**
 * 读出来的时刻统一成 ISO 8601 UTC，和写侧的 `new Date().toISOString()` 同形状。
 *
 * drizzle 的 `construct()`（`drizzle-orm/postgres-js/driver.js`）把 1184(timestamptz) 等
 * OID 的 parser 换成了恒等函数，不处理的话读出来是 PG 文本（`2026-09-14 20:00:00+08`），
 * 接口上同一个字段就有两种形状。所以**必须在 `drizzle(client)` 之后**覆盖回来。
 *
 * - **只换 1184。** 1082(date) 要的就是 `2026-09-14`；全库时间列都是 timestamptz。
 * - **`::text` 的 OID 是 25，绕过这里**：别再为了拿字符串形状给时间列加 `::text`。
 * - **保留微秒。** `Date` 只到毫秒，而 Django 时代的提交几乎全带微秒；读出的时刻常被
 *   原样塞回查询条件（提交列表翻页的分界行、班级 AC 排名的 `<= min(create_time)`），
 *   截掉会让分界行把自己排除。所以偏移换算交给 `Date`（先去掉小数，免得进位），
 *   小数位原文拼回去、至少补足 3 位。Bun、老 Chrome 和 date-fns 都能解析 6 位小数。
 */
client.options.parsers[1184] = (value: string) => {
  const fraction = /\.\d+/.exec(value)?.[0]
  if (!fraction) return new Date(value).toISOString()
  return `${new Date(value.replace(fraction, "")).toISOString().slice(0, 19)}${fraction.padEnd(4, "0")}Z`
}

export { schema }

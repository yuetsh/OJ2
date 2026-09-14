import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { TIME_ZONE } from "../time"
import * as schema from "./schema"

const url = process.env.DATABASE_URL ?? "postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge"

/**
 * 会话时区固定成东八区（启动包里的 `TimeZone` 参数）。
 *
 * 只影响 SQL 里那些**把 timestamptz 换算成日历**的函数 —— `extract(year from …)`、
 * `date(…)`、`to_char(…, 'YYYY-MM-DD')`。比较、排序、存取值都不受它影响
 * （timestamptz 存的是绝对时刻）。不设的话 PostgreSQL 默认 UTC，于是同一个
 * 「哪一年」在 SQL 里和 JS 里会差 8 小时。
 *
 * 注意这只是**默认值**，别把正确性押在它身上：动了日历语义的 SQL 仍然应该显式写
 * `at time zone`（见 `../time` 的 TIME_ZONE_SQL），否则换库、走 pgbouncer、
 * 或者谁改了这里的配置，都会静默漂回去。
 */
const client = postgres(url, { connection: { TimeZone: TIME_ZONE } })

export const db = drizzle(client, { schema })

/**
 * 让**读出来的时刻**和**写进去的时刻**是同一种字符串：ISO 8601 UTC。
 *
 * 写侧一直是 `new Date().toISOString()`（`2026-09-14T12:00:00.000Z`），但读侧原本
 * 拿回来的是 PostgreSQL 的文本格式（`2026-09-14 20:00:00+08`，空格分隔 + 会话时区偏移）。
 * 于是同一个字段在接口上有两种形状：从库里读的是一种、后端现拼的是另一种，
 * 对接外部系统时对方得解析两套。
 *
 * 根因在 drizzle：`drizzle-orm/postgres-js/driver.js` 的 `construct()` 把 1184(timestamptz)
 * 等 8 个 OID 的 parser 换成了恒等函数，postgres.js 本来会做的 `new Date()` 解析被跳过，
 * 原样吐 PG 文本。所以**必须在 `drizzle(client)` 之后**再把它换回来（顺序不能反）。
 *
 * **只换 1184，不要碰 1082(date)。** `date(create_time at time zone …)` 这种日历日
 * 表达式要的就是 `2026-09-14`，把 1082 也套上 `toISOString()` 会把它变成带时分的时刻。
 * 1114(timestamp without time zone) 同理不碰 —— 全库 35 个时间列都是 timestamptz。
 *
 * ⚠️ **`::text` 转出来的字符串 OID 是 25，不走这里**。所以原来为了「拿回和列一样形状的
 * 字符串」而写的 `max(join_time)::text` 这类 cast 现在会反过来变成异类，必须一起撤掉。
 *
 * 数据库里存的始终是 UTC 绝对时刻，这一层只改**序列化形状**，不改任何值。
 *
 * ⚠️ **必须保留微秒，别「简化」回 `new Date(value).toISOString()`。** `Date` 只到毫秒，
 * 而生产库 12.3 万条提交几乎全带微秒（Django 写入的）。读出来的时刻经常被原样当查询条件
 * 塞回去 —— 提交列表翻页的 `(create_time, id) <= (分界行, id)`、班级 AC 排名的
 * `create_time <= min(create_time)` —— 截成毫秒后分界行自己比「分界值」大，被条件排除：
 * 翻页每页丢第一条，排名少算 1。所以偏移换算交给 `Date`（先去掉小数，避免任何进位），
 * 小数位原文拼回去，至少补足 3 位：`2026-09-14T12:00:00.123456Z` / `…00.000Z`。
 * Bun、Node、老 Chrome 的 `Date` 与 date-fns `parseISO` 都能解析 6 位小数。
 */
client.options.parsers[1184] = (value: string) => {
  const fraction = /\.\d+/.exec(value)?.[0]
  if (!fraction) return new Date(value).toISOString()
  return `${new Date(value.replace(fraction, "")).toISOString().slice(0, 19)}${fraction.padEnd(4, "0")}Z`
}

export { schema }

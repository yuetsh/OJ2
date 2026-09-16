import { TIME_ZONE, TIME_ZONE_OFFSET_MINUTES } from "@oj2/contract"
import { sql, type SQLWrapper } from "drizzle-orm"

/**
 * 后端的日历换算全在这里，锚点是契约里的 `TIME_ZONE`（东八区，固定偏移）。
 *
 * **凡是要把一个时刻换算成「哪一天 / 几点 / 哪一年」，都必须走这里**；SQL 里按日历切
 * 就用 `localTime()`。不要写 `new Date(x).getHours()` / `setHours(0,0,0,0)` /
 * `getFullYear()` / `new Date(y, m, d)` 这类跟**进程时区**走的代码，也不要依赖数据库
 * 会话时区：容器（UTC）和开发机给出不同答案，而且不报错。
 */
export { TIME_ZONE }

const OFFSET_MS = TIME_ZONE_OFFSET_MINUTES * 60_000
const DAY_MS = 86_400_000

/**
 * 真实时刻 → 「东八区墙上时钟」。平移之后 `getUTC*` 读出来的就是北京时间的年月日时分，
 * 日历运算可以整套用 UTC 那批 API 做。`fromWallClock` 是逆运算。
 */
function toWallClock(value: Date | number | string = new Date()): Date {
  return new Date(new Date(value).getTime() + OFFSET_MS)
}

function fromWallClock(wall: Date): Date {
  return new Date(wall.getTime() - OFFSET_MS)
}

/** 北京时间的日历日，形如 `2026-09-14` */
export function calendarDay(
  value: Date | number | string = new Date(),
): string {
  return toWallClock(value).toISOString().slice(0, 10)
}

/** 北京时间的钟点，0–23 */
export function localHour(value: Date | number | string = new Date()): number {
  return toWallClock(value).getUTCHours()
}

/** 北京时间的年份 */
export function localYear(value: Date | number | string = new Date()): number {
  return toWallClock(value).getUTCFullYear()
}

/**
 * 日历日序号（1970-01-01 为 0）。
 *
 * 「差几天」一律用它算，别拿两个 Date 相减：夏令时地区的相邻两天可能相差
 * 23 或 25 小时，除 86400000 得到的不是 1，`=== 1` 这种判据会静默失效。
 */
export function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number)
  return Date.UTC(year!, month! - 1, date!) / DAY_MS
}

/** 日历日序号 → `YYYY-MM-DD` */
export function dayText(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** 日历日序号是周几，0 = 周日（和 `Date#getDay()` 同一套编号） */
export function localWeekday(day: number): number {
  return new Date(day * DAY_MS).getUTCDay()
}

/** 「东八区今天」的零点，返回 ISO 字符串。提交列表、流程图列表的 `?today=1` 和后台「今日提交数」用它 */
export function todayStart(now: Date | number | string = new Date()): string {
  return new Date(
    dayNumber(calendarDay(now)) * DAY_MS - OFFSET_MS,
  ).toISOString()
}

/** 按北京时间的日历做月份平移，日号超出目标月长度时截到月末，时分秒毫秒原样保留 */
export function shiftMonthsByCalendar(instant: Date, months: number): Date {
  const wall = toWallClock(instant)
  const date = wall.getUTCDate()
  wall.setUTCDate(1)
  wall.setUTCMonth(wall.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 0),
  ).getUTCDate()
  wall.setUTCDate(Math.min(date, lastDay))
  return fromWallClock(wall)
}

/**
 * 时区名直接拼成 SQL 字面量，**不走参数绑定**：同一个表达式在 select 和 group by 里
 * 各出现一次，绑定成参数会拿到两个不同的占位符，PG 就不认为它们是同一个表达式，报
 * 「must appear in the GROUP BY clause」。常量拼接，没有注入面。
 */
const TIME_ZONE_SQL = sql.raw(`'${TIME_ZONE}'`)

/**
 * `timestamptz` 列 → 北京墙上时间（`timestamp`），供 `extract(hour from …)` /
 * `date(…)` 这类日历函数用。每次调用渲染出的 SQL 文本相同，select 和 group by
 * 各调一次也能匹配上。
 */
export function localTime(column: SQLWrapper) {
  return sql`(${column} at time zone ${TIME_ZONE_SQL})`
}

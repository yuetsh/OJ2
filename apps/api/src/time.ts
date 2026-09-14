import { sql } from "drizzle-orm"

/**
 * 全仓唯一的时间锚点：**Asia/Shanghai**。
 *
 * 旧栈是 Django，`settings.TIME_ZONE = "Asia/Shanghai"` + `USE_TZ = True`：
 * 库里存 UTC，应用层一律按北京时间算日历。重写成 OJ2 之后这个锚点丢了 ——
 * 容器没设 TZ（= UTC）、数据库会话也是 UTC，于是「今天」「现在几点」「哪一年」
 * 全按 UTC 判，整体比学生的作息早 8 小时。
 *
 * 已经造成的偏差（改之前）：
 *   - `todayStart()` 切的是 UTC 零点 → 「今日提交」在北京时间 0:00–8:00 是空的，
 *     8:00 之后才把前一天的提交清掉；
 *   - 成就「凌晨提交次数」口径写的是 0:00–5:00、「早起提交次数」是 5:00–7:00，
 *     实际按 UTC 小时判定，整体偏 8 小时；
 *   - 「活跃天数」「单日最多 AC」「最长连续 AC 天数」按 UTC 日切分。
 *
 * **凡是要把一个时刻换算成「哪一天 / 几点 / 哪一年」，都必须走这里。**
 * 不要再写 `new Date(x).getHours()` / `setHours(0,0,0,0)` / `getFullYear()` /
 * `new Date(y, m, d)` 这类跟**进程时区**走的代码：在容器（UTC）和开发机
 * （本机时区，可能是任何值）上给出不同答案，而且不报错、没人会发现。
 *
 * 实现上按**固定偏移**算，不查 tzdata、不依赖 `Intl` 的时区库：中国大陆
 * 1991 年起不再有夏令时，Asia/Shanghai 恒为 UTC+8。这样无论进程 TZ 是什么、
 * 镜像里有没有 tzdata，结果都一样，dev 和线上也一致。
 * Dockerfile 里的 `TZ=Asia/Shanghai` 是兜底用的第二道保险，不是这里的依据。
 */
export const TIME_ZONE = "Asia/Shanghai"

/** Asia/Shanghai 的固定偏移。换时区时这个常量必须跟着改 */
const OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 86_400_000

function pad(value: number) {
  return String(value).padStart(2, "0")
}

/**
 * 真实时刻 → 「东八区墙上时钟」。
 *
 * 平移 8 小时之后，`getUTC*` 读出来的就是北京时间的年月日时分，于是日历运算
 * 可以整套用 UTC 那批 API 做，完全不受进程时区影响。`fromWallClock` 是逆运算。
 */
function toWallClock(value: Date | number | string = new Date()): Date {
  return new Date(new Date(value).getTime() + OFFSET_MS)
}

function fromWallClock(wall: Date): Date {
  return new Date(wall.getTime() - OFFSET_MS)
}

/** 北京时间的日历日，形如 `2026-09-14` */
export function calendarDay(value: Date | number | string = new Date()): string {
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

/** 周几，0 = 周日。和 `Date#getDay()` 同一套编号，但按东八区日历算 */
export function localWeekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7
}

/** 北京时间的某一天零点，返回真实时刻 */
export function startOfCalendarDay(day: string): Date {
  return new Date(dayNumber(day) * DAY_MS - OFFSET_MS)
}

/**
 * 「东八区今天」的零点，返回 ISO 字符串。
 *
 * 提交列表的 `?today=1`、流程图列表的 `?today=1`、后台首页的「今日提交数」都用它。
 * 原来是 `setHours(0,0,0,0)`，切的是**进程时区**的零点。
 */
export function todayStart(now: Date | number | string = new Date()): string {
  return startOfCalendarDay(calendarDay(now)).toISOString()
}

/**
 * 北京时间的「N 年前的今天」。日号超出目标月长度时截到月末
 * （2 月 29 日往前两年不能静默滚到 3 月 1 日）。
 */
export function calendarDayYearsAgo(years: number, now: Date | number | string = new Date()): string {
  const [year, month, date] = calendarDay(now).split("-").map(Number)
  const lastDay = new Date(Date.UTC(year! - years, month!, 0)).getUTCDate()
  return `${year! - years}-${pad(month!)}-${pad(Math.min(date!, lastDay))}`
}

/**
 * 按北京时间的日历做月份平移，日号超出目标月长度时截到月末，时分秒毫秒原样保留。
 *
 * 就是原来 `ai.ts` 里那个 `shiftMonths` 的逐句改写：`getDate` → `getUTCDate`、
 * `setMonth` → `setUTCMonth`、`new Date(y, m, d)` → `new Date(Date.UTC(...))`，
 * 外面套一层墙上时钟平移。结果和「进程 TZ 恰好是 Asia/Shanghai」时逐位相同，
 * 但不再依赖进程 TZ。
 */
export function shiftMonthsByCalendar(instant: Date, months: number): Date {
  const wall = toWallClock(instant)
  const date = wall.getUTCDate()
  wall.setUTCDate(1)
  wall.setUTCMonth(wall.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 0)).getUTCDate()
  wall.setUTCDate(Math.min(date, lastDay))
  return fromWallClock(wall)
}

/**
 * 时区名拼成 SQL 字面量，供 `... at time zone ${TIME_ZONE_SQL}` 用。
 *
 * **必须内联，不能走参数绑定**：同一个表达式在 select 和 group by 里各出现一次，
 * 绑定成参数会拿到两个不同的占位符，PG 就不认为它们是同一个表达式，直接报
 * 「column must appear in the GROUP BY clause」。常量拼接，没有注入面。
 */
export const TIME_ZONE_SQL = sql.raw(`'${TIME_ZONE}'`)

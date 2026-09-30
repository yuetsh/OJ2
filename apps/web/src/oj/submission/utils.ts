import { NO_CLASS } from "@oj2/contract"
import { parseTime } from "utils/functions"

/**
 * 提交时间的显示：今天的只写钟点，别的日子带上月日，跨年再带年份。列表里一眼看的是
 * 「刚才」还是「以前」，完整的年月日时分秒只会把这一列撑宽。
 * 日历按东八区算（parseTime），不跟浏览器时区走。
 */
export function submissionTimeText(time: string, withSeconds = false) {
  const clock = parseTime(time, withSeconds ? "HH:mm:ss" : "HH:mm")
  const day = parseTime(time, "YYYY-MM-DD")
  const now = parseTime(new Date(), "YYYY-MM-DD")
  if (day === now) return clock
  if (day.slice(0, 4) === now.slice(0, 4)) return `${parseTime(time, "M月D日")} ${clock}`
  return `${parseTime(time, "YYYY年M月D日")} ${clock}`
}

/** 列表里每行只写钟点，日期在分隔行上（submissionDayText） */
export function submissionClockText(time: string) {
  return parseTime(time, "HH:mm")
}

/** 分隔行上的日子：今天 / 昨天 / 9月28日（跨年带年份） */
export function submissionDayText(time: string) {
  const day = parseTime(time, "YYYY-MM-DD")
  const now = parseTime(new Date(), "YYYY-MM-DD")
  const yesterday = parseTime(new Date(Date.now() - 86_400_000), "YYYY-MM-DD")
  if (day === now) return "今天"
  if (day === yesterday) return `昨天 · ${parseTime(time, "M月D日")}`
  if (day.slice(0, 4) === now.slice(0, 4)) return parseTime(time, "M月D日")
  return parseTime(time, "YYYY年M月D日")
}

/**
 * 班级下拉的标签：`253` → `25计算机3班`，和统计面板、班级 PK 同一个写法。
 * null（接口里没填班级的号）和 NO_CLASS（筛选里的「没填班级」）都写成「没填班级」
 */
export function classLabel(className: string | null) {
  if (className === null || className === NO_CLASS) return "没填班级"
  return `${className.slice(0, 2)}计算机${className.slice(2)}班`
}

/**
 * 班级下拉的选项：配置里的班，最后一项「没填班级」（这批号也要能和普通班一样圈出来看）。
 * 带进来的班不在配置里（老班、手打的）也要显示得出来，不然框里是空的却在筛
 */
export function classSelectOptions(list: string[], current: string) {
  const all = current && current !== NO_CLASS && !list.includes(current) ? [current, ...list] : list
  return [...all, NO_CLASS].map((item) => ({ label: classLabel(item), value: item }))
}

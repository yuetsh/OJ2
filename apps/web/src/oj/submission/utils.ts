import { parseTime } from 'utils/functions'

/**
 * 提交时间的显示：今天的只写钟点，别的日子带上月日，跨年再带年份。列表里一眼看的是
 * 「刚才」还是「以前」，完整的年月日时分秒只会把这一列撑宽。
 * 日历按东八区算（parseTime），不跟浏览器时区走。
 */
export function submissionTimeText(time: string, withSeconds = false) {
  const clock = parseTime(time, withSeconds ? 'HH:mm:ss' : 'HH:mm')
  const day = parseTime(time, 'YYYY-MM-DD')
  const now = parseTime(new Date(), 'YYYY-MM-DD')
  if (day === now) return clock
  if (day.slice(0, 4) === now.slice(0, 4)) return `${parseTime(time, 'M月D日')} ${clock}`
  return `${parseTime(time, 'YYYY年M月D日')} ${clock}`
}

/**
 * 列表里每行只写钟点，日期在分隔行上（submissionDayText）。带秒：同一分钟里一个人
 * 连交好几次是常事，只写到分钟就分不清先后
 */
export function submissionClockText(time: string) {
  return parseTime(time, 'HH:mm:ss')
}

/** 分隔行上的日子：今天 / 昨天 / 9月28日（跨年带年份） */
export function submissionDayText(time: string) {
  const day = parseTime(time, 'YYYY-MM-DD')
  const now = parseTime(new Date(), 'YYYY-MM-DD')
  const yesterday = parseTime(new Date(Date.now() - 86_400_000), 'YYYY-MM-DD')
  if (day === now) return '今天'
  if (day === yesterday) return `昨天 · ${parseTime(time, 'M月D日')}`
  if (day.slice(0, 4) === now.slice(0, 4)) return parseTime(time, 'M月D日')
  return parseTime(time, 'YYYY年M月D日')
}

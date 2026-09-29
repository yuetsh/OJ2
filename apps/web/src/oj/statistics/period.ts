import { TIME_ZONE_OFFSET_MINUTES } from "@oj2/contract"
import { parseTime, zonedParts } from "utils/functions"

const OFFSET_MS = TIME_ZONE_OFFSET_MINUTES * 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/**
 * 统计页的时间段。课堂统计一般看一两节课（用户原话），所以这两档在最前面、
 * 默认「两节课」；后面几档是回头看。原来弹框里的 10 / 20 / 30 分钟是上课盯人用的，
 * 那件事现在归课堂看板。
 */
export const PERIOD_OPTIONS = [
  { label: "这节课（1 小时内）", value: "1h" },
  { label: "两节课（2 小时内）", value: "2h" },
  { label: "今天", value: "today" },
  { label: "最近 7 天", value: "7d" },
  { label: "最近 30 天", value: "30d" },
  { label: "这学期", value: "term" },
  { label: "全部", value: "all" },
  { label: "自己选日子", value: "custom" },
] as const

export type Period = (typeof PERIOD_OPTIONS)[number]["value"]
export const DEFAULT_PERIOD: Period = "2h"

/** 东八区某天 0 点对应的 UTC 时刻 */
function dayStartOf(year: number, month: number, day: number) {
  return Date.UTC(year, month - 1, day) - OFFSET_MS
}

/** 东八区「现在」这一天的 0 点 */
function todayStart(now: number) {
  const p = zonedParts(new Date(now))!
  return dayStartOf(p.year, p.month, p.day)
}

/**
 * 这学期从哪天起：9 月到次年 1 月算秋季学期（9 月 1 日起），2 到 8 月算春季（2 月 1 日起）。
 * 春季不从 3 月算：2 月下旬就开学了，按 3 月 1 日算的话开学头一两周「这学期」会把整个
 * 上学期和寒假都带进来
 */
function termStart(now: number) {
  const p = zonedParts(new Date(now))!
  if (p.month >= 9) return dayStartOf(p.year, 9, 1)
  if (p.month >= 2) return dayStartOf(p.year, 2, 1)
  return dayStartOf(p.year - 1, 9, 1)
}

/**
 * 时间段换成接口要的 start / end（ISO），外加一句给人看的范围。
 * `custom` 用的是 [开始日 0 点, 结束日 24 点)，两个都是 date picker 取回来的 UTC 时刻。
 */
export function periodRange(period: Period, custom: [number, number] | null, now = Date.now()) {
  let start: number | null
  let end = now
  switch (period) {
    case "1h":
      start = now - HOUR
      break
    case "2h":
      start = now - 2 * HOUR
      break
    case "today":
      start = todayStart(now)
      break
    case "7d":
      start = todayStart(now) - 6 * DAY
      break
    case "30d":
      start = todayStart(now) - 29 * DAY
      break
    case "term":
      start = termStart(now)
      break
    case "custom":
      if (custom) {
        start = custom[0]
        end = custom[1] + DAY
      } else {
        start = todayStart(now)
      }
      break
    default:
      start = null
  }
  const text = describe(start, end, period)
  return {
    start: start === null ? undefined : new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    text,
    /** 范围落在今天以内：提交列表那边能用「今天」接上 */
    withinToday: start !== null && start >= todayStart(now),
  }
}

function describe(start: number | null, end: number, period: Period) {
  if (start === null) return ""
  if (period === "1h" || period === "2h") {
    return `${parseTime(new Date(start), "HH:mm")}–${parseTime(new Date(end), "HH:mm")}`
  }
  const from = parseTime(new Date(start), "M月D日")
  const to = parseTime(new Date(end - 1), "M月D日")
  return from === to ? from : `${from}–${to}`
}

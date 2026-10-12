import type { LearningItem } from "@oj2/contract"
import { JUDGE_STATUS } from "utils/constants"

const WEEKDAY = "日一二三四五六"

/** `2026-09-18` → 9月18日 / 周五。日历日本身就是东八区的，直接拆字符串，不经 Date */
export function dayLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number]
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay()
  return { date: `${month}月${date}日`, weekday: `周${WEEKDAY[weekday]}` }
}

export function statusName(result: number | null) {
  if (result === null) return ""
  return JUDGE_STATUS[result as keyof typeof JUDGE_STATUS]?.name ?? ""
}

export function isDone(item: LearningItem) {
  return item.status === "first" || item.status === "tries"
}

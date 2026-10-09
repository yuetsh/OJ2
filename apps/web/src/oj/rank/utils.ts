import type { RankPeriod, RankRow, RankScope } from "@oj2/contract"
import { classLabel } from "oj/submission/utils"

export const SCOPE_OPTIONS: { value: RankScope; label: string }[] = [
  { value: "class", label: "本班" },
  { value: "grade", label: "本年级" },
  { value: "all", label: "全服" },
]

export const PERIOD_OPTIONS: { value: RankPeriod; label: string }[] = [
  { value: "week", label: "这周" },
  { value: "term", label: "这学期" },
  { value: "all", label: "全部" },
]

export function scopeLabel(scope: RankScope) {
  return SCOPE_OPTIONS.find((option) => option.value === scope)!.label
}

export function periodLabel(period: RankPeriod) {
  return PERIOD_OPTIONS.find((option) => option.value === period)!.label
}

/** 榜的标题：本班写班名，本年级写「25 级」，全服就是「全服」 */
export function groupTitle(scope: RankScope, className: string | null) {
  if (scope === "class" && className) return classLabel(className)
  if (scope === "grade" && className) return `${className} 级`
  return "全服"
}

/**
 * 两个人做到同样多道的时间差，说成学生的话：「6 秒」「2 分 40 秒」「3 小时」「2 天」。
 * 一节课的最后一道，全班常常差在几秒到几十秒 —— 这就是竞争感的来源，秒要写出来。
 */
export function gapText(earlier: string, later: string) {
  const seconds = Math.max(0, Math.round((Date.parse(later) - Date.parse(earlier)) / 1000))
  if (seconds === 0) return "同一秒"
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`
  }
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时`
  return `${Math.floor(seconds / 86_400)} 天`
}

/**
 * 再做对几道能超过 `target`：一样多时先做到的在前，后做到的人只能靠多做 1 道超过 ——
 * 所以永远是「差几道 + 1」。
 */
export function toPass(me: RankRow, target: RankRow) {
  return target.solved - me.solved + 1
}

/** 这张榜上升得最猛的人（至少升 3 名才算），给他挂「冲得最猛」 */
export function hottest(rows: RankRow[]) {
  let best: RankRow | null = null
  for (const row of rows) {
    if ((row.change ?? 0) >= 3 && (!best || row.change! > best.change!)) best = row
  }
  return best
}

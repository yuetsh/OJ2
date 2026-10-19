import type { Tone } from "shared/composables/tone"
import { parseTime } from "utils/functions"
import type { ClassBoardCell, ClassBoardStudent } from "utils/types"

/**
 * 课堂看板的格子：一个学生 × 一道题。显示什么字、什么颜色、悬停说什么，都是纯函数，
 * 和 errorKind.ts 一样单放一个文件（看板组件只管排版和交互）。
 */

/** 同一道题今天交了这么多次还没过，算卡住 */
export const STUCK_ATTEMPTS = 3

/** 今天之前就通过了的，颜色淡一档。`day` 是看板的「今天」（东八区日期） */
export function acceptedToday(cell: ClassBoardCell, day: string | undefined) {
  return !!cell.acceptedAt && parseTime(cell.acceptedAt, "YYYY-MM-DD") === day
}

export function cellText(cell: ClassBoardCell) {
  if (cell.status === "accepted") return "✓"
  if (cell.status === "tried") return cell.attempts ? `✗ ${cell.attempts}` : "✗"
  return ""
}

export function cellStyle(
  cell: ClassBoardCell,
  day: string | undefined,
  colors: {
    tone: (kind: Tone) => { color: string; background: string }
    errorColor: string
    actionColor: string
  },
) {
  if (cell.status === "accepted") {
    const t = colors.tone("success")
    return acceptedToday(cell, day)
      ? { background: t.background, color: t.color }
      : { background: t.background, color: t.color, opacity: 0.5 }
  }
  if (cell.status === "tried") {
    if (cell.attempts >= STUCK_ATTEMPTS) {
      return { background: colors.errorColor, color: "#ffffff" }
    }
    const t = colors.tone("warning")
    return { background: t.background, color: t.color }
  }
  return { background: colors.actionColor }
}

export function cellTitle(
  cell: ClassBoardCell,
  student: ClassBoardStudent,
  day: string | undefined,
) {
  if (cell.status === "accepted") {
    return acceptedToday(cell, day)
      ? `${parseTime(cell.acceptedAt!, "HH:mm")} 做对`
      : "以前就做对了"
  }
  if (cell.status === "tried") {
    if (cell.latest) return `讲讲 ${student.username} 这道题的错`
    return cell.attempts ? `今天画了 ${cell.flowchartAttempts} 张流程图` : "以前交过，没做对"
  }
  return ""
}

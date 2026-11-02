import type { LessonMode } from '@oj2/contract'
import type { Tone } from 'shared/composables/tone'
import { parseTime } from 'utils/functions'
import type { TaskBoardCell, TaskBoardStudent } from 'utils/types'

/**
 * 课堂任务的格子：一个学生 × 一道题。显示什么字、什么颜色、悬停说什么，都是纯函数，
 * 和 errorKind.ts 一样单放一个文件（任务页组件只管排版和交互）。
 *
 * `mode` 是这节课做什么（契约 lessonModeSchema），推断出来的课为 null。先画再写的格子是一条进度：
 * 在画 → 图画对了（空心绿「图 ✓」）→ 在写 → 两样都对（实心绿 ✓）。先写了代码、还没画图的写「缺图」
 */

/** 同一道题今天交了这么多次还没过，算卡住 */
export const STUCK_ATTEMPTS = 3

/**
 * 没做完的格子卡在哪一步：draw = 在画流程图、code = 在写代码、nodraw = 代码对了但还没画图。
 * 只画流程图的课一律是 draw；写代码的课和推断出来的课一律是 code
 */
export type CellStage = 'draw' | 'code' | 'nodraw'

export function cellStage(cell: TaskBoardCell, mode: LessonMode | null): CellStage {
  if (mode === 'flowchart') return 'draw'
  if (mode !== 'both' || !cell.flowchart) return 'code'
  if (cell.flowchart.status === 'tried') return 'draw'
  if (cell.flowchart.status === 'none' && cell.codeStatus === 'accepted') return 'nodraw'
  return 'code'
}

/** 今天在卡着的那一步上交了几次：先画再写的课里，画了三张才画对的人写代码时不该算卡住 */
export function stageAttempts(cell: TaskBoardCell, mode: LessonMode | null) {
  if (mode !== 'both') return cell.attempts
  const stage = cellStage(cell, mode)
  return stage === 'draw' ? cell.flowchartAttempts : stage === 'code' ? cell.codeAttempts : 0
}

/** 卡住了：没做完，而且在卡着的那一步上今天交了 STUCK_ATTEMPTS 次以上 */
export function isStuck(cell: TaskBoardCell, mode: LessonMode | null) {
  return cell.status === 'tried' && stageAttempts(cell, mode) >= STUCK_ATTEMPTS
}

/** 先画再写：图画对了、代码还没交过 —— 空心绿的「图 ✓」 */
function halfDone(cell: TaskBoardCell, mode: LessonMode | null) {
  return mode === 'both' && cell.status === 'tried' && cell.flowchart?.status === 'accepted' && cell.codeStatus === 'none'
}

/** 今天之前就通过了的，颜色淡一档。`day` 是任务页的「今天」（东八区日期） */
export function acceptedToday(cell: TaskBoardCell, day: string | undefined) {
  return !!cell.acceptedAt && parseTime(cell.acceptedAt, 'YYYY-MM-DD') === day
}

/** 最后一张图的那句：评分中 / 评失败 / 走对几组 */
function drawText(cell: TaskBoardCell, prefix: string) {
  const latest = cell.flowchart?.latest
  if (!latest) return '✗'
  if (latest.status === 0 || latest.status === 1) return '评分中'
  if (latest.status === 3) return '评失败'
  if (latest.passed !== null && latest.total) return `${prefix}${latest.passed}/${latest.total}`
  return '✗'
}

/** 做对了的写第几次做对：「✓ 9」是今天第 9 次才对，一次就对的、以前就对了的还是「✓」 */
export function cellText(cell: TaskBoardCell, mode: LessonMode | null = null) {
  if (cell.status === 'accepted') return (cell.acceptedTry ?? 1) > 1 ? `✓ ${cell.acceptedTry}` : '✓'
  if (cell.status === 'tried') {
    const stage = cellStage(cell, mode)
    if (stage === 'draw') return drawText(cell, mode === 'both' ? '图 ' : '')
    if (stage === 'nodraw') return '缺图'
    if (halfDone(cell, mode)) return '图 ✓'
    const attempts = mode === 'both' ? cell.codeAttempts : cell.attempts
    return attempts ? `✗ ${attempts}` : '✗'
  }
  return ''
}

export function cellStyle(
  cell: TaskBoardCell,
  day: string | undefined,
  colors: {
    tone: (kind: Tone) => { color: string; background: string }
    errorColor: string
    actionColor: string
    successColor: string
  },
  mode: LessonMode | null = null,
) {
  if (cell.status === 'accepted') {
    const t = colors.tone('success')
    return acceptedToday(cell, day) ? { background: t.background, color: t.color } : { background: t.background, color: t.color, opacity: 0.5 }
  }
  if (cell.status === 'tried') {
    if (halfDone(cell, mode)) {
      return { background: 'transparent', color: colors.tone('success').color, boxShadow: `inset 0 0 0 1.5px ${colors.successColor}` }
    }
    if (isStuck(cell, mode)) {
      return { background: colors.errorColor, color: '#ffffff' }
    }
    const t = colors.tone('warning')
    return { background: t.background, color: t.color }
  }
  return { background: colors.actionColor }
}

export function cellTitle(cell: TaskBoardCell, student: TaskBoardStudent, day: string | undefined, mode: LessonMode | null = null) {
  if (cell.status === 'accepted') {
    const when = acceptedToday(cell, day) ? `${parseTime(cell.acceptedAt!, 'HH:mm')} 做对` : '以前就做对了'
    if (cell.challenge === 'done') return `${when}，挑战也做到了`
    if (cell.challenge === 'doing') return `${when}，在挑战`
    return when
  }
  if (cell.status === 'tried') {
    const stage = cellStage(cell, mode)
    if (stage === 'draw') {
      const latest = cell.flowchart?.latest
      if (latest?.status === 0 || latest?.status === 1) return 'AI 正在评这张图'
      return latest ? `讲讲 ${student.username} 这张图哪里画错了` : '还没画对'
    }
    if (stage === 'nodraw') return '代码做对了，流程图还没画'
    if (halfDone(cell, mode)) return '流程图画对了，代码还没交'
    if (cell.latest) return `讲讲 ${student.username} 这道题的错`
    if (mode === 'both' && cell.flowchart?.status === 'accepted') return '流程图画对了，代码以前交过、没做对'
    return cell.attempts ? `今天画了 ${cell.flowchartAttempts} 张流程图` : '以前交过，没做对'
  }
  return ''
}

/** 点开做对的格子，方块串旁边那句 */
export function trailSummary(cell: TaskBoardCell, day: string | undefined) {
  const total = cell.trail.length
  if (cell.acceptedTry === 1) return total === 1 ? '一次就做对' : `交了 ${total} 次，第 1 次就做对`
  if (cell.acceptedTry) return `交了 ${total} 次，第 ${cell.acceptedTry} 次做对`
  return acceptedToday(cell, day) ? `今天交了 ${total} 次代码` : `以前就做对了，今天又交了 ${total} 次`
}

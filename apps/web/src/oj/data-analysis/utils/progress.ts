import type { DataAnalysisProgress } from '@oj2/contract'

/**
 * 全班进度的分组（画布 DataAnalysisProgress）：按「卡在第几步」分组，同一步再按没过的原因细分。
 * 老师上课想知道的是「大部分人卡在哪、要不要停下来统一讲」，不是一张学生 × 步骤的大表。
 *
 * 「卡在第几步」= 学生动过手的最后一步：那一步没过就卡在那一步；过了就卡在下一步（还没运行过）。
 * 前面跳过没做的步骤不管 —— 学生可能直接跑第 3 步（第 1、2 步的代码跟着一起跑了）。
 */
export type ProgressStudent = DataAnalysisProgress['students'][number]

export interface ProgressReason {
  label: string
  students: ProgressStudent[]
}

export interface ProgressGroup {
  key: string
  kind: 'stuck' | 'done' | 'idle'
  /** 卡在第几步，从 0 数；全部做对 / 还没开始是 null */
  stepIndex: number | null
  students: ProgressStudent[]
  reasons: ProgressReason[]
}

const ERROR_LABELS: Record<string, string> = {
  NameError: '名字没定义',
  KeyError: '列名不对',
  FileNotFoundError: '文件名不对',
  SyntaxError: '写法有错',
  IndentationError: '缩进有错',
  AttributeError: '用法写错',
  TypeError: '类型不对',
  ValueError: '值不对',
  IndexError: '位置超出范围',
  ModuleNotFoundError: '用了没有的库',
  ZeroDivisionError: '除以 0',
  Timeout: '运行太久',
  Crashed: '程序意外退出',
}

/** 没过的原因说成一组的名字：去掉每个人不一样的那半句（「你的是 70.25」「你画了 40 根」），只留「哪里不对」 */
export function reasonLabel(failure: string | null, open: boolean) {
  if (open) return '还没交'
  if (!failure) return '还没对'
  if (failure.startsWith('error:')) {
    const type = failure.slice('error:'.length)
    return `运行出错${ERROR_LABELS[type] ? `（${ERROR_LABELS[type]}）` : ''}`
  }
  const cut = failure.search(/[，：,:]\s*你(的是|画了|的有|分了|写了)/)
  if (cut <= 0) return failure
  const head = failure.slice(0, cut)
  // 「标题」「avg 里「语文」这一项」光秃秃的，补一句；「图里应该是 4 根柱子…」本身就说清了
  return head.includes('应该') ? head : `${head}不对`
}

export interface StudentState {
  kind: 'stuck' | 'done' | 'idle'
  stepIndex: number | null
  /** 卡住那一步是动过手但没过（true），还是做完上一步、这一步还没运行（false） */
  tried: boolean
}

export function studentState(student: ProgressStudent): StudentState {
  const cells = student.steps
  if (cells.length && cells.every((c) => c.passed)) return { kind: 'done', stepIndex: null, tried: false }
  let last = -1
  cells.forEach((c, i) => {
    if (c.runs > 0 || c.passed) last = i
  })
  if (last < 0) return { kind: 'idle', stepIndex: null, tried: false }
  if (!cells[last]!.passed) return { kind: 'stuck', stepIndex: last, tried: true }
  // 最后动手的那步过了，前面却有没过的（跳着做的）：卡在前面第一个没过的
  const first = cells.findIndex((c) => !c.passed)
  return first > last ? { kind: 'stuck', stepIndex: first, tried: false } : { kind: 'stuck', stepIndex: first, tried: cells[first]!.runs > 0 }
}

export function groupProgress(progress: DataAnalysisProgress): ProgressGroup[] {
  const stuck = new Map<number, ProgressStudent[]>()
  const done: ProgressStudent[] = []
  const idle: ProgressStudent[] = []
  for (const s of progress.students) {
    const state = studentState(s)
    if (state.kind === 'done') done.push(s)
    else if (state.kind === 'idle') idle.push(s)
    else stuck.set(state.stepIndex!, [...(stuck.get(state.stepIndex!) ?? []), s])
  }

  const groups: ProgressGroup[] = [...stuck.entries()].map(([stepIndex, students]) => {
    const open = progress.steps[stepIndex]?.kind === 'open'
    const byReason = new Map<string, ProgressStudent[]>()
    for (const s of students) {
      const cell = s.steps[stepIndex]!
      const label = cell.runs > 0 || cell.passed ? reasonLabel(cell.lastFailure, open && !cell.submittedAt) : '还没运行过'
      byReason.set(label, [...(byReason.get(label) ?? []), s])
    }
    return {
      key: `stuck-${stepIndex}`,
      kind: 'stuck',
      stepIndex,
      students,
      reasons: [...byReason.entries()].map(([label, list]) => ({ label, students: list })).sort((a, b) => b.students.length - a.students.length),
    }
  })
  // 人多的组在上面
  groups.sort((a, b) => b.students.length - a.students.length || a.stepIndex! - b.stepIndex!)
  if (done.length) groups.push({ key: 'done', kind: 'done', stepIndex: null, students: done, reasons: [] })
  if (idle.length) groups.push({ key: 'idle', kind: 'idle', stepIndex: null, students: idle, reasons: [] })
  return groups
}

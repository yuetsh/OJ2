import {
  boxMistakes,
  spanMistakes,
  spanText,
  spansEqual,
  type AdminLabelingItem,
  type LabelingKind,
  type LabelingProgress,
  type LabelingProgressCell,
} from '@oj2/contract'

/**
 * 「全班情况」的两种看法都在这里算（设计文档第 6 节、3.5 节第 4 条）。「第一次对不对」「最常标成什么」
 * 都拿第一次交的内容对照**当前**答案现算 —— 老师改了答案，这里跟着变。
 */

type Student = LabelingProgress['students'][number]

export function answered(cell: LabelingProgressCell) {
  return cell.firstLabel !== null || cell.firstSpans !== null || cell.firstBoxes !== null
}

export function cellFirstCorrect(kind: LabelingKind, item: AdminLabelingItem, cell: LabelingProgressCell) {
  if (kind === 'span') return cell.firstSpans !== null && spansEqual(item.spans, cell.firstSpans)
  if (kind === 'box') return cell.firstBoxes !== null && boxMistakes(item.boxes, cell.firstBoxes).length === 0
  return cell.firstLabel !== null && cell.firstLabel === item.answer
}

// ---------------------------------------------------------------- 按人

export interface PersonRow {
  student: Student
  passed: number
  firstCorrect: number
  wrongCount: number
}

export interface PeopleView {
  done: PersonRow[]
  doing: PersonRow[]
  idle: PersonRow[]
  /** 做完的人平均一次就对几条；没人做完是 null */
  doneAverage: number | null
  /** 错了几次标橙的门槛：超过这一节条数的四成 */
  manyWrong: number
}

export function peopleView(p: LabelingProgress): PeopleView {
  const total = p.items.length
  const rows = p.students.map((student) => ({
    student,
    passed: student.cells.filter((c) => c.passed).length,
    firstCorrect: student.cells.filter((c, i) => cellFirstCorrect(p.kind, p.items[i]!, c)).length,
    wrongCount: student.cells.reduce((sum, c) => sum + c.wrongCount, 0),
  }))
  const done = rows.filter((r) => total > 0 && r.passed === total).sort((a, b) => a.firstCorrect - b.firstCorrect || b.wrongCount - a.wrongCount)
  const idle = rows.filter((r) => r.student.cells.every((c) => !answered(c)))
  const doing = rows.filter((r) => !done.includes(r) && !idle.includes(r)).sort((a, b) => a.passed - b.passed || b.wrongCount - a.wrongCount)
  return {
    done,
    doing,
    idle,
    doneAverage: done.length ? done.reduce((sum, r) => sum + r.firstCorrect, 0) / done.length : null,
    manyWrong: Math.max(3, Math.ceil(total * 0.4)),
  }
}

// ---------------------------------------------------------------- 按数据

export interface ItemRow {
  item: AdminLabelingItem
  index: number
  answered: number
  firstCorrect: number
  /** 最常见的那处错：分类是「标错的多半选了 X」，实体标注是「漏标『碎叶城』」，框选是「漏框一个『人』」这类 */
  topMistake: { text: string; count: number } | null
  /** 最常见的错比第一次就对的人还多 → 可能答案定错了，整行标橙 */
  flagged: boolean
}

function mistakeKeys(kind: LabelingKind, item: AdminLabelingItem, cell: LabelingProgressCell): string[] {
  if (kind === 'box') {
    // 框没有名字，只能说是哪一类；同一类有好几个框时，答案里第几个框记在键里但不显示（分开数）
    return boxMistakes(item.boxes, cell.firstBoxes ?? []).map((m) => {
      if (m.kind === 'missing') return `漏框一个「${m.box.label}」\u200b${m.index}`
      if (m.kind === 'label') return `「${m.box.label}」框成了「${m.got}」\u200b${m.index}`
      if (m.kind === 'range') return `一个「${m.box.label}」框歪了\u200b${m.index}`
      return `多框了一个「${m.box.label}」`
    })
  }
  if (kind !== 'span') return cell.firstLabel !== null && cell.firstLabel !== item.answer ? [cell.firstLabel] : []
  return spanMistakes(item.spans, cell.firstSpans ?? []).map((m) => {
    const words = spanText(item.text, m.span)
    if (m.kind === 'missing') return `漏标「${words}」`
    if (m.kind === 'label') return `「${words}」标成了${m.got}`
    if (m.kind === 'range') return `「${words}」标的字多了或少了`
    return `多标「${words}」`
  })
}

export function itemsView(p: LabelingProgress): ItemRow[] {
  const rows = p.items.map((item, index) => {
    const cells = p.students.map((s) => s.cells[index]!).filter(answered)
    const counts = new Map<string, number>()
    for (const cell of cells) {
      for (const key of new Set(mistakeKeys(p.kind, item, cell))) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    const firstCorrect = cells.filter((c) => cellFirstCorrect(p.kind, item, c)).length
    return {
      item,
      index,
      answered: cells.length,
      firstCorrect,
      // 框选的键末尾带着「答案里第几个框」，显示时去掉
      topMistake: top ? { text: top[0].split('\u200b')[0]!, count: top[1] } : null,
      flagged: !!top && top[1] > firstCorrect,
    }
  })
  // 第一次就对的比例从低到高；还没人做的排最后，按原来的顺序
  const ratio = (r: ItemRow) => (r.answered ? r.firstCorrect / r.answered : 2)
  return rows.sort((a, b) => ratio(a) - ratio(b) || a.index - b.index)
}

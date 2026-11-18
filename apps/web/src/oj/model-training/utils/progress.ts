import type { ModelTrainingProgress } from '@oj2/contract'

/**
 * 老师看全班的两种看法（画布 TrainProgressPeople / TrainProgressItems），都由接口给的每人改动现算。
 * - 标错的（shown ≠ answer）：改成正确标签、或者删掉了，都算改对（和学生复盘一个口径）；
 * - 改坏的：原本标对，被改成了别的标签（删掉好数据不算）。
 */
type Student = ModelTrainingProgress['students'][number]

function studentStats(p: ModelTrainingProgress, s: Student) {
  const relabel = new Map(s.relabels.map((r) => [r.id, r.label]))
  const removed = new Set(s.removed)
  let fixed = 0
  let broken = 0
  for (const item of p.items) {
    const now = relabel.get(item.id)
    if (item.shown !== item.answer) {
      if (removed.has(item.id) || now === item.answer) fixed++
    } else if (!removed.has(item.id) && now !== undefined && now !== item.answer) {
      broken++
    }
  }
  return { student: s, fixed, broken }
}

export type PersonRow = ReturnType<typeof studentStats>

export function peopleView(p: ModelTrainingProgress) {
  const rows = p.students.map((s) => studentStats(p, s))
  const byBest = (a: PersonRow, b: PersonRow) => (a.student.best ?? 0) - (b.student.best ?? 0)
  return {
    mislabeled: p.items.filter((i) => i.shown !== i.answer).length,
    passed: rows.filter((r) => r.student.passed).sort(byBest),
    notPassed: rows.filter((r) => !r.student.passed && r.student.runs > 0).sort(byBest),
    idle: rows.filter((r) => !r.student.passed && r.student.runs === 0),
  }
}

export function itemsView(p: ModelTrainingProgress) {
  const active = p.students.filter((s) => s.runs > 0)
  const maps = active.map((s) => ({ relabel: new Map(s.relabels.map((r) => [r.id, r.label])), removed: new Set(s.removed) }))
  const mislabeled = p.items
    .filter((i) => i.shown !== i.answer)
    .map((item) => ({ item, fixed: maps.filter((m) => m.removed.has(item.id) || m.relabel.get(item.id) === item.answer).length }))
    .sort((a, b) => a.fixed - b.fixed)
  const broken = p.items
    .filter((i) => i.shown === i.answer)
    .map((item) => {
      const counts = new Map<string, number>()
      for (const m of maps) {
        const now = m.relabel.get(item.id)
        if (!m.removed.has(item.id) && now !== undefined && now !== item.answer) counts.set(now, (counts.get(now) ?? 0) + 1)
      }
      const total = [...counts.values()].reduce((a, b) => a + b, 0)
      const top = [...counts].sort((a, b) => b[1] - a[1])[0]
      return { item, total, top: top ? { label: top[0], count: top[1] } : null }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
  // 被很多人改成同一个：句子可能有歧义，或者答案定错了（整行标橙）
  const flagAt = Math.max(3, Math.ceil(active.length / 4))
  return { active: active.length, mislabeled, broken: broken.map((r) => ({ ...r, flagged: (r.top?.count ?? 0) >= flagAt })) }
}

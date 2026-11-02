import type { LessonUpdate } from '@oj2/contract'

/**
 * 课上老师改了这节课的题（/ws/config 推来的 lesson_update），等学生点「刷新」。
 * useConfigUpdate 收、LessonUpdateNotice 显示，两头不在一个组件里，所以放模块级。
 */
export const pendingLessonUpdate = shallowRef<LessonUpdate | null>(null)

type Item = LessonUpdate['problems'][number]

function minus(list: Item[], other: Item[]) {
  const ids = new Set(other.map((item) => item.problemDisplayId))
  return list.filter((item) => !ids.has(item.problemDisplayId))
}

/**
 * 还没点刷新老师又改了一次：并成一条，免得第二条把第一次加的题盖掉。
 * 刚布置（还没刷新）又改 → 仍算刚布置，题目按最新的列；两次「改」→ 加的、去掉的互相抵消后合起来
 */
export function receiveLessonUpdate(next: LessonUpdate) {
  const prev = pendingLessonUpdate.value
  if (!prev || next.kind !== 'changed' || prev.kind === 'cleared') {
    pendingLessonUpdate.value = next
    return
  }
  if (prev.kind === 'assigned') {
    pendingLessonUpdate.value = { ...next, kind: 'assigned', added: [], removed: [], languageChanged: false, reordered: false }
    return
  }
  const merged: LessonUpdate = {
    ...next,
    added: [...minus(prev.added, next.removed), ...minus(next.added, prev.removed)],
    removed: [...minus(prev.removed, next.added), ...minus(next.removed, prev.added)],
    languageChanged: prev.languageChanged || next.languageChanged,
    reordered: prev.reordered || next.reordered,
  }
  // 改回去了：等于没改
  const nothing = !merged.added.length && !merged.removed.length && !merged.languageChanged && !merged.reordered
  pendingLessonUpdate.value = nothing ? null : merged
}

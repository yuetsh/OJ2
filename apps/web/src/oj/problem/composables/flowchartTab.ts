import { storeToRefs } from 'pinia'
import { useCodeStore } from 'oj/store/code'
import { useFlowchartStore } from 'oj/store/flowchart'
import { useProblemStore } from 'oj/store/problem'
import { useMyFlowchartStore } from 'shared/store/myFlowchart'

/**
 * 这道题评过的流程图里最好的那一次是几级（标题旁的「流程图 X 级」、「流程图」页签上的小绿块）。
 * 没评过是空串
 */
export function useFlowchartGrade() {
  const flowchartStore = useFlowchartStore()
  return computed(() => {
    const best = flowchartStore.scores.reduce<(typeof flowchartStore.scores)[number] | null>((acc, row) => (!acc || row.score > acc.score ? row : acc), null)
    return best?.grade ?? ''
  })
}

/**
 * 左栏有没有「流程图」页签：老师给了参考图，或者学生自己画到了 A/S（两个开关在出题页互斥，
 * 后端在能画流程图的题上不下发参考图的 mermaidCode）。
 *
 * 学生切到「画流程图」时不给：右边就是画布，左边再摆一张自己的图是重复的。参考图的题画不了流程图，
 * 不受这一条影响
 */
export function useFlowchartTab() {
  const { problem } = storeToRefs(useProblemStore())
  const myFlowchartStore = useMyFlowchartStore()
  const codeStore = useCodeStore()
  const reference = computed(() => !!problem.value?.showFlowchart && !!problem.value?.mermaidCode)
  return computed(() => {
    if (reference.value) return true
    return myFlowchartStore.showing && codeStore.code.language !== 'Flowchart'
  })
}

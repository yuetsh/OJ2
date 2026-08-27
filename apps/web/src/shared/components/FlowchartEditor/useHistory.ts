import { shallowRef, computed } from "vue"
import type { Node, Edge } from "@vue-flow/core"

/**
 * 简化的历史记录管理
 */
export function useHistory() {
  const history = shallowRef<{ nodes: Node[]; edges: Edge[] }[]>([])
  const historyIndex = ref(-1)

  // 是否可以撤销
  const canUndo = computed(() => historyIndex.value > 0)

  // 是否可以重做
  const canRedo = computed(() => historyIndex.value < history.value.length - 1)

  const deepCopyState = (
    nodes: Node[],
    edges: Edge[],
  ): { nodes: Node[]; edges: Edge[] } =>
    JSON.parse(JSON.stringify({ nodes, edges })) as {
      nodes: Node[]
      edges: Edge[]
    }

  // 保存状态到历史记录
  const saveState = (nodes: Node[], edges: Edge[]) => {
    const currentState = deepCopyState(nodes, edges)

    // 如果当前不在历史记录的末尾，删除后面的记录
    if (historyIndex.value < history.value.length - 1) {
      history.value = history.value.slice(0, historyIndex.value + 1)
    }

    history.value = [...history.value, currentState]
    historyIndex.value = history.value.length - 1

    // 限制历史记录数量
    if (history.value.length > 20) {
      history.value = history.value.slice(1)
      historyIndex.value--
    }
  }

  // 用当前画布重建历史。挂载时和换题后都要调一次：
  // 不播下这个初始快照的话 historyIndex 会从 -1 开始，canUndo 要求 index > 0，
  // 第一步操作永远撤销不了；换题后不重建则一次撤销会把上一题的图还原到这一题里。
  const resetHistory = (nodes: Node[], edges: Edge[]) => {
    history.value = [deepCopyState(nodes, edges)]
    historyIndex.value = 0
  }

  // 撤销
  const undo = () => {
    if (canUndo.value) {
      historyIndex.value--
      const state = history.value[historyIndex.value]
      return deepCopyState(state.nodes, state.edges)
    }
    return null
  }

  // 重做
  const redo = () => {
    if (canRedo.value) {
      historyIndex.value++
      const state = history.value[historyIndex.value]
      return deepCopyState(state.nodes, state.edges)
    }
    return null
  }

  return {
    canUndo,
    canRedo,
    resetHistory,
    saveState,
    undo,
    redo,
  }
}

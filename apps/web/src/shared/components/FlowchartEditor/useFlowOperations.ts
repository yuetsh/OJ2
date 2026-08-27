import { nextTick } from "vue"
import type { Ref } from "vue"
import type { Node, Edge, Connection } from "@vue-flow/core"
import { useVueFlow } from "@vue-flow/core"
import { getRandomId } from "utils/functions"

export function useFlowOperations(
  nodes: Ref<Node[]>,
  edges: Ref<Edge[]>,
  addEdges: (edges: Edge[]) => void,
  removeNodes: (nodeIds: string[]) => void,
  removeEdges: (edgeIds: string[]) => void,
  saveState: (nodes: Node[], edges: Edge[]) => void,
) {
  const { findNode, getSelectedNodes, getSelectedEdges } = useVueFlow()
  const getAutoLabel = (
    sourceNode: Node | undefined,
    targetNode: Node | undefined,
    sourceHandle: string | null | undefined,
    targetHandle: string | null | undefined,
  ) => {
    const sourceType = sourceNode?.data?.originalType || sourceNode?.type
    const targetType = targetNode?.data?.originalType || targetNode?.type

    // 如果是判断节点
    if (sourceType === "decision") {
      // 根据handle ID推断标签
      if (sourceHandle === "yes") {
        return "是"
      } else if (sourceHandle === "no") {
        return "否"
      }
    }

    // 如果是循环节点
    if (sourceType === "loop") {
      // 根据handle ID推断标签
      if (sourceHandle === "continue") {
        return "继续"
      } else if (sourceHandle === "exit") {
        return "退出"
      }
    }

    // 如果是循环体回到循环节点
    if (targetType === "loop") {
      if (targetHandle === "return") {
        return "返回"
      }
    }
    // 默认情况
    return ""
  }

  const handleConnect = async (params: Connection) => {
    const sourceNode = nodes.value.find((node) => node.id === params.source)
    const targetNode = nodes.value.find((node) => node.id === params.target)

    // 自动推断标签
    const autoLabel = getAutoLabel(
      sourceNode,
      targetNode,
      params.sourceHandle,
      params.targetHandle,
    )

    const newEdge: Edge = {
      id: `edge-${getRandomId()}`,
      source: params.source,
      target: params.target,
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle,
      type: "default",
      label: autoLabel,
    }

    addEdges([newEdge])
    // vue-flow 的 store → v-model 回写走的是 watch（pre flush，异步），
    // 紧接着读 nodes/edges 拿到的还是改动前的数组，存进历史就会错开一步。
    // 画布上 handleDrop 早就这么等了，这几处一直漏了。
    await nextTick()
    saveState(nodes.value, edges.value)
  }

  const handleEdgeClick = async ({ edge }: { edge: Edge }) => {
    removeEdges([edge.id])
    await nextTick()
    saveState(nodes.value, edges.value)
  }

  // 节点删除。removeNodes 的 removeConnectedEdges 默认就是 true，
  // 相连的边不用自己再删一遍
  const handleNodeDelete = async (nodeId: string) => {
    removeNodes([nodeId])
    await nextTick()
    saveState(nodes.value, edges.value)
  }

  // 节点更新，空标签时清除自定义标签（恢复默认类型名称）
  const handleNodeUpdate = (nodeId: string, newLabel: string) => {
    const node = findNode(nodeId)
    if (node) {
      if (newLabel) {
        node.data = { ...node.data, customLabel: newLabel }
      } else {
        const { customLabel: _, ...rest } = node.data
        node.data = rest
      }
      saveState(nodes.value, edges.value)
    }
  }

  // 清空画布
  const clearCanvas = () => {
    nodes.value = []
    edges.value = []
    saveState(nodes.value, edges.value)
  }

  // 删除选中的节点和边
  const deleteSelected = async () => {
    const selectedNodes = getSelectedNodes.value
    const selectedEdges = getSelectedEdges.value
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return

    if (selectedNodes.length > 0) {
      removeNodes(selectedNodes.map((node) => node.id))
    }
    if (selectedEdges.length > 0) {
      removeEdges(selectedEdges.map((edge) => edge.id))
    }
    await nextTick()
    saveState(nodes.value, edges.value)
  }

  return {
    handleConnect,
    handleEdgeClick,
    handleNodeDelete,
    handleNodeUpdate,
    clearCanvas,
    deleteSelected,
  }
}

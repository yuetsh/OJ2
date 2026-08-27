import { ref, toValue, watch, type Ref, type MaybeRefOrGetter } from "vue"
import { useStorage, useDebounceFn } from "@vueuse/core"
import type { Node, Edge } from "@vue-flow/core"
import { toPortableEdges, toPortableNodes } from "./serialize"

/**
 * 缓存管理 - 使用 @vueuse 的 useStorage
 */
export function useCache(
  nodes: Ref<Node[]>,
  edges: Ref<Edge[]>,
  storageKey: MaybeRefOrGetter<string> = "flowchart-editor-data",
  onReloaded?: () => void,
) {
  const isSaving = ref(false)
  const lastSaved = ref<Date | null>(null)
  const hasUnsavedChanges = ref(false)

  // 使用 useStorage 管理数据存储，支持响应式 key（题目 ID 异步加载时自动切换）
  const storedData = useStorage<{
    nodes: Node[]
    edges: Edge[]
    timestamp: string
  }>(storageKey, {
    nodes: [],
    edges: [],
    timestamp: "",
  })

  // 防抖保存：isSaving 在 watch 中置 true，保存完成后置 false，使 UI 能感知保存中状态
  const debouncedSave = useDebounceFn(() => {
    storedData.value.nodes = toPortableNodes(nodes.value)
    storedData.value.edges = toPortableEdges(edges.value)
    storedData.value.timestamp = new Date().toISOString()
    lastSaved.value = new Date()
    hasUnsavedChanges.value = false
    isSaving.value = false
  }, 500)

  // 立即保存
  const saveToCache = () => {
    isSaving.value = true
    storedData.value.nodes = toPortableNodes(nodes.value)
    storedData.value.edges = toPortableEdges(edges.value)
    storedData.value.timestamp = new Date().toISOString()
    lastSaved.value = new Date()
    hasUnsavedChanges.value = false
    isSaving.value = false
  }

  // 从缓存加载数据
  const loadFromCache = () => {
    if (storedData.value.nodes?.length || storedData.value.edges?.length) {
      nodes.value = storedData.value.nodes
      edges.value = storedData.value.edges
      lastSaved.value = storedData.value.timestamp
        ? new Date(storedData.value.timestamp)
        : null
      hasUnsavedChanges.value = false
      return true
    }
    return false
  }

  // 清除缓存数据
  const clearCache = () => {
    storedData.value = { nodes: [], edges: [], timestamp: "" }
    lastSaved.value = null
    hasUnsavedChanges.value = false
  }

  // 题目 ID 异步加载完成、或直接切到下一题时 storageKey 会变。
  // useStorage 只把新 key 的内容读进 storedData，不会回填 nodes/edges：
  // 不处理的话画布会继续显示上一题的图，学生一动就把上一题的内容写进这一题的
  // key，把这道题原本存着的草稿覆盖掉。
  // 这里依赖 useStorage 内部对 key 的 watch 先于本 watch 执行（两者都是 pre
  // flush，且 useStorage 在上方先创建，pre 队列按创建顺序跑），
  // 因此此刻 storedData 已经是新 key 的数据。
  watch(
    () => toValue(storageKey),
    () => {
      if (!loadFromCache()) {
        nodes.value = []
        edges.value = []
        lastSaved.value = null
        hasUnsavedChanges.value = false
      }
      onReloaded?.()
    },
  )

  // 监听节点和边的变化，isSaving 在此置 true 以覆盖防抖等待窗口
  watch(
    [nodes, edges],
    () => {
      hasUnsavedChanges.value = true
      isSaving.value = true
      debouncedSave()
    },
    { deep: true },
  )

  return {
    isSaving,
    lastSaved,
    hasUnsavedChanges,
    saveToCache,
    loadFromCache,
    clearCache,
  }
}

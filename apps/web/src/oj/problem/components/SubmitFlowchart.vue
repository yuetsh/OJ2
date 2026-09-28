<script lang="ts" setup>
import { storeToRefs } from "pinia"
import { compressToBase64 } from "utils/functions"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useMermaidConverter } from "../composables/useMermaidConverter"
import { useProblemStore } from "oj/store/problem"
import { useFlowchartStore, type FlowchartEditorInstance } from "oj/store/flowchart"

/**
 * 「交给 AI 点评」按钮。
 *
 * 提交和评分（WebSocket + 轮询 + 超时）在 flowchart store；评分结果、历次分数、载回旧版
 * 都在左栏「结果」页签（FlowchartResult）。原来这里还有一个分数按钮和 1000px 的评分弹框，
 * 弹框盖住画布，学生没法一边看改进建议一边改图。
 */

const flowchartEditorRef = inject<Ref<FlowchartEditorInstance | null>>("flowchartEditorRef")

const message = useMessage()
const { problem } = storeToRefs(useProblemStore())
const flowchartStore = useFlowchartStore()
const { loading } = storeToRefs(flowchartStore)
const { isDesktop } = useBreakpoints()
const { convertToMermaid } = useMermaidConverter()

function submit() {
  const editor = flowchartEditorRef?.value
  if (!editor) return
  const flowchartData = editor.getFlowchartData()
  if (!flowchartData?.nodes?.length || !flowchartData?.edges?.length) {
    message.warning("画布上还没有图：从左边拖几个框进来，再用线连起来")
    return
  }
  flowchartStore.submit(
    convertToMermaid(flowchartData),
    compressToBase64(JSON.stringify(flowchartData)),
  )
}

// 进题、换题都读一次历次分数（store 里同一道题只读一次）
watch(() => problem.value?.id, flowchartStore.ensureLoaded, { immediate: true })
</script>

<template>
  <n-button
    :size="isDesktop ? 'medium' : 'small'"
    type="primary"
    :loading="loading"
    :disabled="loading"
    @click="submit"
  >
    {{ loading ? "AI 点评中…" : "交给 AI 点评" }}
  </n-button>
</template>

<script lang="ts" setup>
import { storeToRefs } from "pinia"
import { useBreakpoints } from "shared/composables/breakpoints"
import { countBlank } from "shared/components/FlowchartEditor/model"
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
const { loading, unchanged } = storeToRefs(flowchartStore)
const { isDesktop } = useBreakpoints()

function submit() {
  const editor = flowchartEditorRef?.value
  if (!editor) return
  const doc = editor.getDoc()
  if (!doc.steps.length) {
    message.warning("画布上还没有图：点「开始」下面的 +，加第一步")
    return
  }
  // 空框交上去 AI 只能瞎猜，学生也不知道扣分是因为忘了写字
  const blank = countBlank(doc.steps)
  if (blank) {
    message.warning(`有 ${blank} 个框还没写字，点一下框就能写`)
    return
  }
  flowchartStore.submit(doc)
}

// 进题、换题都读一次历次分数（store 里同一道题只读一次）
watch(() => problem.value?.id, flowchartStore.ensureLoaded, { immediate: true })
</script>

<template>
  <n-button
    :size="isDesktop ? 'medium' : 'small'"
    type="primary"
    :loading="loading"
    :disabled="loading || unchanged"
    :title="unchanged && !loading ? '这一版已经点评过了，改一改再交' : undefined"
    @click="submit"
  >
    {{ loading ? "AI 点评中…" : "交给 AI 点评" }}
  </n-button>
</template>

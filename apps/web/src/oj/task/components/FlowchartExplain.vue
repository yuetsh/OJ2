<script setup lang="ts">
import { getFlowchartSubmission } from 'oj/api'
import FlowchartNote from 'shared/components/FlowchartNote.vue'
import { useMermaid } from 'shared/composables/useMermaid'
import { useTone } from 'shared/composables/tone'
import { caseReport, fitFlowchartGraph, flowchartVerdict, markFlowchartFocus } from 'utils/flowchart'
import type { FlowchartSubmission } from 'utils/types'

/**
 * 课堂任务「讲错误」弹层里的一张流程图：要画流程图的课，点卡在画图上的人打开它。
 * 左边是他最后画的那张（要改的框标红），右边是 AI 写的哪里错、可以怎么改 —— 和提交列表右栏
 * （FlowchartPane）、题目页结果页签同一套点评（FlowchartNote）。
 *
 * 挂在 n-modal 里（内容在 body 下），<style> 的 v-bind() 传不进来：颜色走外层弹层给的
 * CSS 变量（--card、--divider…），标红的颜色走根节点的内联变量
 */
const props = defineProps<{ id: string }>()

const tone = useTone()
const { renderError, renderFlowchart } = useMermaid()
const detail = ref<FlowchartSubmission | null>(null)
const failed = ref(false)
const graph = useTemplateRef<HTMLElement>('graph')
const openCase = ref<number | null>(null)
const casesOpen = ref(false)

const report = computed(() => caseReport(detail.value?.aiCriteriaDetails))
const vars = computed(() => ({
  '--focus-fill': tone('error').background,
  '--focus-stroke': tone('error').solid,
}))

let seq = 0
async function load() {
  const mine = ++seq
  failed.value = false
  openCase.value = null
  casesOpen.value = false
  try {
    const res = await getFlowchartSubmission(props.id)
    if (mine !== seq) return
    detail.value = res
    await nextTick()
    await renderFlowchart(graph.value, res.mermaidCode)
    fitFlowchartGraph(graph.value)
    markFlowchartFocus(graph.value, report.value)
  } catch {
    if (mine !== seq) return
    detail.value = null
    failed.value = true
  }
}
watch(() => props.id, load, { immediate: true })
</script>

<template>
  <div class="explain-flow" :style="vars">
    <div class="graph-box">
      <span v-if="renderError" class="muted">这张流程图画不出来，可能有框没连上</span>
      <div v-show="!renderError" ref="graph" class="graph"></div>
      <span v-if="failed" class="muted reload">没拉下来<n-button size="small" @click="load">再试一次</n-button></span>
    </div>
    <div v-if="detail" class="note-box">
      <template v-if="report">
        <b class="headline">{{ flowchartVerdict(report, detail.aiGrade) }}</b>
        <FlowchartNote
          v-model:selected="openCase"
          v-model:open="casesOpen"
          :report="report"
          :feedback="detail.aiFeedback"
          :suggestions="detail.aiSuggestions"
          :previous="detail.previousCases"
        />
      </template>
      <!-- 2026-10 之前的老评法没有走例子的报告，只有一段评语 -->
      <template v-else>
        <b class="headline">{{ detail.aiGrade ? `${detail.aiGrade} 级` : '还没画对' }}</b>
        <div v-if="detail.aiFeedback" class="plain">{{ detail.aiFeedback }}</div>
        <div v-if="detail.aiSuggestions" class="plain">{{ detail.aiSuggestions }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.explain-flow {
  display: flex;
  gap: 14px;
}

/* 图自己画了一层底框，外面不再套边框；高度压在一屏以内，讲的时候不用上下滚 */
.graph-box {
  flex: 0 0 60%;
  min-width: 0;
  height: min(620px, calc(100vh - 190px));
  display: flex;
  align-items: center;
  justify-content: center;
}

.graph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.note-box {
  border: 1px solid var(--divider);
  border-radius: 8px;
  background: var(--card);
}

.graph :deep(svg) {
  max-width: 100%;
  max-height: 100%;
}

.graph :deep(.pele-node.oj-focus > :not(text)) {
  fill: var(--focus-fill) !important;
  stroke: var(--focus-stroke) !important;
  stroke-width: 3px !important;
}

.note-box {
  flex: 1 1 0;
  min-width: 0;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.headline {
  font-size: 18px;
}

.plain {
  white-space: pre-wrap;
  line-height: 1.7;
}

.muted {
  color: var(--text3);
}

.reload {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 768px) {
  .explain-flow {
    flex-direction: column;
  }

  .graph-box {
    flex: none;
    height: 360px;
  }
}
</style>

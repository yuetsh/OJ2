<script setup lang="ts">
import { clearErrorMark, showErrorMark } from 'oj/problem/utils/errorMark'
import { explainRuntimeError, type RuntimeErrorInfo } from 'oj/problem/utils/runtimeError'
import SectionHead from './SectionHead.vue'

/**
 * 运行时错误的中文说明（诊断由后端 judge/runtime-diagnosis.ts 给）。
 * 知道是第几行的，就把那一行代码摆出来，并在编辑器里标红；卸掉时清掉标记。
 */
const props = defineProps<{
  info: RuntimeErrorInfo
  /** 这次提交的代码，用来摆出出错的那一行 */
  code: string
}>()

const message = computed(() => explainRuntimeError(props.info, props.code))

const sourceLine = computed(() => {
  const line = props.info.line
  if (!line) return null
  const text = props.code.split('\n')[line - 1]
  return text?.trim() ? text.trim() : null
})

watch(
  () => props.info.line,
  (line) => {
    if (line) showErrorMark(line, null, null)
    else clearErrorMark()
  },
  { immediate: true },
)

onUnmounted(clearErrorMark)
</script>

<template>
  <!-- 设计稿「题目页观感」结果 X：黄色小节标题说第几行，正文大小的中文说明，再把那一行代码摆出来 -->
  <div class="explain-section">
    <SectionHead icon="problem" tone="amber">{{ info.line ? `第 ${info.line} 行出错` : '程序跑到一半出错了' }}</SectionHead>
    <p class="explain">{{ message }}</p>
    <div v-if="sourceLine" class="explain-code">
      <span class="line-no">{{ info.line }}</span>
      <pre>{{ sourceLine }}</pre>
    </div>
  </div>
</template>

<style scoped>
.explain {
  margin: 0 0 10px;
  font-size: 16px;
  line-height: 1.75;
}

/* 出错的那一行：红底，前面写行号，和编辑器里标红的那一行对得上 */
.explain-code {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 5px 10px;
  border-radius: 6px;
  background-color: rgba(208, 48, 80, 0.06);
  border: 1px solid rgba(208, 48, 80, 0.24);
  font-family: Consolas, Monaco, monospace;
  font-size: 16px;
  line-height: 24px;
}

.line-no {
  flex: none;
  font-weight: 700;
  color: #d03050;
}

.explain-code pre {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font: inherit;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>

<script setup lang="ts">
import { clearErrorMark, showErrorMark } from "oj/problem/utils/errorMark"
import { explainRuntimeError, type RuntimeErrorInfo } from "oj/problem/utils/runtimeError"

/**
 * 运行时错误的中文说明卡片（诊断由后端 judge/runtime-diagnosis.ts 给）。
 * 知道是第几行的，就把那一行代码摆出来，并在编辑器里标红；卸掉时清掉标记。
 */
const props = defineProps<{
  info: RuntimeErrorInfo
  /** 这次提交的代码，用来摆出出错的那一行 */
  code: string
}>()

const message = computed(() => explainRuntimeError(props.info))

const sourceLine = computed(() => {
  const line = props.info.line
  if (!line) return null
  const text = props.code.split("\n")[line - 1]
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
  <n-card embedded class="explain-card">
    <n-flex vertical :size="12">
      <div class="explain">
        <b v-if="info.line">第 {{ info.line }} 行运行时出错：</b>{{ message }}
      </div>
      <pre v-if="sourceLine" class="explain-code">{{ sourceLine }}</pre>
    </n-flex>
  </n-card>
</template>

<style scoped>
/* 结果弹窗不限宽，长句子不折行会把弹窗撑出屏幕 */
.explain-card {
  max-width: 560px;
}

.explain {
  font-size: 16px;
  line-height: 1.7;
}

.explain-code {
  margin: 0;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 15px;
  white-space: pre-wrap;
  word-break: break-all;
  background-color: rgba(208, 48, 80, 0.12);
}
</style>

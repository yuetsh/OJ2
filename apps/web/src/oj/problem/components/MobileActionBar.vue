<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"
import SubmitCode from "./SubmitCode.vue"

/**
 * 手机上屏幕底部固定的「运行例子 / 提交」（设计文档 5.6）。原来这两个按钮在「代码」页签
 * 顶上，和语言、更多挤成两行；看着题面想交一次，还得先切回代码页签。
 * 提交状态、代码都在 store 里，编辑器没挂着也能交。
 */
const theme = useThemeVars()
const codeStore = useCodeStore()
const submissionStore = useSubmissionStore()
const { samplesRunning } = submissionStore.trial
const { problem } = storeToRefs(useProblemStore())

// 和工具栏同一个条件：Judge0 跑不了 SQL，流程图没得跑，没有例子的题不给
const canRunSamples = computed(
  () =>
    !!problem.value?.samples.length &&
    codeStore.code.language !== "Flowchart" &&
    codeStore.code.language !== "SQL",
)
</script>

<template>
  <div class="mobile-actions">
    <n-button
      v-if="canRunSamples"
      size="large"
      class="action"
      :loading="samplesRunning"
      :disabled="!codeStore.code.value.trim()"
      @click="submissionStore.runSamples()"
    >
      运行例子
    </n-button>
    <div class="action">
      <SubmitCode size="large" block />
    </div>
  </div>
</template>

<style scoped>
.mobile-actions {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  gap: 10px;
  padding: 8px 16px calc(8px + env(safe-area-inset-bottom));
  background-color: v-bind("theme.bodyColor");
  border-top: 1px solid rgba(128, 128, 128, 0.2);
  backdrop-filter: blur(8px);
}

.action {
  flex: 1;
  min-width: 0;
}

.mobile-actions :deep(.n-button) {
  height: 44px;
}
</style>

<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { useSubmissionStore } from "oj/store/submission"
import { SubmissionStatus } from "utils/constants"

/**
 * 「结果」页签的标题：带上这一次的状态。用图标而不是一个彩色小圆点 ——
 * 机房投影、色弱的学生只靠颜色分不出对错。
 */

const theme = useThemeVars()
const { submission, syntaxErrorInfo, judging, pending, submitting } =
  storeToRefs(useSubmissionStore())

const status = computed(() => {
  if (syntaxErrorInfo.value) return { icon: "ph:warning-bold", color: theme.value.warningColor }
  if (!submission.value) return null
  if (judging.value || pending.value || submitting.value)
    return { icon: "ph:circle-notch-bold", color: theme.value.infoColor, spin: true }
  const result = submission.value.result
  if (result === SubmissionStatus.accepted)
    return { icon: "ph:check-bold", color: theme.value.successColor }
  if (result === SubmissionStatus.ast_check_failed)
    return { icon: "ph:warning-bold", color: theme.value.warningColor }
  return { icon: "ph:x-bold", color: theme.value.errorColor }
})
</script>

<template>
  <span class="label">
    结果
    <Icon
      v-if="status"
      :icon="status.icon"
      :color="status.color"
      :class="{ spin: status.spin }"
      width="14"
    />
  </span>
</template>

<style scoped>
.label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { useSubmissionStore } from "oj/store/submission"
import { useCodeStore } from "oj/store/code"
import { isFlowchartPass, useFlowchartStore } from "oj/store/flowchart"
import { SubmissionStatus } from "utils/constants"

/**
 * 「结果」页签的标题：带上这一次的状态。用图标而不是一个彩色小圆点 ——
 * 机房投影、色弱的学生只靠颜色分不出对错。
 *
 * 新结果出来、学生还没点开看过：「结果」两个字跟着状态上色、加粗。看过一次就算已读，
 * 图标留着、不再强调（设计文档 5.3）。流程图评完时学生在看题目不会被强制切过去，
 * 靠的就是这一下提醒
 */
const props = defineProps<{ active: boolean }>()

const theme = useThemeVars()
const { submission, syntaxErrorInfo, judging, pending, submitting } =
  storeToRefs(useSubmissionStore())

const codeStore = useCodeStore()
const flowchart = storeToRefs(useFlowchartStore())

/** 画流程图时：评中转圈，A/S 打勾，B/C 是「还没过关」的 !，评失败是 ✕ */
const flowchartStatus = computed(() => {
  const phase = flowchart.phase.value
  if (phase === "evaluating")
    return { icon: "ph:circle-notch-bold", color: theme.value.infoColor, spin: true }
  if (phase === "failed") return { icon: "ph:x-bold", color: theme.value.errorColor }
  if (phase !== "done") return null
  return isFlowchartPass(flowchart.latestRating.value.grade)
    ? { icon: "ph:check-bold", color: theme.value.successColor }
    : { icon: "ph:warning-bold", color: theme.value.warningColor }
})

const status = computed(() => {
  if (codeStore.code.language === "Flowchart") return flowchartStatus.value
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

/**
 * 这一次结果的身份：哪条提交判成了什么、第几次流程图评分、哪一次语法没过。
 * 换了就是新结果，要重新提醒
 */
const resultKey = computed(() => {
  if (!status.value) return ""
  if (codeStore.code.language === "Flowchart")
    return `flowchart:${flowchart.evaluatedSeq.value}:${flowchart.phase.value}`
  if (syntaxErrorInfo.value) return `syntax:${syntaxErrorInfo.value}`
  return `submission:${submission.value?.id}:${submission.value?.result}`
})
const readKey = ref("")
watchEffect(() => {
  if (props.active) readKey.value = resultKey.value
})
const unread = computed(
  () => !!status.value && !status.value.spin && !props.active && resultKey.value !== readKey.value,
)
</script>

<template>
  <span class="label" :class="{ unread }" :style="unread ? { color: status!.color } : undefined">
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

.unread {
  font-weight: 700;
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

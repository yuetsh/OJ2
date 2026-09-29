<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { JUDGE_STATUS, SubmissionStatus } from "utils/constants"
import type { SUBMISSION_RESULT } from "utils/types"
import { useTone, type Tone } from "../composables/tone"

const props = defineProps<{ result: SUBMISSION_RESULT }>()

const tone = useTone()

/**
 * 判题结果的胶囊。颜色按「学生该怎么想」分三档，而不是照搬 JUDGE_STATUS 的 type：
 * 红 = 答案不对（答案错误、超时、超内存、系统错误），橙 = 程序本身有问题
 * （编译失败、运行时错误）或对了一半（部分正确、语法未通过），蓝 = 还在判。
 */
const TONE: Partial<Record<number, Tone>> = {
  [SubmissionStatus.accepted]: "success",
  [SubmissionStatus.wrong_answer]: "error",
  [SubmissionStatus.cpu_time_limit_exceeded]: "error",
  [SubmissionStatus.real_time_limit_exceeded]: "error",
  [SubmissionStatus.memory_limit_exceeded]: "error",
  [SubmissionStatus.system_error]: "error",
  [SubmissionStatus.compile_error]: "warning",
  [SubmissionStatus.runtime_error]: "warning",
  [SubmissionStatus.partial_accepted]: "warning",
  [SubmissionStatus.ast_check_failed]: "warning",
  [SubmissionStatus.pending]: "info",
  [SubmissionStatus.judging]: "info",
  [SubmissionStatus.submitting]: "info",
}

const judging = computed(
  () =>
    props.result === SubmissionStatus.pending ||
    props.result === SubmissionStatus.judging ||
    props.result === SubmissionStatus.submitting,
)

const icon = computed(() => {
  const r = props.result
  if (r === SubmissionStatus.accepted || r === SubmissionStatus.ast_check_failed) {
    return "ph:check-bold"
  }
  if (
    r === SubmissionStatus.compile_error ||
    r === SubmissionStatus.runtime_error ||
    r === SubmissionStatus.partial_accepted
  ) {
    return "ph:warning-bold"
  }
  if (
    r === SubmissionStatus.cpu_time_limit_exceeded ||
    r === SubmissionStatus.real_time_limit_exceeded
  ) {
    return "ph:clock-bold"
  }
  return "ph:x-bold"
})

const colors = computed(() => tone(TONE[props.result] ?? "default"))
</script>

<template>
  <span
    class="pill"
    :style="{ color: colors.color, background: colors.background }"
    :title="JUDGE_STATUS[result]?.title"
  >
    <span v-if="judging" class="spinner" :style="{ borderTopColor: colors.color }"></span>
    <Icon v-else :icon="icon" :width="12" />
    {{ JUDGE_STATUS[result]?.name ?? "未知状态" }}
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px 0 7px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  flex: none;
}

.spinner {
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2px solid rgba(128, 128, 128, 0.35);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

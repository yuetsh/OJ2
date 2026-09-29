<script setup lang="ts">
import { FlowchartSubmissionStatus } from "utils/types"
import { useTone, type Tone } from "../composables/tone"

/**
 * 流程图提交在列表里的那个胶囊：评完的直接是「A 级 86 分」，没评完的是
 * 排队中 / 评分中 / 评分失败。原来等级、分数、状态分三列，老师要横着对。
 */
const props = defineProps<{
  status: number
  grade: string | null
  score: number | null
}>()

const tone = useTone()

const GRADE_TONE: Record<string, Tone> = { S: "success", A: "info", B: "warning", C: "error" }

const view = computed(() => {
  if (props.status === FlowchartSubmissionStatus.COMPLETED && props.grade) {
    return { tone: GRADE_TONE[props.grade] ?? "default", grade: props.grade, text: "" }
  }
  if (props.status === FlowchartSubmissionStatus.FAILED) {
    return { tone: "error" as const, grade: "", text: "评分失败" }
  }
  if (props.status === FlowchartSubmissionStatus.PROCESSING) {
    return { tone: "info" as const, grade: "", text: "评分中" }
  }
  return { tone: "default" as const, grade: "", text: "排队中" }
})

const colors = computed(() => tone(view.value.tone))
</script>

<template>
  <span class="pill" :style="{ color: colors.color, background: colors.background }">
    <template v-if="view.grade">
      <b>{{ view.grade }} 级</b><span class="score">{{ score ?? 0 }} 分</span>
    </template>
    <template v-else>{{ view.text }}</template>
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  flex: none;
}

.score {
  font-weight: 400;
}
</style>

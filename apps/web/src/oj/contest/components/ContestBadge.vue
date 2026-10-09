<script setup lang="ts">
import { isExamTag } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { useTone } from "oj/submission/composables/tone"
import { CONTEST_STATUS, ContestStatus } from "utils/constants"

/**
 * 比赛的两个小标：状态（进行中 / 未开始 / 已结束）和类型（练习 / 期中 / 期末）。
 * 进行中绿、未开始琥珀、已结束灰；期中期末用浅红底 —— 学生一眼知道「这场是考试，排名考完才有」
 */
const props = defineProps<{ status?: ContestStatus; tag?: string }>()

const theme = useThemeVars()
const tone = useTone()

const style = computed(() => {
  if (props.status !== undefined) {
    const kind =
      props.status === ContestStatus.underway
        ? "success"
        : props.status === ContestStatus.not_started
          ? "warning"
          : "default"
    const t = tone(kind)
    return { color: t.color, background: t.background, border: "1px solid transparent" }
  }
  if (props.tag && isExamTag(props.tag)) {
    const t = tone("error")
    return { color: t.color, background: t.background, border: "1px solid transparent" }
  }
  return {
    color: theme.value.textColor3,
    background: "transparent",
    border: `1px solid ${theme.value.borderColor}`,
  }
})

const text = computed(() =>
  props.status !== undefined ? CONTEST_STATUS[props.status]?.name : props.tag,
)
</script>

<template>
  <span class="badge" :class="{ strong: status === ContestStatus.underway }" :style="style">{{
    text
  }}</span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  box-sizing: border-box;
  border-radius: 3px;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}

.strong {
  font-weight: 600;
}
</style>

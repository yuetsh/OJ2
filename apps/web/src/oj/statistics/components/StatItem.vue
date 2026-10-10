<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { useTone, type Tone } from "oj/submission/composables/tone"

/** 数字行的一格：小字标签 + 大号数字 + 单位 */
const props = defineProps<{
  label: string
  value: string | number
  unit?: string
  tone?: Tone
  /** 算不出来的（没选班级就没有花名册）整格不显示，免得写个 0 让人误会 */
  hidden?: boolean
}>()

const theme = useThemeVars()
const toneOf = useTone()
const color = computed(() => (props.tone ? toneOf(props.tone).color : theme.value.textColor1))
</script>

<template>
  <div v-if="!hidden" class="stat">
    <span class="label">{{ label }}</span>
    <span class="value-line">
      <b class="value" :style="{ color }">{{ value }}</b>
      <span v-if="unit" class="unit">{{ unit }}</span>
    </span>
  </div>
</template>

<style scoped>
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: none;
}

.label,
.unit {
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
}

.value-line {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.value {
  font-size: 26px;
  font-variant-numeric: tabular-nums;
}
</style>

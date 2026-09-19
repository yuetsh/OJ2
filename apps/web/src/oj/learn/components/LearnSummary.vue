<script setup lang="ts">
import { TUTORIAL_READ_SECONDS } from "@oj2/contract"
import type { TutorialProgress } from "utils/types"

const props = defineProps<{
  titles: { id: number; title: string }[]
  progress: Record<number, TutorialProgress>
  traced: boolean
}>()

const stats = computed(() => {
  const rows = props.titles.map((t) => props.progress[t.id])
  const read = rows.filter(
    (p) => p && p.totalSeconds >= TUTORIAL_READ_SECONDS,
  ).length
  const solved = rows.reduce((n, p) => n + (p?.exerciseSolved ?? 0), 0)
  const total = rows.reduce((n, p) => n + (p?.exerciseTotal ?? 0), 0)
  return { read, solved, total }
})

const percent = computed(() =>
  props.titles.length
    ? Math.round((stats.value.read / props.titles.length) * 100)
    : 0,
)
</script>

<template>
  <div v-if="traced && titles.length" class="summary">
    <n-progress
      type="line"
      :percentage="percent"
      :height="8"
      :show-indicator="false"
      status="success"
    />
    <n-text depth="3" class="numbers">
      已读 {{ stats.read }}/{{ titles.length }} 课
      <template v-if="stats.total">
        · 练一练 {{ stats.solved }}/{{ stats.total }}
      </template>
    </n-text>
  </div>
</template>

<style scoped>
.summary {
  padding: 4px 10px 12px;
}
.numbers {
  display: block;
  margin-top: 6px;
  font-size: 12px;
}
</style>

<script setup lang="ts">
import { ArcElement, Chart as ChartJS, Tooltip } from "chart.js"
import { Doughnut } from "vue-chartjs"
import { useChartTheme } from "shared/composables/chartTheme"

ChartJS.register(ArcElement, Tooltip)

/**
 * 数字行右边的小圆环（提交正确率、班级完成度）。中间写百分比，
 * 鼠标停上去看两段各是多少 —— 这是 chart.js 现成的提示。
 */
const props = defineProps<{
  value: number
  total: number
  color: string
  /** 两段的名字，提示里用：["正确", "没对"] */
  labels: [string, string]
  size?: number
}>()

const { chartKey, gridColor } = useChartTheme()

const pct = computed(() => (props.total > 0 ? Math.round((props.value / props.total) * 100) : 0))

const data = computed(() => ({
  labels: props.labels,
  datasets: [
    {
      data: [props.value, Math.max(0, props.total - props.value)],
      backgroundColor: [props.color, gridColor.value],
      borderWidth: 0,
    },
  ],
}))

const options = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: "72%",
  animation: false as const,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (context: { label: string; parsed: number }) =>
          `${context.label}：${context.parsed}`,
      },
    },
  },
}
</script>

<template>
  <span class="ring" :style="{ width: `${size ?? 48}px`, height: `${size ?? 48}px` }">
    <Doughnut :key="chartKey" :data="data" :options="options" />
    <span class="center">{{ total > 0 ? `${pct}%` : "—" }}</span>
  </span>
</template>

<style scoped>
.ring {
  position: relative;
  display: inline-block;
  flex: none;
}

.center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  pointer-events: none;
}
</style>

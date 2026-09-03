<template>
  <n-card title="几次做对" size="small" v-if="show">
    <template #header-extra>
      <n-text depth="3" style="font-size: 12px">
        通过前提交了几次，看有没有在死磕
      </n-text>
    </template>
    <div class="chart">
      <Bar :key="chartKey" :data="data" :options="options" />
    </div>
  </n-card>
</template>
<script setup lang="ts">
import type { ChartOptions } from "chart.js"
import { Bar } from "vue-chartjs"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js"
import { useAIStore } from "oj/store/ai"
import { useChartTheme } from "shared/composables/chartTheme"

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const aiStore = useAIStore()
const { chartKey } = useChartTheme()

// solved[].attempts 是后端算的「到首次通过为止的提交次数」，分档放在前端，
// 想调档位不用改契约
const BUCKETS = [
  { label: "一次过", color: "#18A058", min: 1, max: 1 },
  { label: "2-3 次", color: "#2080F0", min: 2, max: 3 },
  { label: "4-6 次", color: "#F0A020", min: 4, max: 6 },
  { label: "7 次以上", color: "#D03050", min: 7, max: Infinity },
]

const buckets = computed(() =>
  BUCKETS.map((bucket) => ({
    ...bucket,
    problems: aiStore.detailsData.solved.filter(
      (item) => item.attempts >= bucket.min && item.attempts <= bucket.max,
    ),
  })),
)

const show = computed(() => aiStore.detailsData.solved.length > 0)

const data = computed(() => ({
  labels: buckets.value.map((bucket) => bucket.label),
  datasets: [
    {
      label: "题目数量",
      data: buckets.value.map((bucket) => bucket.problems.length),
      backgroundColor: buckets.value.map((bucket) => bucket.color),
      borderColor: buckets.value.map((bucket) => bucket.color),
      borderWidth: 1,
      borderRadius: 4,
      maxBarThickness: 64,
    },
  ],
}))

const options = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { grid: { display: false } },
    y: {
      beginAtZero: true,
      ticks: { stepSize: 1, precision: 0 },
      title: { display: true, text: "题目数量" },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.parsed.y} 道题`,
        afterLabel: (ctx) => {
          const titles = buckets.value[ctx.dataIndex]!.problems.map(
            (item) => `${item.problem.displayId} ${item.problem.title}`,
          )
          if (!titles.length) return ""
          if (titles.length <= 5) return titles
          return [...titles.slice(0, 4), `… 还有 ${titles.length - 4} 道`]
        },
      },
    },
  },
}))
</script>
<style scoped>
.chart {
  height: 300px;
  width: 100%;
}
</style>

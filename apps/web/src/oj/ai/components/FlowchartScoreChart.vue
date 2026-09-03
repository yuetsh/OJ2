<template>
  <n-card title="流程图得分" size="small" v-if="show">
    <template #header-extra>
      <n-text depth="3" style="font-size: 12px">每题的最高分和平均分</n-text>
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
  Legend,
} from "chart.js"
import { useAIStore } from "oj/store/ai"
import { useChartTheme } from "shared/composables/chartTheme"

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const aiStore = useAIStore()
const { chartKey } = useChartTheme()

// detailsData.flowcharts 早就在下发了，但全页一张图都没有，只在解题表格的
// 第二个 tab 里列成表格。这里直接画出来，不用改后端和契约
const items = computed(() =>
  [...aiStore.detailsData.flowcharts].sort(
    (a, b) => b.bestScore - a.bestScore || a.problemId.localeCompare(b.problemId),
  ),
)

const show = computed(() => items.value.length > 0)

const data = computed(() => ({
  labels: items.value.map((item) => `${item.problemId} ${item.problemTitle}`),
  datasets: [
    {
      label: "最高分",
      data: items.value.map((item) => item.bestScore),
      backgroundColor: "#18A058",
      borderColor: "#18A058",
      borderWidth: 1,
      borderRadius: 4,
      maxBarThickness: 22,
    },
    {
      label: "平均分",
      data: items.value.map((item) => item.avgScore),
      backgroundColor: "rgba(99, 102, 241, 0.75)",
      borderColor: "rgb(99, 102, 241)",
      borderWidth: 1,
      borderRadius: 4,
      maxBarThickness: 22,
    },
  ],
}))

const options = computed<ChartOptions<"bar">>(() => ({
  indexAxis: "y",
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      beginAtZero: true,
      max: 100,
      title: { display: true, text: "得分" },
    },
    y: { grid: { display: false } },
  },
  plugins: {
    legend: {
      display: true,
      position: "bottom",
      labels: { boxWidth: 12, padding: 8, font: { size: 11 } },
    },
    tooltip: {
      callbacks: {
        afterBody: (ctx) => {
          const item = items.value[ctx[0]!.dataIndex]
          if (!item) return ""
          return `提交 ${item.submissionCount} 次${item.bestGrade ? `，最好等级 ${item.bestGrade}` : ""}`
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

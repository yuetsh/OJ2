<template>
  <n-card title="知识点分布" size="small" v-if="show">
    <template #header-extra>
      <n-text depth="3" style="font-size: 12px">看看做过哪几类题</n-text>
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

// 横向条形而不是雷达图：只有 3~5 个类目，雷达对「比较大小」是最差的形式之一，
// 而且原来还把值归一化成「占最多标签的百分比」，第一名恒为 100%，等于只画了个排序。
// 这里直接画真实题数。后端 topTags 已经截到前 5，不需要再截
const entries = computed(() =>
  Object.entries(aiStore.detailsData.tags).sort(([, a], [, b]) => b - a),
)

const show = computed(() => entries.value.length > 0)

const data = computed(() => ({
  labels: entries.value.map(([label]) => label),
  datasets: [
    {
      label: "完成题目数",
      data: entries.value.map(([, value]) => value),
      backgroundColor: "rgba(99, 102, 241, 0.75)",
      borderColor: "rgb(99, 102, 241)",
      borderWidth: 1,
      borderRadius: 4,
      maxBarThickness: 28,
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
      ticks: { stepSize: 1, precision: 0 },
      title: { display: true, text: "题目数量" },
    },
    y: {
      grid: { display: false },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => `完成 ${ctx.parsed.x} 道题`,
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

<template>
  <n-card title="错在哪里" size="small" v-if="show">
    <template #header-extra>
      <n-text depth="3" style="font-size: 12px">没通过的提交都是什么错</n-text>
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
import { JUDGE_STATUS } from "utils/constants"
import type { SUBMISSION_RESULT } from "utils/types"

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const aiStore = useAIStore()
const { chartKey } = useChartTheme()

// 判题状态码是落库的值，名字统一从 JUDGE_STATUS 取，不在这里另抄一份中文
const COLORS: Record<string, string> = {
  "-2": "#F0A020", // 编译失败
  "-1": "#D03050", // 答案错误
  "1": "#7C4DFF", // 运行超时
  "2": "#7C4DFF",
  "3": "#2080F0", // 内存超限
  "4": "#E88080", // 运行错误
  "5": "#909399", // 系统错误
  "8": "#18A058", // 部分正确
}

// 同一个中文名可能对应多个状态码（1 和 2 都叫「运行超时」），按名字合并
const grouped = computed(() => {
  const byName = new Map<string, { count: number; color: string }>()
  for (const item of aiStore.detailsData.errors) {
    const name =
      JUDGE_STATUS[String(item.result) as unknown as SUBMISSION_RESULT]?.name ??
      `状态 ${item.result}`
    const seen = byName.get(name)
    if (seen) seen.count += item.count
    else
      byName.set(name, {
        count: item.count,
        color: COLORS[String(item.result)] ?? "#909399",
      })
  }
  return [...byName].sort((a, b) => b[1].count - a[1].count)
})

const show = computed(() => grouped.value.length > 0)

const data = computed(() => ({
  labels: grouped.value.map(([name]) => name),
  datasets: [
    {
      label: "提交次数",
      data: grouped.value.map(([, item]) => item.count),
      backgroundColor: grouped.value.map(([, item]) => item.color),
      borderColor: grouped.value.map(([, item]) => item.color),
      borderWidth: 1,
      borderRadius: 4,
      maxBarThickness: 28,
    },
  ],
}))

const total = computed(() =>
  grouped.value.reduce((sum, [, item]) => sum + item.count, 0),
)

const options = computed<ChartOptions<"bar">>(() => ({
  indexAxis: "y",
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      beginAtZero: true,
      ticks: { stepSize: 1, precision: 0 },
      title: { display: true, text: "提交次数" },
    },
    y: { grid: { display: false } },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const value = Number(ctx.parsed.x)
          const percent = total.value ? (value / total.value) * 100 : 0
          return `${value} 次（占没通过的 ${percent.toFixed(0)}%）`
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

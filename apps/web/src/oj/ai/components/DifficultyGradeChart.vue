<template>
  <n-card title="难度分布" size="small" v-if="show">
    <template #header-extra>
      <n-text depth="3" style="font-size: 12px">
        看看简单题和难题各做了多少
      </n-text>
    </template>
    <div style="height: 300px">
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

// 难度和等级的顺序（后端返回的是中文）
const difficultyOrder = ["简单", "中等", "困难"]
const difficultyColors = ["#18A058", "#F0A020", "#D03050"]

// 只按难度分。原来还往里叠了一层 S/A/B/C 等级，3×4 十二个格子，
// 学生两个月做十来道题的话大部分格子恒为 0；等级信息在下面的解题表格里逐题都有。
// 直接读后端的 difficulty 聚合 —— 逐题列表现在是分页拿的，前端手上没有全量
const counts = computed(() =>
  difficultyOrder.map((name) => aiStore.detailsData.difficulty[name] ?? 0),
)

const show = computed(() => aiStore.detailsData.solvedCount > 0)

const data = computed(() => ({
  labels: difficultyOrder,
  datasets: [
    {
      label: "完成题目数",
      data: counts.value,
      backgroundColor: difficultyColors,
      borderColor: difficultyColors,
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
        label: (ctx) => `完成 ${ctx.parsed.y} 道题`,
      },
    },
  },
}))
</script>

<template>
  <n-card :title="title" size="small" v-if="show">
    <template #header-extra>
      <n-text depth="3" style="font-size: 12px">
        做题量和提交质量的变化
      </n-text>
    </template>
    <div class="chart">
      <Chart type="bar" :key="chartKey" :data="data" :options="options" />
    </div>
  </n-card>
</template>
<script setup lang="ts">
import type { ChartData, ChartOptions, TooltipItem } from "chart.js"
import { Chart } from "vue-chartjs"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Colors,
  LineController,
  BarController,
} from "chart.js"
import { useAIStore } from "oj/store/ai"
import { useChartTheme } from "shared/composables/chartTheme"
import { parseTime } from "utils/functions"

// 注册混合图表（Bar + Line）所需的 Chart.js 组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Colors,
  LineController,
  BarController,
)

const aiStore = useAIStore()
const { chartKey } = useChartTheme()

const title = computed(() => {
  if (aiStore.duration === "months:2") {
    return "过去两个月的每周情况"
  } else if (aiStore.duration === "months:6") {
    return "过去半年的每月情况"
  } else if (aiStore.duration === "years:1") {
    return "过去一年的每月情况"
  } else {
    return "过去四周的情况"
  }
})

const show = computed(() => aiStore.durationData.length > 0)

// 这一张顶掉了原来的三张（进步曲线 / 提交效率 / 周期综合）—— 它们读的是同一个
// durationData，半年视图统共就 6 个桶、四个字段，没有必要摊成三张卡六条曲线。
// 等级放进 tooltip 不再单独占一条轴：S/A/B/C 是四档离散值，连成折线读不出东西，
// 而且逐题的等级在下面的解题表格里本来就有
const data = computed<ChartData<"bar" | "line">>(() => ({
  labels: aiStore.durationData.map((duration) =>
    [
      parseTime(duration.start, "M月D日"),
      parseTime(duration.end, "M月D日"),
    ].join("～"),
  ),
  datasets: [
    {
      type: "bar",
      label: "完成题目数",
      data: aiStore.durationData.map((duration) => duration.problemCount),
      yAxisID: "y",
      order: 2,
    },
    {
      type: "bar",
      label: "总提交次数",
      data: aiStore.durationData.map((duration) => duration.submissionCount),
      yAxisID: "y",
      order: 2,
    },
    {
      type: "line",
      label: "AC率",
      // 没有提交的周期给 null 而不是 0，配合 spanGaps: false 断开，
      // 否则空档会被画成「AC率 0%」，看着像交了一堆全错
      data: aiStore.durationData.map((duration) =>
        duration.submissionCount > 0
          ? (duration.acceptedCount / duration.submissionCount) * 100
          : null,
      ),
      spanGaps: false,
      tension: 0.4,
      yAxisID: "y1",
      order: 1,
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
    },
  ],
}))

const options = computed<ChartOptions<"bar" | "line">>(() => ({
  interaction: {
    intersect: false,
    mode: "index",
  },
  maintainAspectRatio: false,
  scales: {
    x: {
      grid: { display: false },
    },
    y: {
      ticks: { stepSize: 1, precision: 0 },
      title: { display: true, text: "数量" },
      beginAtZero: true,
    },
    y1: {
      type: "linear",
      position: "right",
      min: 0,
      max: 100,
      ticks: { callback: (v) => `${Number(v).toFixed(0)}%` },
      title: { display: true, text: "AC率" },
      grid: { display: false },
    },
  },
  plugins: {
    legend: {
      display: true,
      position: "bottom",
      labels: {
        boxWidth: 12,
        padding: 8,
        font: { size: 11 },
      },
    },
    title: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: TooltipItem<"bar" | "line">) => {
          const dsLabel = ctx.dataset.label || ""
          if (ctx.dataset.label === "AC率") {
            return `${dsLabel}: ${Number(ctx.parsed.y).toFixed(1)}%`
          }
          return `${dsLabel}: ${ctx.formattedValue}`
        },
        footer: (items: TooltipItem<"bar" | "line">[]) => {
          const index = items[0]?.dataIndex
          const bucket =
            index === undefined ? undefined : aiStore.durationData[index]
          if (!bucket) return ""
          const lines = [`本期等级: ${bucket.grade || "无"}`]
          if (bucket.submissionCount > 0) {
            lines.push(
              `通过 ${bucket.acceptedCount} 次 / 共提交 ${bucket.submissionCount} 次`,
            )
          }
          return lines
        },
      },
    },
  },
}))
</script>
<style scoped>
.chart {
  height: 320px;
  width: 100%;
}
</style>

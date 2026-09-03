<template>
  <n-card :title="title" size="small">
    <template #header-extra>
      <n-text depth="3" style="font-size: 12px"> 全面评估学习情况 </n-text>
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
  Title,
  Tooltip,
  Legend,
  Colors,
  LineController,
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
  Title,
  Tooltip,
  Legend,
  Colors,
  LineController,
)

const aiStore = useAIStore()
const { chartKey } = useChartTheme()

const gradeOrder = ["C", "B", "A", "S"] as const

const title = computed(() => {
  if (aiStore.duration === "months:2") {
    return "过去两个月的每周综合情况"
  } else if (aiStore.duration === "months:6") {
    return "过去半年的每月综合情况"
  } else if (aiStore.duration === "years:1") {
    return "过去一年的每月综合情况"
  } else {
    return "过去四周的综合情况"
  }
})

const data = computed<ChartData<"bar" | "line">>(() => {
  return {
    labels: aiStore.durationData.map((duration) => {
      return [
        parseTime(duration.start, "M月D日"),
        parseTime(duration.end, "M月D日"),
      ].join("～")
    }),
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
        label: "等级",
        data: aiStore.durationData.map((duration) =>
          duration.grade ? gradeOrder.indexOf(duration.grade) : null,
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
  }
})

const options = computed<ChartOptions<"bar" | "line">>(() => {
  return {
    interaction: {
      intersect: false,
    },
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: {
          display: false,
        },
      },
      y: {
        ticks: {
          stepSize: 1,
        },
        title: {
          display: true,
          text: "数量",
        },
        beginAtZero: true,
      },
      y1: {
        type: "linear",
        position: "right",
        min: -0.5,
        max: gradeOrder.length - 0.5,
        ticks: {
          stepSize: 1,
          // 轴是 -0.5 ~ 3.5，chart.js 生成的刻度值就是 -0.5/0.5/1.5/2.5/3.5，
          // 直接拿去索引 gradeOrder 全是 undefined —— 右轴的 S/A/B/C 一个都不会显示。
          // 四舍五入到整数档再取，和 ProgressChart 的写法一致
          callback: (v) => {
            const idx = Math.round(Number(v))
            return gradeOrder[idx] || ""
          },
        },
        title: {
          display: true,
          text: "等级",
        },
        grid: {
          display: false,
        },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: "bottom" as const,
        labels: {
          boxWidth: 12,
          padding: 8,
          font: {
            size: 11,
          },
        },
      },
      title: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"bar" | "line">) => {
            const dsLabel = ctx.dataset.label || ""
            if ((ctx.dataset as any).yAxisID === "y1") {
              const idx = Number(ctx.parsed.y)
              return `${dsLabel}: ${gradeOrder[idx] || ""}`
            }
            return `${dsLabel}: ${ctx.formattedValue}`
          },
          // AC 率直接读该周期的 acceptedCount / submissionCount。原来拿柱子上的
          // 「完成题目数 / 总提交次数」当 AC 率，分子是去重后的题数，不是一回事
          footer: (items: TooltipItem<"bar" | "line">[]) => {
            const index = items[0]?.dataIndex
            const bucket =
              index === undefined ? undefined : aiStore.durationData[index]
            if (!bucket || bucket.submissionCount === 0) return ""
            const rate = (bucket.acceptedCount / bucket.submissionCount) * 100
            return `AC率: ${rate.toFixed(1)}%（通过 ${bucket.acceptedCount} / 共 ${bucket.submissionCount} 次）`
          },
        },
      },
    },
  }
})
</script>
<style scoped>
.chart {
  height: 300px;
  width: 100%;
}
</style>

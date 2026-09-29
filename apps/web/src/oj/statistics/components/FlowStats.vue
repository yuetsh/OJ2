<script setup lang="ts">
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip,
} from "chart.js"
import { WordCloudController, WordElement } from "chartjs-chart-wordcloud"
import { useThemeVars } from "naive-ui"
import { Bar, Doughnut, Radar } from "vue-chartjs"
import type { FlowchartStatistics } from "@oj2/contract"
import { useChartTheme } from "shared/composables/chartTheme"
import { FLOWCHART_CRITERIA_ORDER } from "utils/constants"
import { useTone } from "oj/submission/composables/tone"
import RingChart from "./RingChart.vue"
import StatItem from "./StatItem.vue"

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip,
  WordCloudController,
  WordElement,
)

/**
 * 流程图统计（设计稿「统计重设计 · 流程图」）：等级分布、四项评分、各项平均分、
 * 高频问题词云、每人最好的一次。图表都是 chart.js，和站里别的图一套主题。
 */
const props = defineProps<{ data: FlowchartStatistics }>()

const theme = useThemeVars()
const tone = useTone()
const { chartKey } = useChartTheme()

const GRADES = ["S", "A", "B", "C"] as const
const gradeColor = computed(() => ({
  S: tone("success").solid,
  A: tone("info").solid,
  B: tone("warning").solid,
  C: tone("error").solid,
}))

/** 拿到 A / S 算完成（和题单、课堂条的口径一致） */
const goodCount = computed(
  () => props.data.people.filter((row) => row.bestGrade === "S" || row.bestGrade === "A").length,
)
const personCount = computed(() => props.data.personCount || props.data.people.length)

const gradeData = computed(() => ({
  labels: GRADES.map((grade) => `${grade} 级`),
  datasets: [
    {
      data: GRADES.map((grade) => props.data.gradeDistribution[grade] ?? 0),
      backgroundColor: GRADES.map((grade) => gradeColor.value[grade]),
      borderWidth: 0,
    },
  ],
}))

const gradeOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: "60%",
  plugins: { legend: { position: "right" as const } },
}

/** 四项按固定顺序（jsonb 不保留键序，逻辑正确性要在最前） */
const criteria = computed(() =>
  FLOWCHART_CRITERIA_ORDER.filter((key) => props.data.criteriaAverages[key]).map((key) => ({
    key,
    ...props.data.criteriaAverages[key]!,
  })),
)

const radarData = computed(() => ({
  labels: criteria.value.map((item) => item.key),
  datasets: [
    {
      label: "平均得分率",
      data: criteria.value.map((item) => Math.round((item.avg / (item.max || 1)) * 100)),
      backgroundColor: "rgba(32, 128, 240, 0.18)",
      borderColor: tone("info").solid,
      pointBackgroundColor: tone("info").solid,
      fill: true,
    },
  ],
}))

const radarOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: { label: (context: { parsed: { r: number } }) => `${context.parsed.r}%` },
    },
  },
  scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, display: false } } },
}

const barData = computed(() => ({
  labels: criteria.value.map((item) => item.key),
  datasets: [
    {
      label: "平均分",
      data: criteria.value.map((item) => item.avg),
      backgroundColor: tone("info").solid,
      borderRadius: 4,
    },
  ],
}))

const barOptions = computed(() => ({
  indexAxis: "y" as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (context: { dataIndex: number; parsed: { x: number | null } }) =>
          `${context.parsed.x ?? 0} / ${criteria.value[context.dataIndex]?.max ?? 100}`,
      },
    },
  },
  scales: { x: { min: 0, max: Math.max(...criteria.value.map((item) => item.max), 10) } },
}))

// ---------- 词云（chart.js 的 wordCloud 插件，canvas 上画，要自己管实例） ----------

const WORD_COLORS = ["#2080f0", "#18a058", "#d03050", "#f0a020", "#7a3e9d", "#13c2c2"]
const cloudCanvas = useTemplateRef<HTMLCanvasElement>("cloudCanvas")
let cloud: ChartJS | null = null

function drawCloud() {
  cloud?.destroy()
  cloud = null
  const words = props.data.wordFrequencies
  if (!cloudCanvas.value || !words.length) return
  const max = Math.max(...words.map((word) => word.count))
  cloud = new ChartJS(cloudCanvas.value, {
    type: "wordCloud" as never,
    data: {
      labels: words.map((word) => word.word),
      datasets: [
        {
          label: "",
          data: words.map((word) => 12 + (word.count / max) * 42),
          color: words.map((_, i) => WORD_COLORS[i % WORD_COLORS.length]),
          rotate: 0,
        } as never,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context: { dataIndex: number }) => {
              const word = words[context.dataIndex]
              return word ? `${word.word}：${word.count} 次` : ""
            },
          },
        },
      },
    } as never,
  })
}

watch(
  () => [props.data.wordFrequencies, chartKey.value],
  () => nextTick(drawCloud),
  { immediate: true },
)
onUnmounted(() => cloud?.destroy())

// ---------- 每人最好的一次：没交的在前，其次按分数从低到高 ----------

const people = computed(() => [
  ...props.data.dataUnaccepted.map((row) => ({
    username: row.username,
    name: row.realName,
    grade: null as string | null,
    score: null as number | null,
    count: 0,
  })),
  ...props.data.people.map((row) => ({
    username: row.username,
    name: row.realName,
    grade: row.bestGrade,
    score: row.bestScore,
    count: row.count,
  })),
])

function gradeStyle(grade: string | null) {
  const map: Record<string, ReturnType<typeof tone>> = {
    S: tone("success"),
    A: tone("info"),
    B: tone("warning"),
    C: tone("error"),
  }
  const t = grade ? map[grade] : null
  return t
    ? { color: t.color, background: t.background }
    : { color: theme.value.textColor3, background: theme.value.actionColor }
}
</script>

<template>
  <div class="flow-stats">
    <div class="summary">
      <StatItem label="提交" :value="data.totalCount" unit="张" />
      <StatItem label="平均分" :value="data.avgScore" />
      <StatItem
        label="拿到 A / S"
        :value="`${goodCount} / ${personCount}`"
        unit="人"
        tone="success"
      />
      <StatItem
        label="一张没交"
        :value="data.dataUnaccepted.length"
        unit="人"
        tone="error"
        :hidden="!data.personCount"
      />
      <span class="spacer"></span>
      <!-- 没选班级就没有花名册，「班级完成度」无从谈起 -->
      <span v-if="data.personCount" class="ring-wrap">
        <RingChart
          :value="goodCount"
          :total="personCount"
          :color="tone('info').solid"
          :labels="['拿到 A / S', '还没有']"
        />
        <span class="ring-label">班级<br />完成度</span>
      </span>
    </div>

    <div v-if="!data.totalCount && !data.dataUnaccepted.length" class="empty">
      这段时间没有人交流程图
    </div>
    <div v-else class="body">
      <div class="row-cards">
        <div class="card grade">
          <div class="card-title">等级分布</div>
          <div class="chart">
            <Doughnut :key="chartKey" :data="gradeData" :options="gradeOptions" />
          </div>
        </div>
        <div v-if="criteria.length" class="card radar">
          <div class="card-title">四项评分（平均得分率）</div>
          <div class="chart">
            <Radar :key="chartKey" :data="radarData" :options="radarOptions" />
          </div>
        </div>
        <div v-if="criteria.length" class="card grow">
          <div class="card-title">各项平均分</div>
          <div class="chart"><Bar :key="chartKey" :data="barData" :options="barOptions" /></div>
        </div>
      </div>
      <div class="row-cards bottom">
        <div class="card grow">
          <div class="card-title">常见问题高频词（最近的评语里）</div>
          <div class="cloud"><canvas ref="cloudCanvas"></canvas></div>
          <div v-if="!data.wordFrequencies.length" class="muted">评语太少，还拼不出词云</div>
        </div>
        <div class="card people">
          <div class="card-title">每人最好的一次（没交的在前）</div>
          <div class="people-list">
            <div v-for="row in people" :key="row.username" class="person">
              <b class="p-name" :title="row.username">{{ row.name }}</b>
              <span class="grade-pill" :style="gradeStyle(row.grade)">
                {{ row.grade ? `${row.grade} 级 ${row.score ?? 0} 分` : "没交" }}
              </span>
              <span class="muted">{{ row.count }} 次</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flow-stats {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.summary {
  height: 72px;
  flex: none;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 36px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  background: v-bind("theme.actionColor");
}

.spacer {
  flex: 1 1 0;
}

.ring-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ring-label {
  font-size: 12px;
  line-height: 1.5;
  color: v-bind("theme.textColor3");
}

.body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.row-cards {
  display: flex;
  gap: 14px;
  height: 220px;
  flex: none;
}

.row-cards.bottom {
  height: 300px;
}

.card {
  box-sizing: border-box;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 8px;
  background: v-bind("theme.cardColor");
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.card.grade {
  width: 340px;
  flex: none;
}

.card.radar {
  width: 300px;
  flex: none;
}

.card.grow {
  flex: 1 1 0;
}

.card.people {
  width: 420px;
  flex: none;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: v-bind("theme.textColor2");
}

.chart,
.cloud {
  flex: 1 1 0;
  min-height: 0;
  position: relative;
}

.people-list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

.person {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  font-size: 13px;
}

.p-name {
  width: 80px;
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grade-pill {
  width: 100px;
  flex: none;
  height: 22px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.muted {
  color: v-bind("theme.textColor3");
  font-size: 12px;
}

.empty {
  padding: 60px 16px;
  text-align: center;
  color: v-bind("theme.textColor3");
}
</style>

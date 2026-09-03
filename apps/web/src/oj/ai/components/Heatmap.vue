<template>
  <n-card title="过去一年的提交热力图" size="small">
    <template #header-extra>
      <n-text depth="3" style="font-size: 12px">激励持续学习</n-text>
    </template>
    <n-spin :show="aiStore.loading.heatmap" :delay="50">
      <div
        class="heatmap-container"
        ref="containerRef"
        :style="{ '--cell-stroke': cellStroke, '--cell-stroke-hover': cellStrokeHover }"
      >
        <svg
          :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
          preserveAspectRatio="xMinYMin meet"
          class="heatmap-svg"
        >
          <g v-for="label in monthLabels" :key="`${label.text}-${label.x}`">
            <text :x="label.x" :y="10" class="label" font-size="10">
              {{ label.text }}
            </text>
          </g>

          <g v-for="(day, i) in WEEK_DAYS" :key="i">
            <text
              :x="0"
              :y="MONTH_HEIGHT + i * CELL_TOTAL + 8"
              class="label"
              font-size="9"
            >
              {{ day }}
            </text>
          </g>

          <g :transform="`translate(${DAY_WIDTH}, ${MONTH_HEIGHT})`">
            <rect
              v-for="(cell, i) in cells"
              :key="i"
              :x="cell.x"
              :y="cell.y"
              :width="CELL_SIZE"
              :height="CELL_SIZE"
              :fill="cell.color"
              class="cell"
              rx="2"
              @mouseenter="(e) => showTooltip(e, cell)"
              @mouseleave="hideTooltip"
            />
          </g>
        </svg>

        <div v-if="tooltip" class="tooltip" :style="tooltipStyle">
          <div class="tooltip-date">{{ tooltip.date }}</div>
          <div class="tooltip-count" :class="{ active: tooltip.count > 0 }">
            {{ tooltip.text }}
          </div>
        </div>
      </div>
    </n-spin>
  </n-card>
</template>

<script setup lang="ts">
import { useAIStore } from "oj/store/ai"
import { parseTime } from "utils/functions"
import { useChartTheme } from "shared/composables/chartTheme"

const aiStore = useAIStore()
const { isDark } = useChartTheme()
const containerRef = useTemplateRef<HTMLElement>("containerRef")

const CELL_SIZE = 12
const CELL_GAP = 3
const CELL_TOTAL = CELL_SIZE + CELL_GAP
const DAY_WIDTH = 20
const MONTH_HEIGHT = 20
const RIGHT_PADDING = 5
// 深色下空格子不能再用接近白的 #ebedf0，整张图会变成一片发亮的方块
const LIGHT_COLORS = ["#ebedf0", "#c6e48b", "#7bc96f", "#239a3b", "#196127"]
const DARK_COLORS = ["#22272e", "#0e4429", "#006d32", "#26a641", "#39d353"]
const WEEK_DAYS = ["", "一", "", "三", "", "五", ""]

const COLORS = computed(() => (isDark.value ? DARK_COLORS : LIGHT_COLORS))
const cellStroke = computed(() =>
  isDark.value ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)",
)
const cellStrokeHover = computed(() =>
  isDark.value ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.3)",
)

const getColor = (count: number) => {
  const palette = COLORS.value
  if (count === 0) return palette[0]
  if (count <= 2) return palette[1]
  if (count <= 4) return palette[2]
  if (count <= 7) return palette[3]
  return palette[4]
}

// 第一格未必是周日 —— 后端给的是「今天往前推 364 天」那天开始的 365 天。
// 原来直接拿 i % 7 当行号，等于假设首日是周日，左边 一/三/五 的标签和月份标签
// 会整体错位（今天是周四就错四行）。这里按首日真实的星期做偏移。
const weekdayOffset = computed(() => {
  const first = aiStore.heatmapData[0]
  return first ? new Date(first.timestamp).getDay() : 0
})

const cells = computed(() =>
  aiStore.heatmapData.map((item, i) => {
    const slot = weekdayOffset.value + i
    return {
      date: new Date(item.timestamp),
      count: item.value,
      color: getColor(item.value),
      week: Math.floor(slot / 7),
      day: slot % 7,
      x: Math.floor(slot / 7) * CELL_TOTAL,
      y: (slot % 7) * CELL_TOTAL,
    }
  }),
)

const monthLabels = computed(() => {
  const labels: { text: string; x: number }[] = []
  let lastMonth = -1

  cells.value.forEach((cell, i) => {
    const month = cell.date.getMonth()
    const isWeekStart = cell.day === 0 || i === 0

    if (month !== lastMonth && (isWeekStart || cell.day <= 3)) {
      labels.push({
        text: `${month + 1}月`,
        x: DAY_WIDTH + cell.week * CELL_TOTAL,
      })
      lastMonth = month
    }
  })

  return labels
})

const svgWidth = computed(() => {
  const last = cells.value[cells.value.length - 1]
  const weeks = last ? last.week + 1 : 0
  return DAY_WIDTH + weeks * CELL_TOTAL + RIGHT_PADDING
})

const svgHeight = computed(() => MONTH_HEIGHT + 7 * CELL_TOTAL)

interface Cell {
  date: Date
  count: number
  color: string
  week: number
  day: number
  x: number
  y: number
}

const tooltip = ref<{
  x: number
  y: number
  date: string
  text: string
  count: number
} | null>(null)

const tooltipStyle = computed(() => ({
  left: `${tooltip.value?.x}px`,
  top: `${tooltip.value?.y}px`,
}))

const getTooltipText = (count: number) =>
  count === 0 ? "没有提交记录" : `提交了 ${count} 次`

const showTooltip = (e: MouseEvent, cell: Cell) => {
  const rect = (e.target as HTMLElement).getBoundingClientRect()
  const containerRect = containerRef.value?.getBoundingClientRect()

  if (containerRect) {
    tooltip.value = {
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 10,
      date: parseTime(cell.date, "YYYY年M月D日"),
      text: getTooltipText(cell.count),
      count: cell.count,
    }
  }
}

const hideTooltip = () => {
  tooltip.value = null
}
</script>

<style scoped>
.heatmap-container {
  width: 100%;
  padding: 10px 0;
  position: relative;
}

.heatmap-svg {
  width: 100%;
  height: auto;
  display: block;
}

.label {
  fill: currentColor;
  opacity: 0.7;
}

.cell {
  cursor: pointer;
  transition: all 0.2s ease;
  stroke: var(--cell-stroke);
  stroke-width: 0.5;
}

.cell:hover {
  stroke: var(--cell-stroke-hover);
  stroke-width: 1.5;
  filter: brightness(0.9);
}

.tooltip {
  position: absolute;
  transform: translate(-50%, -100%);
  background: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
  z-index: 1000;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  animation: fade-in 0.2s ease;
}

.tooltip::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: rgba(0, 0, 0, 0.9);
}

.tooltip-date {
  font-weight: 500;
  margin-bottom: 2px;
}

.tooltip-count {
  opacity: 0.6;
}

.tooltip-count.active {
  color: #7bc96f;
  opacity: 0.9;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-100% - 5px));
  }
  to {
    opacity: 1;
    transform: translate(-50%, -100%);
  }
}
</style>

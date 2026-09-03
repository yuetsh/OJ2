<template>
  <n-card title="过去一年的提交热力图" size="small">
    <template #header-extra>
      <n-text depth="3" style="font-size: 12px">
        每格一周，激励持续学习
      </n-text>
    </template>
    <n-spin :show="aiStore.loading.heatmap" :delay="50">
      <div
        class="heatmap-container"
        ref="containerRef"
        :style="{
          '--cell-stroke': cellStroke,
          '--cell-stroke-hover': cellStrokeHover,
        }"
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

          <g :transform="`translate(0, ${MONTH_HEIGHT})`">
            <rect
              v-for="(cell, i) in cells"
              :key="i"
              :x="cell.x"
              :y="0"
              :width="CELL_SIZE"
              :height="CELL_HEIGHT"
              :fill="cell.color"
              class="cell"
              rx="3"
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

const CELL_SIZE = 22
// 一格一周之后只剩一行，格子做成竖长条，卡片不至于扁成一条缝
const CELL_HEIGHT = 34
const CELL_GAP = 4
const CELL_TOTAL = CELL_SIZE + CELL_GAP
const MONTH_HEIGHT = 18
const RIGHT_PADDING = 5

// 深色下空格子不能再用接近白的 #ebedf0，整张图会变成一片发亮的方块
const LIGHT_COLORS = ["#ebedf0", "#c6e48b", "#7bc96f", "#239a3b", "#196127"]
const DARK_COLORS = ["#22272e", "#0e4429", "#006d32", "#26a641", "#39d353"]

const COLORS = computed(() => (isDark.value ? DARK_COLORS : LIGHT_COLORS))
const cellStroke = computed(() =>
  isDark.value ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)",
)
const cellStrokeHover = computed(() =>
  isDark.value ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.3)",
)

// 阈值按「一周」定，不是按一天。按天的老阈值（>7 就到顶）放到周上，
// 稍微认真做几天题就全是最深的一档，看不出差别
const getColor = (count: number) => {
  const palette = COLORS.value
  if (count === 0) return palette[0]
  if (count <= 3) return palette[1]
  if (count <= 8) return palette[2]
  if (count <= 15) return palette[3]
  return palette[4]
}

// 一格一周，横向铺开。原来是一格一天、7 行 53 列，中职学生一年也就二三十天有提交，
// 365 格里三百多格空着，整张图看着像没用过
const cells = computed(() =>
  aiStore.heatmapData.map((item, i) => {
    const start = new Date(item.timestamp)
    const endOfWeek = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 6,
    )
    return {
      start,
      end: endOfWeek,
      count: item.value,
      color: getColor(item.value),
      x: i * CELL_TOTAL,
    }
  }),
)

const monthLabels = computed(() => {
  const labels: { text: string; x: number }[] = []
  let lastMonth = -1
  cells.value.forEach((cell, i) => {
    const month = cell.start.getMonth()
    if (month !== lastMonth) {
      // 第一格所在的月往往只露出小半个月，标签会和下一个月挤在一起，跳过
      if (i > 0 || cell.start.getDate() <= 7) {
        labels.push({ text: `${month + 1}月`, x: cell.x })
      }
      lastMonth = month
    }
  })
  return labels
})

const svgWidth = computed(
  () => cells.value.length * CELL_TOTAL + RIGHT_PADDING,
)
const svgHeight = computed(() => MONTH_HEIGHT + CELL_HEIGHT)

interface Cell {
  start: Date
  end: Date
  count: number
  color: string
  x: number
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
  count === 0 ? "这周没有提交" : `这周提交了 ${count} 次`

const showTooltip = (e: MouseEvent, cell: Cell) => {
  const rect = (e.target as HTMLElement).getBoundingClientRect()
  const containerRect = containerRef.value?.getBoundingClientRect()

  if (containerRect) {
    tooltip.value = {
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 10,
      date: `${parseTime(cell.start, "M月D日")} ～ ${parseTime(cell.end, "M月D日")}`,
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

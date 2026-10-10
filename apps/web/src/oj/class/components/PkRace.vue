<script setup lang="ts">
import type { ClassPk } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { parseTime } from "utils/functions"
import { pkColor, shortLabels } from "../utils"

/**
 * 赛跑：每个班这学期累计人均做对，一周一个点，线尾写班名和到现在的人均。
 * 按 viewBox 等比缩放，放在多宽的格子里都行。
 */
const props = withDefaults(defineProps<{ pk: ClassPk; width?: number; height?: number }>(), {
  width: 700,
  height: 280,
})

const theme = useThemeVars()

// 右边留给线尾的「26计算机0班 19.3」：12px 粗体量下来 105 左右，原来的 92 会把小数截掉
const PAD = { left: 34, right: 112, top: 10, bottom: 26 }

const series = computed(() =>
  props.pk.classes.map((item) => {
    let sum = 0
    return item.weekly.map((value) => Math.round((sum += value) * 10) / 10)
  }),
)

const chart = computed(() => {
  const inner = {
    w: props.width - PAD.left - PAD.right,
    h: props.height - PAD.top - PAD.bottom,
  }
  const top = Math.max(1, ...series.value.flat())
  const step = top > 30 ? 10 : top > 12 ? 6 : top > 5 ? 2 : 1
  const max = Math.ceil(top / step) * step
  const count = props.pk.weeks.length
  const x = (index: number) =>
    PAD.left + (count > 1 ? (inner.w * index) / (count - 1) : inner.w / 2)
  const y = (value: number) => PAD.top + inner.h * (1 - value / max)

  const ticks = Array.from({ length: max / step + 1 }, (_, k) => ({
    value: k * step,
    y: y(k * step),
  }))
  // 周多了横轴字会挤：最多标 8 个，最后一周一定标
  const every = Math.max(1, Math.ceil(count / 8))
  const labels = props.pk.weeks
    .map((week, index) => ({ index, x: x(index), text: parseTime(week, "M月D日") }))
    .filter(({ index }) => index === count - 1 || (count - 1 - index) % every === 0)

  const labelsShort = shortLabels(props.pk)
  const lines = series.value.map((points, index) => ({
    color: pkColor(index),
    path: points.map((value, k) => `${x(k).toFixed(1)},${y(value).toFixed(1)}`).join(" "),
    dots: points.map((value, k) => ({ cx: x(k), cy: y(value) })),
    end: { y: y(points.at(-1) ?? 0), text: `${labelsShort[index]} ${points.at(-1) ?? 0}` },
  }))
  // 线尾的字别叠在一起：按高低排，挨得太近的往下推
  const ends = lines.map((line, index) => ({ index, y: line.end.y })).sort((a, b) => a.y - b.y)
  for (let k = 1; k < ends.length; k++)
    if (ends[k]!.y - ends[k - 1]!.y < 14) ends[k]!.y = ends[k - 1]!.y + 14
  for (const end of ends) lines[end.index]!.end.y = end.y

  return { ticks, labels, lines, endX: x(count - 1) + 10, right: PAD.left + inner.w }
})
</script>

<template>
  <svg
    class="race"
    :viewBox="`0 0 ${width} ${height}`"
    role="img"
    aria-label="各班这学期累计人均做对，一周一个点"
  >
    <g v-for="tick in chart.ticks" :key="tick.value">
      <line
        :x1="PAD.left"
        :x2="chart.right"
        :y1="tick.y"
        :y2="tick.y"
        :stroke="theme.dividerColor"
      />
      <text
        :x="PAD.left - 8"
        :y="tick.y + 4"
        font-size="11"
        :fill="theme.textColor3"
        text-anchor="end"
      >
        {{ tick.value }}
      </text>
    </g>
    <text
      v-for="label in chart.labels"
      :key="label.index"
      :x="label.x"
      :y="height - 6"
      font-size="11"
      :fill="theme.textColor3"
      text-anchor="middle"
    >
      {{ label.text }}
    </text>
    <g v-for="(line, index) in chart.lines" :key="index">
      <polyline
        :points="line.path"
        fill="none"
        :stroke="line.color"
        stroke-width="2.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle
        v-for="(dot, k) in line.dots"
        :key="k"
        :cx="dot.cx"
        :cy="dot.cy"
        r="3.2"
        :fill="theme.cardColor"
        :stroke="line.color"
        stroke-width="2"
      />
      <text :x="chart.endX" :y="line.end.y + 4" font-size="12" font-weight="700" :fill="line.color">
        {{ line.end.text }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.race {
  display: block;
  width: 100%;
  height: auto;
}
</style>

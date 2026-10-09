<script setup lang="ts">
import type { RankTrend } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { parseTime } from "utils/functions"

/**
 * 我和前后一名每周日晚上的名次。名次越小越好，所以纵轴倒过来（第 1 在最上面）。
 * 线的末端直接写名字，不要图例 —— 三条线，看名字比对颜色快。
 */
const props = defineProps<{
  trend: RankTrend
  lines: { userId: number; label: string; color: string; strong?: boolean }[]
}>()

const theme = useThemeVars()

const W = 400
const H = 190
const PAD = { left: 40, right: 64, top: 12, bottom: 26 }

const series = computed(() =>
  props.lines
    .map((line) => ({
      ...line,
      ranks: props.trend.series.find((s) => s.userId === line.userId)?.ranks,
    }))
    .filter((line): line is typeof line & { ranks: (number | null)[] } => !!line.ranks),
)

const range = computed(() => {
  const values = series.value.flatMap((line) => line.ranks.filter((v): v is number => v !== null))
  const lo = Math.max(1, Math.min(...values, 1e9) - 1)
  const hi = Math.max(lo + 2, Math.max(...values, 0) + 1)
  return { lo, hi }
})

const ticks = computed(() => {
  const { lo, hi } = range.value
  const step = Math.max(1, Math.ceil((hi - lo) / 5))
  const list: number[] = []
  for (let v = lo; v <= hi; v += step) list.push(v)
  return list
})

const n = computed(() => props.trend.points.length)

function x(i: number) {
  return PAD.left + ((W - PAD.left - PAD.right) * i) / Math.max(1, n.value - 1)
}

function y(rank: number) {
  const { lo, hi } = range.value
  return PAD.top + ((rank - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom)
}

/** 点是周一零点，说成前一天（周日晚上）；最后一个点是现在 */
const labels = computed(() =>
  props.trend.points.map((point, i) =>
    i === n.value - 1 ? "现在" : parseTime(new Date(Date.parse(point) - 1), "M月D日"),
  ),
)

function path(ranks: (number | null)[]) {
  let d = ""
  ranks.forEach((rank, i) => {
    if (rank === null) return
    d += `${d && ranks[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(rank).toFixed(1)} `
  })
  return d
}

/** 线尾的名字按纵坐标排开，挨得太近往下错开 */
const ends = computed(() => {
  const list = series.value
    .map((line) => {
      const last = line.ranks.at(-1)
      return last == null
        ? null
        : { y: y(last), text: `${line.label} 第${last}`, color: line.color }
    })
    .filter((end): end is { y: number; text: string; color: string } => !!end)
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < list.length; i++) {
    if (list[i]!.y - list[i - 1]!.y < 14) list[i]!.y = list[i - 1]!.y + 14
  }
  return list
})
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="chart" role="img" aria-label="我和前后一名每周的名次">
    <g v-for="tick in ticks" :key="tick">
      <line :x1="PAD.left" :x2="W - PAD.right" :y1="y(tick)" :y2="y(tick)" class="grid" />
      <text :x="PAD.left - 6" :y="y(tick) + 4" text-anchor="end" class="axis">第 {{ tick }}</text>
    </g>
    <text
      v-for="(label, i) in labels"
      :key="label"
      :x="x(i)"
      :y="H - 8"
      text-anchor="middle"
      class="axis"
    >
      {{ label }}
    </text>
    <g v-for="line in series" :key="line.userId">
      <path
        :d="path(line.ranks)"
        fill="none"
        :stroke="line.color"
        :stroke-width="line.strong ? 3 : 1.8"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <template v-for="(rank, i) in line.ranks" :key="i">
        <circle
          v-if="rank !== null"
          :cx="x(i)"
          :cy="y(rank)"
          :r="line.strong ? 3.5 : 2.5"
          class="dot"
          :stroke="line.color"
        />
      </template>
    </g>
    <text
      v-for="end in ends"
      :key="end.text"
      :x="W - PAD.right + 8"
      :y="end.y + 4"
      :fill="end.color"
      class="end"
    >
      {{ end.text }}
    </text>
  </svg>
</template>

<style scoped>
.chart {
  width: 100%;
  height: auto;
  display: block;
}

.grid {
  stroke: v-bind("theme.dividerColor");
  stroke-width: 1;
}

.axis {
  font-size: 11px;
  fill: v-bind("theme.textColor3");
}

.dot {
  fill: v-bind("theme.cardColor");
  stroke-width: 2;
}

.end {
  font-size: 12px;
  font-weight: 600;
}
</style>

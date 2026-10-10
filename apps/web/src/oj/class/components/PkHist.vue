<script setup lang="ts">
import { useThemeVars } from "naive-ui"

/**
 * 全班分布：横轴做对几道（0–30，再多的堆在最右一档），一根柱一档，虚线是中间那位同学。
 * 人少的档（不到 3 个）淡一点，一眼看到大部分人停在哪。
 */
const props = withDefaults(
  defineProps<{ values: number[]; median: number; color: string; height?: number }>(),
  { height: 44 },
)

const theme = useThemeVars()

const CAP = 30
const WIDTH = 560

const bars = computed(() => {
  const counts = new Map<number, number>()
  for (const value of props.values) {
    const key = Math.min(value, CAP)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const tallest = Math.max(16, ...counts.values())
  const width = WIDTH / (CAP + 1)
  return {
    width,
    list: [...counts].map(([value, n]) => {
      const h = Math.max(2, (props.height * n) / tallest)
      return { value, n, x: value * width + 0.5, y: props.height - h, h }
    }),
    median: (Math.min(props.median, CAP) + 0.5) * width,
  }
})
</script>

<template>
  <svg
    class="hist"
    :viewBox="`0 0 ${WIDTH} ${height + 12}`"
    role="img"
    aria-label="全班做对几道的分布"
  >
    <line :x1="0" :x2="WIDTH" :y1="height + 0.5" :y2="height + 0.5" :stroke="theme.dividerColor" />
    <rect
      v-for="bar in bars.list"
      :key="bar.value"
      :x="bar.x"
      :y="bar.y"
      :width="bars.width - 1"
      :height="bar.h"
      rx="1"
      :fill="color"
      :opacity="bar.n >= 3 ? 0.9 : 0.55"
    >
      <title>做对 {{ bar.value }}{{ bar.value === CAP ? " 道以上" : " 道" }}：{{ bar.n }} 人</title>
    </rect>
    <line
      :x1="bars.median"
      :x2="bars.median"
      y1="0"
      :y2="height"
      :stroke="theme.textColor2"
      stroke-dasharray="2 2"
    />
    <text x="0" :y="height + 11" font-size="9" :fill="theme.textColor3">0</text>
    <text
      :x="15 * bars.width"
      :y="height + 11"
      font-size="9"
      :fill="theme.textColor3"
      text-anchor="middle"
    >
      15
    </text>
    <text :x="WIDTH" :y="height + 11" font-size="9" :fill="theme.textColor3" text-anchor="end">
      30+
    </text>
  </svg>
</template>

<style scoped>
.hist {
  display: block;
  width: 100%;
  height: auto;
}
</style>

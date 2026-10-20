<script lang="ts" setup>
import { useThemeVars } from "naive-ui"
import type { FlowDoc } from "./model"
import { layoutDoc } from "./layout"
import { nodeLabel, shapePoints, useFlowPaint } from "./paint"

/**
 * 只看不改的流程图：和画流程图的画布同一套排版、形状、颜色（layoutDoc），没有 +、没有平移缩放。
 * 题面里老师给的参考图、出题页的预览用它 —— 原来走 Mermaid，排法和学生画的那张不一样，
 * 整张缩进左栏后字只剩十来像素。
 *
 * 宽度超过容器时整张按比例缩到正好放下（viewBox），不超过就按原大小居中。
 * zoomed（点开放大的弹框里）：放大到 1.5 倍、放不下就缩回容器宽，但不小于原大小 ——
 * 手机上宽图横着滚，不再缩成看不清的一团。
 */
const { doc, zoomed = false } = defineProps<{ doc: FlowDoc; zoomed?: boolean }>()

const theme = useThemeVars()
const { paint, lineColor } = useFlowPaint()

const root = useTemplateRef<HTMLElement>("root")
let measureCtx: CanvasRenderingContext2D | null = null
const fontFamily = ref("")
function measure(text: string) {
  if (measureCtx) return measureCtx.measureText(text).width
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? 14 : 7.8
  return w
}
onMounted(() => {
  const family = getComputedStyle(root.value!).fontFamily
  measureCtx = document.createElement("canvas").getContext("2d")
  if (measureCtx) measureCtx.font = `14px ${family}`
  fontFamily.value = family
})

const layout = computed(() => {
  void fontFamily.value
  return layoutDoc(doc, measure)
})

// 箭头的 marker 要全页唯一：出题页的预览里题面和「流程图」页签同时摆着两张
const markerId = `flow-view-arrow-${useId()}`
</script>

<template>
  <div ref="root" class="flow-view" :class="{ zoomed }">
    <svg
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      :style="
        zoomed
          ? { width: `${layout.width * 1.5}px`, minWidth: `${layout.width}px` }
          : { width: `${layout.width}px` }
      "
      role="img"
      aria-label="流程图"
      class="chart"
    >
      <defs>
        <marker
          :id="markerId"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5.5"
          markerHeight="5.5"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" :fill="lineColor" />
        </marker>
      </defs>
      <path
        v-for="(d, i) in layout.lines"
        :key="`l${i}`"
        :d="d"
        fill="none"
        :stroke="lineColor"
        stroke-width="1.6"
      />
      <path
        v-for="(d, i) in layout.arrows"
        :key="`a${i}`"
        :d="d"
        fill="none"
        :stroke="lineColor"
        stroke-width="1.6"
        :marker-end="`url(#${markerId})`"
      />
      <circle
        v-for="(p, i) in layout.dots"
        :key="`d${i}`"
        :cx="p.x"
        :cy="p.y"
        r="2.6"
        :fill="lineColor"
      />
      <text
        v-for="(t, i) in layout.labels"
        :key="`t${i}`"
        :x="t.x"
        :y="t.y"
        :text-anchor="t.anchor"
        class="branch-label"
      >
        {{ t.text }}
      </text>
      <g v-for="node in layout.nodes" :key="node.id">
        <rect
          v-if="node.kind === 'start' || node.kind === 'end'"
          :x="node.x"
          :y="node.y"
          :width="node.w"
          :height="node.h"
          :rx="node.h / 2"
          :fill="paint(node.kind).fill"
          :stroke="paint(node.kind).stroke"
          stroke-width="1.6"
        />
        <rect
          v-else-if="node.kind === 'process'"
          :x="node.x"
          :y="node.y"
          :width="node.w"
          :height="node.h"
          rx="2"
          :fill="paint(node.kind).fill"
          :stroke="paint(node.kind).stroke"
          stroke-width="1.6"
        />
        <polygon
          v-else
          :points="shapePoints(node)"
          :fill="paint(node.kind).fill"
          :stroke="paint(node.kind).stroke"
          stroke-width="1.6"
        />
        <text
          :x="node.x + node.w / 2"
          :y="node.y + node.h / 2 + 5"
          text-anchor="middle"
          :fill="paint(node.kind).text"
        >
          {{ nodeLabel(node) }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.flow-view {
  display: flex;
  justify-content: center;
}

.flow-view.zoomed {
  display: block;
  overflow-x: auto;
}

.chart {
  display: block;
  max-width: 100%;
  height: auto;
  font-family: inherit;
  font-size: 14px;
  overflow: visible;
}

.zoomed .chart {
  margin: 0 auto;
}

.branch-label {
  font-size: 13px;
  fill: v-bind("theme.textColor2");
}
</style>

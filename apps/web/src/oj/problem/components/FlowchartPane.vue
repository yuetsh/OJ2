<script setup lang="ts">
import { parseFlowDoc } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { useProblemStore } from 'oj/store/problem'
import { useMyFlowchartStore } from 'shared/store/myFlowchart'
import { useBackClose } from 'shared/composables/backClose'
import { useBreakpoints } from 'shared/composables/breakpoints'
import { useFlowchartGrade } from '../composables/flowchartTab'

const ProblemFlowchart = defineAsyncComponent(() => import('./ProblemFlowchart.vue'))
const FlowchartView = defineAsyncComponent(() => import('shared/components/FlowchartEditor/FlowchartView.vue'))
const MyFlowchart = defineAsyncComponent(() => import('./MyFlowchart.vue'))

/**
 * 左栏的「流程图」页签：老师给的参考图，或者学生自己画到 A/S 的那张（两个开关在出题页互斥，
 * 只会有一张）。原来夹在题面里，缩成 260 高的一小块，要对着它写代码就得在题面里来回滚
 * （用户 2026-11-09，设计稿「题目页观感」FcTab）。
 *
 * **默认按 100% 摆**，不自动缩到栏宽：一张三层判断的图原大 800 来宽，缩进 550 的左栏只剩六成，
 * 框里的字七八像素，等于没摆。放不下就拖着看，一打开停在顶上、对准「开始」。
 * 顶上「− 100% +」调大小，「看全图」缩到一屏放下看走向，「放大看」弹出整张。
 *
 * 图是两套渲染（参考图走结构树 FlowchartView、老图和学生的图走 Mermaid），各自都会把 <svg>
 * 缩到容器宽 —— 这里等图出来以后读 <svg> 原来的尺寸（viewBox），按缩放比例算出宽高写成外层的
 * CSS 变量，样式表里用 !important 压住 <svg> 上的内联宽高（pele 写了 max-width / height，
 * FlowchartView 的 :style 每次重渲染都会再写一遍，直接改 <svg> 的 style 留不住）。
 */
const theme = useThemeVars()
const { problem } = storeToRefs(useProblemStore())
const myFlowchartStore = useMyFlowchartStore()
const grade = useFlowchartGrade()

const isReference = computed(() => !!problem.value?.showFlowchart && !!problem.value?.mermaidCode)
const referenceDoc = computed(() => {
  const doc = parseFlowDoc(problem.value?.flowchartData)
  return doc?.steps.length ? doc : null
})
/** 换了一张图（换题、重新画到 A/S）：回到 100%、回到顶上正中 */
const chartKey = computed(() => `${problem.value?._id ?? ''}|${isReference.value ? 'ref' : myFlowchartStore.mermaidCode}`)

// ==================== 缩放 ====================
const STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2]
const scale = ref(1)
const percent = computed(() => Math.round(scale.value * 100))
function zoomOut() {
  scale.value = [...STEPS].reverse().find((step) => step < scale.value - 0.001) ?? scale.value
}
function zoomIn() {
  scale.value = STEPS.find((step) => step > scale.value + 0.001) ?? scale.value
}

const viewport = useTemplateRef<HTMLElement>('viewport')
const stage = useTemplateRef<HTMLElement>('stage')
/** 图原来多大（<svg> 的 viewBox） */
const natural = ref<{ width: number; height: number } | null>(null)

function currentSvg() {
  return stage.value?.querySelector<SVGSVGElement>(':scope > * > svg, :scope > * > * > svg') ?? null
}

function readNatural(svg: SVGSVGElement) {
  const box = svg.viewBox?.baseVal
  if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height }
  const rect = svg.getBoundingClientRect()
  return rect.width > 0 ? { width: rect.width, height: rect.height } : null
}

/** 写给外层的尺寸：量到原尺寸之前不写，图先按各自原来的样子摆着 */
const sizeVars = computed(() =>
  natural.value
    ? {
        '--flow-w': `${natural.value.width * scale.value}px`,
        '--flow-h': `${natural.value.height * scale.value}px`,
      }
    : {},
)

/** 「看全图」：宽、高都放得下的那个比例，最大 100% */
function fitAll() {
  const box = viewport.value
  if (!box || !natural.value) return
  const ratio = Math.min((box.clientWidth - 24) / natural.value.width, (box.clientHeight - 24) / natural.value.height, 1)
  scale.value = Math.max(0.2, Math.floor(ratio * 100) / 100)
}

/**
 * 一打开停在顶上，横向对准「开始」：图里最靠上的那一行字。不对准整张图的正中 —— 一串 else if
 * 往右下排的图（1035 成绩评定）正中在右边，「开始」和左边那几个框会被挤到栏外
 */
function centerTop() {
  const box = viewport.value
  const svg = currentSvg()
  if (!box) return
  box.scrollTop = 0
  const texts = svg ? [...svg.querySelectorAll('text, foreignObject')] : []
  const first = texts
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => rect.width > 0)
    .sort((a, b) => a.top - b.top)[0]
  if (!first) {
    box.scrollLeft = Math.max(0, (box.scrollWidth - box.clientWidth) / 2)
    return
  }
  const view = box.getBoundingClientRect()
  box.scrollLeft += first.left + first.width / 2 - (view.left + box.clientWidth / 2)
}

// 图是异步画出来的（Mermaid 要等渲染、组件要等加载）：<svg> 一换就重新量、重新写尺寸
let centered = false
let sizedSvg: SVGSVGElement | null = null
const observer = new MutationObserver(() => {
  const svg = currentSvg()
  if (!svg || svg === sizedSvg) return
  const size = readNatural(svg)
  if (!size) return
  sizedSvg = svg
  natural.value = size
  if (!centered) {
    centered = true
    nextTick(centerTop)
  }
})
onMounted(() => {
  if (stage.value) observer.observe(stage.value, { childList: true, subtree: true })
})
onBeforeUnmount(() => observer.disconnect())

watch(scale, async () => {
  const box = viewport.value
  // 缩放时保持中间那一点不跑：按比例换算滚动位置
  const before = box ? { x: box.scrollLeft + box.clientWidth / 2, y: box.scrollTop + box.clientHeight / 2, w: box.scrollWidth, h: box.scrollHeight } : null
  await nextTick()
  if (box && before && before.w > 0 && before.h > 0) {
    box.scrollLeft = (before.x / before.w) * box.scrollWidth - box.clientWidth / 2
    box.scrollTop = (before.y / before.h) * box.scrollHeight - box.clientHeight / 2
  }
})

watch(chartKey, () => {
  scale.value = 1
  natural.value = null
  sizedSvg = null
  centered = false
})

// ==================== 拖着看 ====================
let drag: { x: number; y: number; left: number; top: number; id: number } | null = null
const dragging = ref(false)
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || event.pointerType === 'touch' || !viewport.value) return
  drag = { x: event.clientX, y: event.clientY, left: viewport.value.scrollLeft, top: viewport.value.scrollTop, id: event.pointerId }
  viewport.value.setPointerCapture(event.pointerId)
  dragging.value = true
}
function onPointerMove(event: PointerEvent) {
  if (!drag || !viewport.value || event.pointerId !== drag.id) return
  viewport.value.scrollLeft = drag.left - (event.clientX - drag.x)
  viewport.value.scrollTop = drag.top - (event.clientY - drag.y)
}
function onPointerUp(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  viewport.value?.releasePointerCapture(event.pointerId)
  drag = null
  dragging.value = false
}

// ==================== 放大看 ====================
const zoomOpen = ref(false)
const { isMobile } = useBreakpoints()
useBackClose(zoomOpen, isMobile)
</script>

<template>
  <div class="flow-pane">
    <div class="flow-toolbar">
      <span class="who">
        <template v-if="isReference">老师给的参考图</template>
        <template v-else>
          你画的<template v-if="grade">
            · <b class="grade">{{ grade }} 级</b></template
          >
        </template>
      </span>
      <span class="spacer" />
      <span class="zoom">
        <button type="button" aria-label="缩小" :disabled="scale <= STEPS[0]!" @click="zoomOut">−</button>
        <span class="percent">{{ percent }}%</span>
        <button type="button" aria-label="放大" :disabled="scale >= STEPS[STEPS.length - 1]!" @click="zoomIn">+</button>
      </span>
      <n-button text type="primary" @click="fitAll">看全图</n-button>
      <n-button text type="primary" @click="zoomOpen = true">放大看 ›</n-button>
    </div>
    <div
      ref="viewport"
      class="flow-viewport"
      :class="{ dragging }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div ref="stage" class="flow-stage" :class="{ sized: !!natural }" :style="sizeVars">
        <template v-if="isReference">
          <FlowchartView v-if="referenceDoc" :doc="referenceDoc" />
          <ProblemFlowchart v-else />
        </template>
        <MyFlowchart v-else />
      </div>
    </div>
    <n-modal v-model:show="zoomOpen" preset="card" :title="isReference ? '参考流程图' : '你画的流程图'" :style="{ maxWidth: '1000px' }">
      <template v-if="isReference">
        <FlowchartView v-if="referenceDoc" :doc="referenceDoc" zoomed />
        <ProblemFlowchart v-else />
      </template>
      <MyFlowchart v-else />
    </n-modal>
  </div>
</template>

<style scoped>
.flow-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.flow-toolbar {
  flex: none;
  height: 44px;
  box-sizing: border-box;
  padding: 0 12px 0 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.who {
  font-size: 14px;
  color: v-bind('theme.textColor2');
}

.grade {
  color: v-bind('theme.successColor');
}

.spacer {
  flex: 1 1 auto;
}

.zoom {
  display: inline-flex;
  align-items: center;
  height: 28px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 6px;
  overflow: hidden;
}

.zoom button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 16px;
  color: v-bind('theme.textColor1');
  cursor: pointer;
}

.zoom button:disabled {
  opacity: 0.35;
  cursor: default;
}

.zoom button:not(:disabled):hover {
  background-color: rgba(128, 128, 128, 0.1);
}

.percent {
  min-width: 46px;
  text-align: center;
  font-size: 13px;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
  border-left: 1px solid v-bind('theme.dividerColor');
  border-right: 1px solid v-bind('theme.dividerColor');
}

.flow-viewport {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  cursor: grab;
  background-color: rgba(128, 128, 128, 0.04);
}

.flow-viewport.dragging {
  cursor: grabbing;
  user-select: none;
}

/*
 * 图比栏宽的时候要能滚到左边：两种渲染的外层都是 flex 居中，图一宽，左边那截就伸到滚动区外面、
 * 滚不过去。这里把外层改成「跟着图一样宽、至少一栏宽」的块，窄图靠 text-align 居中
 */
.flow-stage {
  padding: 16px 12px;
  width: max-content;
  min-width: 100%;
  box-sizing: border-box;
  text-align: center;
}

.flow-stage :deep(.flowchart-container),
.flow-stage :deep(.flow-view),
.flow-stage :deep(.container) {
  display: block;
  width: max-content;
  min-width: 100%;
  min-height: 0;
}

/* Mermaid 的图外面自带一圈边框和滚动（index.css 的 .oj-mermaid-surface）：页签整栏就是图，不再框一层、也不套第二层滚动 */
.flow-stage :deep(.oj-mermaid-surface) {
  padding: 0;
  border: 0;
  overflow: visible;
}

.flow-stage :deep(.flowchart-container > svg),
.flow-stage :deep(.flow-view > svg),
.flow-stage :deep(.container > svg) {
  display: inline-block;
  vertical-align: top;
}

.flow-stage.sized :deep(.flowchart-container > svg),
.flow-stage.sized :deep(.flow-view > svg),
.flow-stage.sized :deep(.container > svg) {
  width: var(--flow-w) !important;
  height: var(--flow-h) !important;
  max-width: none !important;
  min-width: 0 !important;
}
</style>

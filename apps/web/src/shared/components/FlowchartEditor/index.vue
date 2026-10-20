<script lang="ts" setup>
import { useThemeVars } from "naive-ui"
import storage from "utils/storage"
import {
  cloneDoc,
  emptyDoc,
  findStep,
  insertStep,
  parseDoc,
  removeStep,
  signature,
  STEP_LABEL,
  type FlowDoc,
  type FlowHighlight,
  type StepKind,
} from "./model"
import { layoutDoc, PLACEHOLDER, type LaidNode, type LaidSlot } from "./layout"
import { nodeLabel, shapePoints, useFlowPaint } from "./paint"

/**
 * 画流程图（插入式）。设计稿：画布「画流程图重设计」页的 FlowEdB / FlowEdBLoop。
 *
 * 没有拖拽：每根箭头上有个 +，点了选「输入 / 输出 / 处理 / 判断 / 循环」，新的一步就接在
 * 那根箭头上；判断自动分出是 / 否两路再合回来，排版全自动。点一个框直接改字，旁边有「删除」。
 * 原来的 vue-flow 编辑器要从节点库拖框、对准连接点拉线、自己摆位置，学生大半时间花在
 * 理线上，还能画出断线和孤立的框。
 *
 * 画布本身只剩平移和缩放：按住空白处拖动、滚轮上下移、Ctrl + 滚轮缩放、左下角三个按钮。
 */

interface Props {
  height?: string
  /**
   * 题目页（默认）：每道题一份本地草稿，自动存。
   * false：图交给外面管（后台出题页的参考流程图，v-model:value），不存草稿
   */
  draft?: boolean
  /**
   * 草稿存在哪个键下，由题目页给（见 ProblemEditor.vue 的 flowchartDraftKey）。原来是这里
   * 自己读题目页的 store 和路由拼出来的，后台出题页也用这个组件，那边 store 是空的
   */
  draftKey?: string
}
const {
  height = "calc(100vh - 134px)",
  draft = true,
  draftKey = "flowchart-v2",
} = defineProps<Props>()
const model = defineModel<FlowDoc | null>("value", { default: null })

const message = useMessage()
const theme = useThemeVars()
const { isDark, paint, lineColor } = useFlowPaint()

// ==================== 数据与历史 ====================

const doc = ref<FlowDoc>(emptyDoc())

/** 每一步改动之后的样子，撤销就是往回退一格。打字不进历史，改完（失焦 / 回车）才进 */
const history = ref<string[]>([])
const cursor = ref(-1)
const HISTORY_LIMIT = 50
const canUndo = computed(() => cursor.value > 0)
const canRedo = computed(() => cursor.value < history.value.length - 1)

function snapshot() {
  const state = JSON.stringify(doc.value)
  if (history.value[cursor.value] === state) return
  history.value = [...history.value.slice(0, cursor.value + 1), state].slice(-HISTORY_LIMIT)
  cursor.value = history.value.length - 1
}

function resetHistory() {
  history.value = [JSON.stringify(doc.value)]
  cursor.value = 0
}

function restore(index: number) {
  const state = history.value[index]
  if (state === undefined) return
  cursor.value = index
  doc.value = JSON.parse(state) as FlowDoc
  deselect()
}

function undo() {
  commitText()
  if (canUndo.value) restore(cursor.value - 1)
}

function redo() {
  commitText()
  if (canRedo.value) restore(cursor.value + 1)
}

// ==================== 草稿 ====================

const cacheKey = computed(() => draftKey)

const savedAt = ref<Date | null>(null)

function loadDraft() {
  if (!draft) {
    doc.value = model.value ? cloneDoc(model.value) : emptyDoc()
    deselect()
    resetHistory()
    fitSoon()
    return
  }
  let saved: unknown = null
  try {
    saved = storage.get(cacheKey.value)
  } catch {
    saved = null
  }
  const record = saved as { doc?: unknown; savedAt?: string } | null
  const parsed = parseDoc(record?.doc)
  doc.value = parsed ?? emptyDoc()
  savedAt.value = parsed && record?.savedAt ? new Date(record.savedAt) : null
  deselect()
  resetHistory()
  fitSoon()
}

const saveDraft = useDebounceFn((key: string) => {
  // 换题之后才到点的这一下是上一道题的，别写进新题的键
  if (key !== cacheKey.value) return
  try {
    if (doc.value.steps.length) {
      const now = new Date()
      storage.set(key, { doc: doc.value, savedAt: now.toISOString() })
      savedAt.value = now
    } else {
      storage.remove(key)
      savedAt.value = null
    }
  } catch {
    // 本地存储满了或者被禁用：画布照常能画，只是刷新会丢
  }
}, 400)

let loading = false
watch(
  doc,
  () => {
    if (loading) return
    if (draft) saveDraft(cacheKey.value)
    else model.value = cloneDoc(doc.value)
  },
  { deep: true },
)

/** 外面换了一张图（后台点了「AI 照答案画一张」）：摆上来，进历史，Ctrl+Z 能回去 */
watch(model, (next) => {
  if (draft || !next || signature(next) === signature(doc.value)) return
  setDoc(next)
})

watch(cacheKey, () => {
  if (!draft) return
  loading = true
  loadDraft()
  nextTick(() => (loading = false))
})

// ==================== 排版与视口 ====================

const viewport = useTemplateRef<HTMLElement>("viewport")
const { width: viewW, height: viewH } = useElementSize(viewport)

/** 量字宽用的画布。字体跟着编辑器自己的（Naive 的全局字体），量出来和 SVG 里画的一致 */
let measureCtx: CanvasRenderingContext2D | null = null
const fontFamily = ref("")
function measure(text: string) {
  if (measureCtx) return measureCtx.measureText(text).width
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? 14 : 7.8
  return w
}

const layout = computed(() => {
  // 字体就位之后重排一次
  void fontFamily.value
  return layoutDoc(doc.value, measure)
})

const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const MIN_ZOOM = 0.4
const MAX_ZOOM = 1.6

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
}

/**
 * 缩放到正好装下整张图（最多 100%），横向居中、靠上。
 * 进页面、载回旧版时（auto）高度方向最多缩到 85%：机房 1366×768 的屏上画布只有五百来像素高，
 * 十几个框的图（蜜橘分拣是 p90）整张塞进去字只剩 10px，宁可往下滚。左下角的按钮是真的整张装下
 */
function fit(auto = false) {
  const vw = viewW.value
  const vh = viewH.value
  if (!vw || !vh) return
  const { width, height: h } = layout.value
  const byHeight = (vh - 16) / h
  zoom.value = clampZoom(Math.min(1, (vw - 24) / width, auto ? Math.max(byHeight, 0.85) : byHeight))
  pan.value = { x: (vw - width * zoom.value) / 2, y: 8 }
}

/** 进页面、换题、载回旧版：等视口量出尺寸再缩放 */
let fitPending = false
function fitSoon() {
  fitPending = true
  nextTick(() => {
    if (fitPending && viewW.value && viewH.value) {
      fitPending = false
      fit(true)
    }
  })
}
watch([viewW, viewH], () => {
  if (fitPending && viewW.value && viewH.value) {
    fitPending = false
    fit(true)
  }
})

/**
 * 加了一步之后整张图会重排：左边长出一个分支，中线就往右挪。画布不跟着挪的话，
 * 学生刚点的那个位置会在眼前跳走。这里把中线（开始那个框）钉在屏幕上原来的位置
 */
const startX = computed(() => {
  const start = layout.value.nodes.find((n) => n.kind === "start")
  return start ? start.x + start.w / 2 : 0
})
watch(startX, (next, prev) => {
  if (fitPending || prev === undefined) return
  pan.value = { ...pan.value, x: pan.value.x - (next - prev) * zoom.value }
})

function zoomAt(next: number, sx: number, sy: number) {
  const z = clampZoom(next)
  const k = z / zoom.value
  pan.value = { x: sx - (sx - pan.value.x) * k, y: sy - (sy - pan.value.y) * k }
  zoom.value = z
}

function zoomBy(delta: number) {
  zoomAt(zoom.value + delta, viewW.value / 2, viewH.value / 2)
}

function onWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) {
    const rect = viewport.value!.getBoundingClientRect()
    zoomAt(
      zoom.value * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
      event.clientX - rect.left,
      event.clientY - rect.top,
    )
    return
  }
  const dx = event.shiftKey ? event.deltaY : event.deltaX
  const dy = event.shiftKey ? 0 : event.deltaY
  pan.value = { x: pan.value.x - dx, y: pan.value.y - dy }
  menuSlot.value = null
}

/** 按住空白处拖动画布；没怎么动就算点了一下空白：取消选中、收起菜单 */
let drag: { x: number; y: number; px: number; py: number; moved: boolean; id: number } | null = null
const dragging = ref(false)
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  drag = {
    x: event.clientX,
    y: event.clientY,
    px: pan.value.x,
    py: pan.value.y,
    moved: false,
    id: event.pointerId,
  }
  viewport.value?.setPointerCapture(event.pointerId)
}
function onPointerMove(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return
  const dx = event.clientX - drag.x
  const dy = event.clientY - drag.y
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  drag.moved = true
  dragging.value = true
  pan.value = { x: drag.px + dx, y: drag.py + dy }
}
function onPointerUp(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return
  const moved = drag.moved
  drag = null
  dragging.value = false
  if (!moved) {
    menuSlot.value = null
    deselect()
  }
}

/** 某个框在不在视口里，不在就挪到看得见 */
function reveal(id: string) {
  const node = layout.value.nodes.find((n) => n.id === id)
  if (!node) return
  const margin = 40
  const z = zoom.value
  const left = pan.value.x + node.x * z
  const right = pan.value.x + (node.x + node.w) * z
  const top = pan.value.y + node.y * z
  const bottom = pan.value.y + (node.y + node.h) * z
  let { x, y } = pan.value
  if (bottom > viewH.value - margin) y -= bottom - (viewH.value - margin)
  if (top < margin) y += margin - top
  if (right > viewW.value - margin) x -= right - (viewW.value - margin)
  if (left < margin) x += margin - left
  pan.value = { x, y }
}

// ==================== 插一步 ====================

const menuSlot = ref<LaidSlot | null>(null)
const MENU: { kind: StepKind }[] = [
  { kind: "input" },
  { kind: "output" },
  { kind: "process" },
  { kind: "if" },
  { kind: "while" },
]
const MENU_W = 300
const MENU_H = 62

const menuStyle = computed(() => {
  const slot = menuSlot.value
  if (!slot) return {}
  const sx = pan.value.x + slot.x * zoom.value
  const sy = pan.value.y + slot.y * zoom.value
  let left = sx - MENU_W / 2
  let top = sy + 16
  left = Math.max(8, Math.min(left, viewW.value - MENU_W - 8))
  if (top + MENU_H > viewH.value - 8) top = sy - 16 - MENU_H
  return { left: `${left}px`, top: `${top}px`, width: `${MENU_W}px` }
})

function openMenu(slot: LaidSlot) {
  commitText()
  deselect()
  menuSlot.value = menuSlot.value?.key === slot.key ? null : slot
}

function insert(kind: StepKind) {
  const slot = menuSlot.value?.slot
  menuSlot.value = null
  if (!slot) return
  const step = insertStep(doc.value, slot, kind)
  if (!step) return
  snapshot()
  select(step.id)
  justInserted = step.id
  nextTick(() => reveal(step.id))
}

// ==================== 选中、改字、删除 ====================

const selectedId = ref<string | null>(null)
const selected = computed(() =>
  selectedId.value ? (layout.value.nodes.find((n) => n.id === selectedId.value) ?? null) : null,
)
const textInput = useTemplateRef<HTMLInputElement>("textInput")
/** 开始改字前的字，按 Esc 还原 */
let textBefore = ""
/** 刚从菜单里加上的那一步 */
let justInserted: string | null = null

function editable(node: LaidNode) {
  return node.kind !== "start" && node.kind !== "end"
}

function select(id: string) {
  commitText()
  menuSlot.value = null
  const found = findStep(doc.value.steps, id)
  if (!found) return
  selectedId.value = id
  textBefore = found.step.text
  nextTick(() => textInput.value?.focus())
}

function onNodeClick(node: LaidNode) {
  if (!editable(node)) {
    menuSlot.value = null
    deselect()
    return
  }
  if (selectedId.value !== node.id) select(node.id)
}

const selectedText = computed({
  get: () =>
    selectedId.value ? (findStep(doc.value.steps, selectedId.value)?.step.text ?? "") : "",
  set: (value: string) => {
    const found = selectedId.value ? findStep(doc.value.steps, selectedId.value) : null
    if (found) found.step.text = value
  },
})

/** 字改完了：进历史 */
function commitText() {
  if (!selectedId.value) return
  const found = findStep(doc.value.steps, selectedId.value)
  if (found && found.step.text !== textBefore) {
    found.step.text = found.step.text.replace(/\s+/g, " ").trim()
    textBefore = found.step.text
    snapshot()
  }
}

function deselect() {
  commitText()
  selectedId.value = null
}

function onTextKey(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault()
    deselect()
  } else if (event.key === "Escape") {
    // 刚加上、一个字没写就按 Esc：当它没加过（连历史那一格一起撤掉）
    if (selectedId.value === justInserted && !selectedText.value.trim()) {
      selectedId.value = null
      restore(cursor.value - 1)
      history.value = history.value.slice(0, cursor.value + 1)
      return
    }
    selectedText.value = textBefore
    selectedId.value = null
  }
}

function removeSelected() {
  const id = selectedId.value
  if (!id) return
  commitText()
  selectedId.value = null
  const count = removeStep(doc.value, id)
  if (!count) return
  snapshot()
  if (count > 1) message.info(`删掉了 ${count} 个框，按 Ctrl+Z 可以撤回`)
}

/** 判断 / 循环里的字框要比外框窄，免得打字时字跑出菱形 */
function inputBox(node: LaidNode) {
  const inset =
    node.kind === "if" || node.kind === "while" ? node.w * 0.22 : node.kind === "process" ? 8 : 16
  return {
    left: `${node.x + inset}px`,
    top: `${node.y}px`,
    width: `${node.w - inset * 2}px`,
    height: `${node.h}px`,
  }
}

function clear() {
  if (!doc.value.steps.length) return
  doc.value = emptyDoc()
  deselect()
  snapshot()
}

// ==================== 键盘 ====================

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable
  )
    return
  if (event.key === "Escape" && menuSlot.value) {
    menuSlot.value = null
    return
  }
  if (!(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (key === "z" && !event.shiftKey) {
    event.preventDefault()
    undo()
  } else if ((key === "z" && event.shiftKey) || key === "y") {
    event.preventDefault()
    redo()
  }
}

onMounted(() => {
  const family = getComputedStyle(viewport.value!).fontFamily
  measureCtx = document.createElement("canvas").getContext("2d")
  if (measureCtx) measureCtx.font = `14px ${family}`
  fontFamily.value = family
  loading = true
  loadDraft()
  nextTick(() => (loading = false))
  document.addEventListener("keydown", onKeyDown)
})
onUnmounted(() => document.removeEventListener("keydown", onKeyDown))

// ==================== 颜色 ====================

const dotColor = computed(() => (isDark.value ? "#34363b" : "#e3e5e8"))

/** 菜单里的小图标：和画布上同一套形状 */
function miniPoints(kind: StepKind) {
  if (kind === "input" || kind === "output") return "6,2 25,2 20,14 1,14"
  if (kind === "if") return "13,1 25,8 13,15 1,8"
  return "15,1 25,6 15,11 5,6"
}

// ==================== 走例子的路径 ====================

/**
 * 结果页签里点了某一组数据：亮出它在图上走过的框（按第一次经过的先后编号），最先出问题的
 * 那个标红，没走到的变淡（设计稿 FlowResFail）。图一改就收掉 —— 路径是按交上去那一版走的
 */
const highlightSet = shallowRef<{ value: FlowHighlight; shape: string } | null>(null)
/** 记下亮的时候图长什么样，之后不一样了就不亮（不用 watch 去清：进页面读草稿也会改 doc） */
const highlight = computed(() =>
  highlightSet.value && highlightSet.value.shape === signature(doc.value)
    ? highlightSet.value.value
    : null,
)
const stepNo = computed(() => new Map((highlight.value?.order ?? []).map((id, i) => [id, i + 1])))

function setHighlight(next: FlowHighlight | null) {
  highlightSet.value = next ? { value: next, shape: signature(doc.value) } : null
  const target = next?.bad ?? next?.order.at(-1)
  if (target) nextTick(() => reveal(target))
}

function nodeState(node: LaidNode) {
  if (!highlight.value) return ""
  if (node.id === highlight.value.bad) return "bad"
  // 只标一个框（没点开哪一组）时别的框照常，不变淡
  if (!highlight.value.order.length) return ""
  return stepNo.value.has(node.id) ? "onpath" : "dim"
}

/** 标红那个框旁边的标签，贴在框的右边；判断、循环右顶点外写着「否」，再让开一点 */
const badTag = computed(() => {
  const label = highlight.value?.label
  const node = label && layout.value.nodes.find((item) => item.id === highlight.value?.bad)
  if (!label || !node) return null
  const w = label.length * 12 + 20
  const gap = node.kind === "if" || node.kind === "while" ? 26 : 8
  return { label, x: node.x + node.w + gap, y: node.y + node.h / 2 - 11, w }
})

/** 编号圆点的位置：方框贴在左上角，菱形挪到顶点右边（左边是「是」） */
function badgeAt(node: LaidNode) {
  if (node.kind === "if" || node.kind === "while")
    return { x: node.x + node.w / 2 + 16, y: node.y + 2 }
  return { x: node.x - 2, y: node.y + 2 }
}

// ==================== 对外 ====================

/**
 * 交出去 / 和某一版比：一份拷贝，外面改不到画布。不顺手 commitText —— 结果页签在 computed
 * 里读它，读一下就往历史里塞一格是副作用；正在打的字本来就已经写进 doc 了
 */
function getDoc(): FlowDoc {
  return cloneDoc(doc.value)
}

/** 载回某一版。进历史：载错了 Ctrl+Z 能回来 */
function setDoc(next: FlowDoc) {
  doc.value = cloneDoc(next)
  deselect()
  snapshot()
  fitSoon()
}

defineExpose({ getDoc, setDoc, undo, redo, clear, setHighlight, canUndo, canRedo, savedAt })
</script>

<template>
  <div
    ref="viewport"
    class="flow-editor"
    :class="{ panning: dragging }"
    :style="{ height }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.prevent="onWheel"
  >
    <div
      class="stage"
      :style="{
        width: `${layout.width}px`,
        height: `${layout.height}px`,
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
      }"
    >
      <svg
        :width="layout.width"
        :height="layout.height"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        role="img"
        aria-label="流程图"
        class="chart"
      >
        <defs>
          <marker
            id="flow-arrow"
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
          marker-end="url(#flow-arrow)"
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
        <g
          v-for="node in layout.nodes"
          :key="node.id"
          class="node"
          :class="[{ editable: editable(node), selected: node.id === selectedId }, nodeState(node)]"
          @pointerdown.stop
          @click.stop="onNodeClick(node)"
        >
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
            v-if="node.id !== selectedId"
            :x="node.x + node.w / 2"
            :y="node.y + node.h / 2 + 5"
            text-anchor="middle"
            :fill="paint(node.kind).text"
            :class="{ placeholder: editable(node) && !node.text.trim() }"
          >
            {{ nodeLabel(node) }}
          </text>
        </g>
        <template v-for="node in layout.nodes" :key="`b${node.id}`">
          <g v-if="stepNo.has(node.id)" class="badge" aria-hidden="true">
            <circle :cx="badgeAt(node).x" :cy="badgeAt(node).y" r="10" />
            <text :x="badgeAt(node).x" :y="badgeAt(node).y + 4" text-anchor="middle">
              {{ stepNo.get(node.id) }}
            </text>
          </g>
        </template>
        <g v-if="badTag" class="bad-tag" aria-hidden="true">
          <rect :x="badTag.x" :y="badTag.y" :width="badTag.w" height="22" rx="11" />
          <text :x="badTag.x + badTag.w / 2" :y="badTag.y + 15" text-anchor="middle">
            {{ badTag.label }}
          </text>
        </g>
      </svg>

      <button
        v-for="slot in layout.slots"
        :key="slot.key"
        type="button"
        class="slot"
        :class="{ active: menuSlot?.key === slot.key, lone: !doc.steps.length }"
        :style="{ left: `${slot.x}px`, top: `${slot.y}px` }"
        aria-label="在这里加一步"
        @pointerdown.stop
        @click.stop="openMenu(slot)"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5H9M5 1V9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>

      <template v-if="selected">
        <input
          ref="textInput"
          v-model="selectedText"
          class="text-input"
          :style="inputBox(selected)"
          :placeholder="PLACEHOLDER[selected.kind as StepKind]"
          :aria-label="`${STEP_LABEL[selected.kind as StepKind]}框里的字`"
          maxlength="60"
          @pointerdown.stop
          @keydown="onTextKey"
          @blur="commitText"
        />
        <div
          class="node-bar"
          :style="{
            left: `${selected.x + selected.w - 24}px`,
            top: `${selected.y - 4}px`,
          }"
          @pointerdown.stop
        >
          <button type="button" class="remove" @mousedown.prevent @click="removeSelected">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />
            </svg>
            删除
          </button>
        </div>
      </template>
    </div>

    <div
      v-if="menuSlot"
      class="insert-menu"
      :style="menuStyle"
      role="menu"
      aria-label="加一步"
      @pointerdown.stop
    >
      <button
        v-for="item in MENU"
        :key="item.kind"
        type="button"
        role="menuitem"
        class="insert-item"
        @click="insert(item.kind)"
      >
        <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">
          <rect
            v-if="item.kind === 'process'"
            x="2"
            y="2"
            width="22"
            height="12"
            rx="1"
            :fill="paint('process').fill"
            :stroke="paint('process').stroke"
            stroke-width="1.4"
          />
          <polygon
            v-else
            :points="miniPoints(item.kind)"
            :fill="paint(item.kind).fill"
            :stroke="paint(item.kind).stroke"
            stroke-width="1.4"
          />
          <path
            v-if="item.kind === 'while'"
            d="M15 11v3H2V6h3"
            fill="none"
            :stroke="lineColor"
            stroke-width="1.2"
          />
        </svg>
        <span>{{ STEP_LABEL[item.kind] }}</span>
      </button>
    </div>

    <div class="zoom" @pointerdown.stop>
      <button type="button" aria-label="放大" @click="zoomBy(0.1)">+</button>
      <button type="button" aria-label="缩小" @click="zoomBy(-0.1)">−</button>
      <button type="button" aria-label="缩放到合适" @click="fit()">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.flow-editor {
  position: relative;
  width: 100%;
  overflow: hidden;
  background-color: v-bind("theme.cardColor");
  background-image: radial-gradient(v-bind("dotColor") 1px, transparent 1px);
  background-size: 16px 16px;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.flow-editor.panning {
  cursor: grabbing;
}

.stage {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}

.chart {
  display: block;
  font-family: inherit;
  font-size: 14px;
  overflow: visible;
}

.branch-label {
  font-size: 13px;
  fill: v-bind("theme.textColor2");
}

.node.editable {
  cursor: pointer;
}

.node:not(.editable) {
  cursor: default;
}

.node.editable:hover > rect,
.node.editable:hover > polygon {
  stroke-width: 2.4;
}

.node.selected > rect,
.node.selected > polygon {
  stroke: #18a058;
  stroke-width: 2.6;
}

.node.dim {
  opacity: 0.35;
}

.node.onpath > rect,
.node.onpath > polygon {
  stroke: v-bind("theme.textColor1");
  stroke-width: 2.4;
}

.node.bad > rect,
.node.bad > polygon {
  stroke: #d03050;
  stroke-width: 2.6;
  fill: rgba(208, 48, 80, 0.12);
}

.bad-tag rect {
  fill: #d03050;
}

.bad-tag text {
  font-size: 12px;
  fill: #ffffff;
}

.badge circle {
  fill: v-bind("theme.textColor1");
}

.badge text {
  font-size: 12px;
  font-weight: 700;
  fill: v-bind("theme.cardColor");
}

.placeholder {
  opacity: 0.5;
}

.slot {
  position: absolute;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  padding: 0;
  border: 1.2px solid v-bind("theme.borderColor");
  border-radius: 50%;
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor3");
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.slot:hover,
.slot:focus-visible,
.slot.lone {
  border-color: #18a058;
  color: #18a058;
}

.slot.lone {
  width: 24px;
  height: 24px;
  margin: -12px 0 0 -12px;
}

.slot.active {
  border-color: #18a058;
  background: #18a058;
  color: #fff;
}

.text-input {
  position: absolute;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 14px;
  text-align: center;
  color: v-bind("theme.textColor1");
  user-select: text;
}

.text-input::placeholder {
  color: v-bind("theme.textColor3");
}

/* 浮在框的右上方：放右边会盖住判断的「否」，放正上方会盖住进来的那个 + */
.node-bar {
  position: absolute;
  transform: translateY(-100%);
  display: flex;
  padding: 3px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.remove {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  color: v-bind("theme.errorColor");
  cursor: pointer;
}

.remove:hover {
  background: rgba(208, 48, 80, 0.08);
}

.insert-menu {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  gap: 2px;
  padding: 4px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  cursor: default;
}

.insert-item {
  flex: 1;
  height: 52px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor1");
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  cursor: pointer;
}

.insert-item:hover,
.insert-item:focus-visible {
  background: rgba(24, 160, 88, 0.1);
}

.zoom {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 4px;
  background: v-bind("theme.cardColor");
  overflow: hidden;
  cursor: default;
}

.zoom button {
  width: 30px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 16px;
  color: v-bind("theme.textColor2");
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.zoom button + button {
  border-top: 1px solid v-bind("theme.dividerColor");
}

.zoom button:hover {
  color: #18a058;
}
</style>

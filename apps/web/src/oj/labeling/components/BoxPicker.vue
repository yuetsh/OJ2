<script setup lang="ts">
import type { LabelingBox } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { labelColor, labelStroke } from '../utils/colors'
import LabelingImage from './LabelingImage.vue'

/**
 * 框选的画框（学生页和后台共用，设计稿 LabelBoxDesk，设计文档 3.6 节）。只按电脑鼠标做，手机不管。
 *
 * - 在空白处按住拖出一个框，松开后在框上方弹出类别，点一个就标好；点「取消」或点别处，这个框不要了。
 * - 点已经画好的框：四个角出小方块，拖角改大小、拖中间挪位置；弹条可以换类别或删掉。
 * - 坐标一律按图片比例（0–1）存，和图显示多大无关。
 */
const props = withDefaults(
  defineProps<{ labelingId: number; itemId: number; labels: string[]; modelValue: LabelingBox[]; disabled?: boolean; compact?: boolean }>(),
  { disabled: false, compact: false },
)
const emit = defineEmits<{ 'update:modelValue': [boxes: LabelingBox[]] }>()

const isDark = useDark()
const theme = useThemeVars()

const stage = ref<HTMLElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const ready = ref(false)

type Rect = Omit<LabelingBox, 'label'>
type Corner = 'tl' | 'tr' | 'bl' | 'br'

/** 正在拖：画新框 / 挪一个框 / 拉一个角 */
const drag = ref<
  | { type: 'draw'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'move'; index: number; px: number; py: number; orig: Rect; moved: boolean }
  | { type: 'resize'; index: number; corner: Corner; orig: Rect }
  | null
>(null)
/** 画好了还没选类别的框 */
const pending = ref<Rect | null>(null)
/** 点开的那个已画好的框 */
const selected = ref<number | null>(null)

/** 太小的当成点了一下，不算画了框（按屏幕上的像素算） */
const MIN_PIXELS = 8
const MIN_SIZE = 0.01

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi)
}

function point(event: PointerEvent) {
  const r = stage.value!.getBoundingClientRect()
  return { x: clamp((event.clientX - r.left) / r.width, 0, 1), y: clamp((event.clientY - r.top) / r.height, 0, 1) }
}

function normalize(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
}

const drawing = computed(() => (drag.value?.type === 'draw' ? normalize(drag.value.x0, drag.value.y0, drag.value.x1, drag.value.y1) : null))

function closePop() {
  pending.value = null
  selected.value = null
}

function setBox(index: number, rect: Rect) {
  emit(
    'update:modelValue',
    props.modelValue.map((b, i) => (i === index ? { ...b, ...rect } : b)),
  )
}

// ---------------------------------------------------------------- 按下、拖、松开

function downStage(event: PointerEvent) {
  if (props.disabled || event.button !== 0 || !ready.value) return
  event.preventDefault()
  closePop()
  const p = point(event)
  drag.value = { type: 'draw', x0: p.x, y0: p.y, x1: p.x, y1: p.y }
  stage.value!.setPointerCapture(event.pointerId)
}

function downBox(index: number, event: PointerEvent) {
  if (props.disabled || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  pending.value = null
  selected.value = index
  const p = point(event)
  drag.value = { type: 'move', index, px: p.x, py: p.y, orig: { ...props.modelValue[index]! }, moved: false }
  stage.value!.setPointerCapture(event.pointerId)
}

function downHandle(index: number, corner: Corner, event: PointerEvent) {
  if (props.disabled || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  drag.value = { type: 'resize', index, corner, orig: { ...props.modelValue[index]! } }
  stage.value!.setPointerCapture(event.pointerId)
}

function moveStage(event: PointerEvent) {
  const d = drag.value
  if (!d) return
  const p = point(event)
  if (d.type === 'draw') {
    d.x1 = p.x
    d.y1 = p.y
  } else if (d.type === 'move') {
    const r = stage.value!.getBoundingClientRect()
    const dx = p.x - d.px
    const dy = p.y - d.py
    if (!d.moved && Math.hypot(dx * r.width, dy * r.height) < 3) return
    d.moved = true
    setBox(d.index, { ...d.orig, x: clamp(d.orig.x + dx, 0, 1 - d.orig.w), y: clamp(d.orig.y + dy, 0, 1 - d.orig.h) })
  } else {
    // 拉的那个角跟着鼠标走，对角不动
    const o = d.orig
    const fixedX = d.corner === 'tl' || d.corner === 'bl' ? o.x + o.w : o.x
    const fixedY = d.corner === 'tl' || d.corner === 'tr' ? o.y + o.h : o.y
    const rect = normalize(fixedX, fixedY, p.x, p.y)
    if (rect.w >= MIN_SIZE && rect.h >= MIN_SIZE) setBox(d.index, rect)
  }
}

function upStage() {
  const d = drag.value
  drag.value = null
  if (d?.type !== 'draw') return
  const rect = normalize(d.x0, d.y0, d.x1, d.y1)
  const r = stage.value!.getBoundingClientRect()
  if (rect.w * r.width < MIN_PIXELS || rect.h * r.height < MIN_PIXELS) return
  pending.value = rect
}

// 点别处收起（框、角、弹条自己会处理）
useEventListener(document, 'pointerdown', (event) => {
  if (!pending.value && selected.value === null) return
  const target = event.target as Node
  if (pop.value?.contains(target) || stage.value?.contains(target)) return
  closePop()
})
useEventListener(window, 'keydown', (event) => {
  if (event.key === 'Escape' && (pending.value || selected.value !== null)) closePop()
})

function choose(label: string) {
  if (pending.value) {
    emit('update:modelValue', [...props.modelValue, { ...pending.value, label }])
  } else if (selected.value !== null) {
    const index = selected.value
    emit(
      'update:modelValue',
      props.modelValue.map((b, i) => (i === index ? { ...b, label } : b)),
    )
  }
  closePop()
}

function removeSelected() {
  const index = selected.value
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
  closePop()
}

// 换了一张、交对了变只读：没弄完的都清掉
watch(
  () => props.itemId,
  () => {
    ready.value = false
    drag.value = null
    closePop()
  },
)
watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled) return
    drag.value = null
    closePop()
  },
)

// ---------------------------------------------------------------- 弹条放哪

const popRect = computed<Rect | null>(() => {
  if (drag.value) return null
  if (pending.value) return pending.value
  if (selected.value !== null) return props.modelValue[selected.value] ?? null
  return null
})
const popPlace = ref<{ left: number; top: number; below: boolean }>({ left: 0, top: 0, below: false })
watch(
  [popRect, () => props.modelValue],
  async () => {
    const rect = popRect.value
    if (!rect) return
    await nextTick()
    if (!stage.value || !pop.value) return
    const W = stage.value.clientWidth
    const H = stage.value.clientHeight
    const width = pop.value.offsetWidth
    const center = (rect.x + rect.w / 2) * W
    const left = clamp(center - width / 2, 0, Math.max(W - width, 0))
    // 框贴着图的上边，弹条放到框下面，免得挡住页面上方的东西又够不着
    const below = rect.y * H < 56
    popPlace.value = { left, top: below ? (rect.y + rect.h) * H + 8 : rect.y * H - 8, below }
  },
  { flush: 'post' },
)

// ---------------------------------------------------------------- 样子

function pct(v: number) {
  return `${v * 100}%`
}

function rectStyle(rect: Rect) {
  return { left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }
}

/** 大框先画、小框后画，小框压在上面，点得到 */
const order = computed(() => props.modelValue.map((box, index) => ({ box, index })).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h))

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']
</script>

<template>
  <div class="boxPicker" :class="{ compact, disabled }">
    <div
      ref="stage"
      class="stage"
      @pointerdown="downStage"
      @pointermove="moveStage"
      @pointerup="upStage"
      @pointercancel="upStage"
      @load.capture="ready = true"
      @dragstart.prevent
    >
      <LabelingImage :labeling-id="labelingId" :item-id="itemId" />
      <template v-if="ready">
        <div
          v-for="{ box, index } in order"
          :key="index"
          class="box"
          :class="{ on: selected === index }"
          :style="{ ...rectStyle(box), borderColor: labelStroke(labels, box.label) }"
          @pointerdown="downBox(index, $event)"
        >
          <span class="chip" :class="{ inside: box.y < 0.06 }" :style="{ background: labelStroke(labels, box.label) }">{{ box.label }}</span>
          <template v-if="selected === index && !disabled">
            <span
              v-for="c in CORNERS"
              :key="c"
              class="handle"
              :class="c"
              :style="{ borderColor: labelStroke(labels, box.label) }"
              @pointerdown="downHandle(index, c, $event)"
            ></span>
          </template>
        </div>
        <div v-if="drawing" class="box draft" :style="rectStyle(drawing)"></div>
        <div v-if="pending" class="box draft" :style="rectStyle(pending)"></div>
      </template>
      <div
        v-if="popRect && !disabled"
        ref="pop"
        class="pop"
        :class="{ below: popPlace.below }"
        :style="{ left: `${popPlace.left}px`, top: `${popPlace.top}px`, background: theme.popoverColor, borderColor: theme.borderColor }"
        @pointerdown.stop
      >
        <button
          v-for="label in labels"
          :key="label"
          type="button"
          class="pc"
          :class="{ on: selected !== null && modelValue[selected]?.label === label }"
          :style="selected !== null && modelValue[selected]?.label === label ? { borderColor: labelColor(labels, label, isDark).swatch } : undefined"
          @click="choose(label)"
        >
          <span class="swatch" :style="{ background: labelColor(labels, label, isDark).swatch }"></span>{{ label }}
        </button>
        <button v-if="selected !== null" type="button" class="pdel" @click="removeSelected">删掉</button>
        <button v-else type="button" class="pq" @click="closePop">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  border-radius: 6px;
  cursor: crosshair;
  user-select: none;
  touch-action: none;
}

.stage :deep(.labelingImage) {
  height: auto;
  border-radius: 6px;
  pointer-events: none;
}

.disabled .stage {
  cursor: default;
}

.box {
  position: absolute;
  box-sizing: border-box;
  border: 2.5px solid;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.75);
  cursor: move;
}

.disabled .box {
  cursor: default;
}

.box.on {
  background: rgba(255, 255, 255, 0.14);
  /* 点开的框连同四个角压在别的框上面，角落和别的框重叠时也拉得到 */
  z-index: 2;
}

.box.draft {
  border: 2px dashed #ffffff;
  box-shadow:
    0 0 0 1px #1f2225,
    inset 0 0 0 1px #1f2225;
  background: rgba(255, 255, 255, 0.12);
  pointer-events: none;
}

.chip {
  position: absolute;
  left: -2.5px;
  bottom: 100%;
  height: 19px;
  padding: 0 6px;
  font-size: 12px;
  line-height: 19px;
  font-weight: 600;
  color: #ffffff;
  border-radius: 3px 3px 0 0;
  white-space: nowrap;
  pointer-events: none;
}

.chip.inside {
  bottom: auto;
  top: 0;
  left: 0;
  border-radius: 0 0 3px 0;
}

.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  background: #ffffff;
  border: 2px solid;
}

.handle.tl {
  left: -7px;
  top: -7px;
  cursor: nwse-resize;
}

.handle.br {
  right: -7px;
  bottom: -7px;
  cursor: nwse-resize;
}

.handle.tr {
  right: -7px;
  top: -7px;
  cursor: nesw-resize;
}

.handle.bl {
  left: -7px;
  bottom: -7px;
  cursor: nesw-resize;
}

.pop {
  position: absolute;
  z-index: 3;
  transform: translateY(-100%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(20, 24, 30, 0.18);
  white-space: nowrap;
  cursor: default;
}

.pop.below {
  transform: none;
}

.pc {
  height: 36px;
  box-sizing: border-box;
  padding: 0 14px;
  border: 1.5px solid rgba(128, 128, 128, 0.35);
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 15px;
  color: inherit;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.pc:hover {
  background: rgba(128, 128, 128, 0.1);
}

.pc.on {
  border-width: 2px;
  font-weight: 700;
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.pq,
.pdel {
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

.pq {
  color: inherit;
  opacity: 0.65;
}

.pdel {
  color: #d03050;
}

.pq:hover,
.pdel:hover {
  background: rgba(128, 128, 128, 0.1);
}

.compact .pc,
.compact .pq,
.compact .pdel {
  height: 30px;
  font-size: 13px;
}

.compact .pc {
  padding: 0 10px;
}
</style>

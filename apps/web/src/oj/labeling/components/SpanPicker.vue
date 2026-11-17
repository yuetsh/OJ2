<script setup lang="ts">
import type { LabelingSpan } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { labelColor } from '../utils/colors'

/**
 * 实体标注的标法（学生页和后台共用），每个字是一个格子。手机和电脑两套：
 *
 * - 触屏（设计稿 LabelSpanStudent，设计文档 3.5 节第 2 条）：先在上方选类别，再点这个词的第一个字、
 *   最后一个字（一个字的词在同一个字上点两次）；点已经标了的那段就是删掉它。
 *   点了开头字以后只用虚线框表示「等着点结尾」，不加提示文字。
 * - 鼠标（设计稿 LabelSpanDesk，11-17 改）：没有上方的类别按钮。按住拖过去选字，松开后在选中那段上方
 *   弹出类别，点一个就标好；只点一个字也弹。点已经标了的那段，弹同一个条，可以换类别或删掉。
 *   不用浏览器自带的选中文字：两段不能重叠，选区要按字算，自己拖更好管。
 */
const props = withDefaults(defineProps<{ text: string; labels: string[]; modelValue: LabelingSpan[]; disabled?: boolean; compact?: boolean }>(), {
  disabled: false,
  compact: false,
})
const emit = defineEmits<{ 'update:modelValue': [spans: LabelingSpan[]] }>()

const isDark = useDark()
const theme = useThemeVars()
/** 鼠标走拖选；机房电脑都是鼠标，手机平板是触屏 */
const mouse = useMediaQuery('(hover: hover) and (pointer: fine)')

const chars = computed(() => Array.from(props.text))

function spanAt(i: number) {
  return props.modelValue.find((s) => s.start <= i && i < s.end) ?? null
}

function color(label: string) {
  return labelColor(props.labels, label, isDark.value)
}

// ---------------------------------------------------------------- 触屏：先选类别，点首字末字

const active = ref(props.labels[0] ?? '')
const pending = ref<number | null>(null)

watch(
  () => props.labels,
  (labels) => {
    if (!labels.includes(active.value)) active.value = labels[0] ?? ''
  },
)

function tap(i: number) {
  const hit = spanAt(i)
  if (hit) {
    pending.value = null
    emit(
      'update:modelValue',
      props.modelValue.filter((s) => s !== hit),
    )
    return
  }
  if (pending.value === null) {
    pending.value = i
    return
  }
  const start = Math.min(pending.value, i)
  const end = Math.max(pending.value, i) + 1
  // 中间夹着已经标了的段：不能重叠，就当重新点了开头
  if (props.modelValue.some((s) => s.start < end && start < s.end)) {
    pending.value = i
    return
  }
  pending.value = null
  emit('update:modelValue', [...props.modelValue, { start, end, label: active.value }])
}

// ---------------------------------------------------------------- 鼠标：拖着选，松手弹类别

const box = ref<HTMLElement | null>(null)
const pop = ref<HTMLElement | null>(null)

const anchor = ref<number | null>(null)
const dragging = ref(false)
/** 选中还没定类别的那段 */
const selection = ref<{ start: number; end: number } | null>(null)
/** 点开的已标的那段 */
const editing = ref<LabelingSpan | null>(null)
const popOpen = computed(() => !props.disabled && !dragging.value && (selection.value !== null || editing.value !== null))

function closePop() {
  selection.value = null
  editing.value = null
  anchor.value = null
  dragging.value = false
}

/** 从 anchor 拖到 i：碰到已经标了的段就停在它跟前（两段不能重叠） */
function rangeTo(i: number) {
  const a = anchor.value!
  if (i >= a) {
    const wall = Math.min(...props.modelValue.filter((s) => s.start > a).map((s) => s.start), chars.value.length)
    return { start: a, end: Math.min(i + 1, wall) }
  }
  const wall = Math.max(...props.modelValue.filter((s) => s.end <= a).map((s) => s.end), 0)
  return { start: Math.max(i, wall), end: a + 1 }
}

function press(i: number) {
  const hit = spanAt(i)
  if (hit) {
    selection.value = null
    editing.value = hit
    return
  }
  editing.value = null
  anchor.value = i
  selection.value = { start: i, end: i + 1 }
}

function down(i: number, event: PointerEvent) {
  if (props.disabled || !mouse.value || event.button !== 0) return
  // 不让浏览器开始选中文字、也不让按钮抢焦点画框
  event.preventDefault()
  press(i)
  if (selection.value) dragging.value = true
}

function enter(i: number) {
  if (dragging.value && anchor.value !== null) selection.value = rangeTo(i)
}

useEventListener(window, 'pointerup', () => {
  if (dragging.value) dragging.value = false
})
// 点别处收起（点格子由格子自己处理）
useEventListener(document, 'pointerdown', (event) => {
  if (!popOpen.value) return
  const target = event.target as Node
  if (pop.value?.contains(target)) return
  if (box.value?.contains(target) && (target as HTMLElement).closest?.('.ch')) return
  closePop()
})
useEventListener(window, 'keydown', (event) => {
  if (popOpen.value && event.key === 'Escape') closePop()
})

function click(i: number, event: MouseEvent) {
  if (props.disabled) return
  if (!mouse.value) return tap(i)
  // 鼠标点已经在 pointerdown 里处理了；键盘回车（detail 为 0）在这里当成点了一下
  if (event.detail === 0) press(i)
}

function choose(label: string) {
  if (selection.value) {
    emit('update:modelValue', [...props.modelValue, { ...selection.value, label }])
  } else if (editing.value && editing.value.label !== label) {
    const old = editing.value
    emit(
      'update:modelValue',
      props.modelValue.map((s) => (s === old ? { ...s, label } : s)),
    )
  }
  closePop()
}

function removeEditing() {
  const old = editing.value
  emit(
    'update:modelValue',
    props.modelValue.filter((s) => s !== old),
  )
  closePop()
}

// 换了一句（下一条）、交对了变成只读、切到触屏：没点完的都清掉
watch(
  () => props.text,
  () => {
    pending.value = null
    closePop()
  },
)
watch(
  () => props.disabled,
  (disabled) => disabled && closePop(),
)
watch(mouse, () => {
  pending.value = null
  closePop()
})

/** 弹条放在那段上方正中；那段跨了行就对着第一行那部分。左右不出句子框 */
const popPlace = ref({ left: 0, top: 0, tip: 0 })
watch(
  [popOpen, selection, editing],
  async () => {
    if (!popOpen.value) return
    await nextTick()
    const range = selection.value ?? editing.value
    if (!range || !box.value || !pop.value) return
    const cells = box.value.querySelectorAll<HTMLElement>('.ch')
    const first = cells[range.start]
    const last = cells[range.end - 1]
    if (!first || !last) return
    const frame = box.value.getBoundingClientRect()
    const a = first.getBoundingClientRect()
    const b = last.getBoundingClientRect()
    const right = Math.abs(a.top - b.top) < 2 ? b.right : frame.right - 10
    const center = (a.left + right) / 2 - frame.left
    const width = pop.value.offsetWidth
    const left = Math.min(Math.max(center - width / 2, 0), Math.max(frame.width - width, 0))
    popPlace.value = { left, top: a.top - frame.top, tip: Math.min(Math.max(center - left, 14), width - 14) }
  },
  { flush: 'post' },
)

// ---------------------------------------------------------------- 格子的样子

function cellStyle(i: number) {
  const span = spanAt(i)
  if (!span) return undefined
  const c = color(span.label)
  return { background: c.bg, color: c.fg }
}

function inSelection(i: number) {
  const s = selection.value
  return !!s && s.start <= i && i < s.end
}

function cellClass(i: number) {
  const span = spanAt(i)
  const sel = inSelection(i)
  return {
    marked: !!span,
    first: span?.start === i,
    last: span ? span.end === i + 1 : false,
    pending: !mouse.value && pending.value === i,
    sel,
    selFirst: sel && selection.value!.start === i,
    selLast: sel && selection.value!.end === i + 1,
    opened: !!span && span === editing.value && popOpen.value,
  }
}
</script>

<template>
  <div class="spanPicker" :class="{ compact, mouse }">
    <div v-if="!mouse" class="cats">
      <button
        v-for="label in labels"
        :key="label"
        type="button"
        class="cat"
        :class="{ on: label === active }"
        :disabled="disabled"
        :style="label === active ? { borderColor: color(label).swatch } : undefined"
        @click="active = label"
      >
        <span class="swatch" :style="{ background: color(label).swatch }"></span>{{ label }}
      </button>
    </div>
    <div ref="box" class="chars">
      <button
        v-for="(ch, i) in chars"
        :key="i"
        type="button"
        class="ch"
        :class="cellClass(i)"
        :style="cellStyle(i)"
        :disabled="disabled"
        @pointerdown="down(i, $event)"
        @pointerenter="enter(i)"
        @click="click(i, $event)"
      >
        {{ ch === ' ' ? ' ' : ch }}<span v-if="spanAt(i)?.start === i" class="tag" :style="{ color: color(spanAt(i)!.label).tag }">{{ spanAt(i)!.label }}</span>
      </button>
      <div
        v-if="popOpen"
        ref="pop"
        class="pop"
        :style="{
          left: `${popPlace.left}px`,
          top: `${popPlace.top}px`,
          '--tip': `${popPlace.tip}px`,
          background: theme.popoverColor,
          borderColor: theme.borderColor,
        }"
      >
        <button
          v-for="label in labels"
          :key="label"
          type="button"
          class="pc"
          :class="{ on: editing?.label === label }"
          :style="editing?.label === label ? { borderColor: color(label).swatch } : undefined"
          @click="choose(label)"
        >
          <span class="swatch" :style="{ background: color(label).swatch }"></span>{{ label }}
        </button>
        <button v-if="editing" type="button" class="pdel" @click="removeEditing">删掉</button>
        <button v-else type="button" class="pq" @click="closePop">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.spanPicker {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.cat {
  flex: 1 1 0;
  min-width: 72px;
  height: 44px;
  box-sizing: border-box;
  border: 1.5px solid rgba(128, 128, 128, 0.35);
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 16px;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
}

.cat.on {
  border-width: 2px;
  font-weight: 700;
  background: rgba(128, 128, 128, 0.08);
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.chars {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  row-gap: 6px;
  padding: 14px 10px 10px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 10px;
}

.ch {
  position: relative;
  width: 34px;
  height: 46px;
  box-sizing: border-box;
  padding: 6px 0 0;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 21px;
  line-height: 24px;
  color: inherit;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.mouse .ch {
  cursor: text;
}

.mouse .ch.marked {
  cursor: pointer;
}

.ch:disabled {
  cursor: default;
}

.ch.first {
  border-top-left-radius: 5px;
  border-bottom-left-radius: 5px;
}

.ch.last {
  border-top-right-radius: 5px;
  border-bottom-right-radius: 5px;
}

.ch.pending {
  outline: 2px dashed #2f6fd6;
  outline-offset: -2px;
  border-radius: 5px;
}

/* 拖选中：灰底加蓝框（浅蓝是「人名」那类的底色，不能拿来表示选中） */
.ch.sel {
  background: rgba(128, 128, 128, 0.14);
  box-shadow:
    inset 0 2px 0 #2f6fd6,
    inset 0 -2px 0 #2f6fd6;
}

.ch.sel.selFirst {
  border-top-left-radius: 5px;
  border-bottom-left-radius: 5px;
  box-shadow:
    inset 0 2px 0 #2f6fd6,
    inset 0 -2px 0 #2f6fd6,
    inset 2px 0 0 #2f6fd6;
}

.ch.sel.selLast {
  border-top-right-radius: 5px;
  border-bottom-right-radius: 5px;
  box-shadow:
    inset 0 2px 0 #2f6fd6,
    inset 0 -2px 0 #2f6fd6,
    inset -2px 0 0 #2f6fd6;
}

.ch.sel.selFirst.selLast {
  box-shadow: inset 0 0 0 2px #2f6fd6;
}

/* 点开的已标那段：和拖选一样，整段一个框 */
.ch.opened {
  box-shadow:
    inset 0 2px 0 #2f6fd6,
    inset 0 -2px 0 #2f6fd6;
}

.ch.opened.first {
  box-shadow:
    inset 0 2px 0 #2f6fd6,
    inset 0 -2px 0 #2f6fd6,
    inset 2px 0 0 #2f6fd6;
}

.ch.opened.last {
  box-shadow:
    inset 0 2px 0 #2f6fd6,
    inset 0 -2px 0 #2f6fd6,
    inset -2px 0 0 #2f6fd6;
}

.ch.opened.first.last {
  box-shadow: inset 0 0 0 2px #2f6fd6;
}

.tag {
  position: absolute;
  left: 3px;
  bottom: 1px;
  font-size: 10px;
  line-height: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

.pop {
  position: absolute;
  z-index: 2;
  transform: translateY(calc(-100% - 8px));
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(20, 24, 30, 0.16);
  white-space: nowrap;
}

.pop::after {
  content: '';
  position: absolute;
  left: calc(var(--tip) - 5px);
  bottom: -6px;
  width: 10px;
  height: 10px;
  background: inherit;
  border-right: 1px solid;
  border-bottom: 1px solid;
  border-color: inherit;
  transform: rotate(45deg);
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

.compact .cat {
  flex: 0 0 auto;
  height: 30px;
  padding: 0 12px;
  font-size: 13px;
}

.compact .ch {
  width: 28px;
  height: 36px;
  padding-top: 4px;
  font-size: 17px;
  line-height: 22px;
}

.compact .tag {
  font-size: 9px;
  line-height: 10px;
}

.compact .chars {
  padding: 8px;
  row-gap: 4px;
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

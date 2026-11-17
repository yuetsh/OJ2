<script setup lang="ts">
import type { LabelingSpan } from '@oj2/contract'
import { labelColor } from '../utils/colors'

/**
 * 实体标注的点选（学生页和后台共用，设计文档 3.5 节第 2 条）：每个字是一个格子。
 * 先在上方选类别，再点这个词的第一个字、最后一个字（一个字的词在同一个字上点两次）；
 * 点已经标了的那段就是删掉它。点了开头字以后只用虚线框表示「等着点结尾」，不加提示文字。
 */
const props = withDefaults(defineProps<{ text: string; labels: string[]; modelValue: LabelingSpan[]; disabled?: boolean; compact?: boolean }>(), {
  disabled: false,
  compact: false,
})
const emit = defineEmits<{ 'update:modelValue': [spans: LabelingSpan[]] }>()

const isDark = useDark()
const active = ref(props.labels[0] ?? '')
const pending = ref<number | null>(null)

watch(
  () => props.labels,
  (labels) => {
    if (!labels.includes(active.value)) active.value = labels[0] ?? ''
  },
)
// 换了一句（下一条）就清掉没点完的开头
watch(
  () => props.text,
  () => (pending.value = null),
)

const chars = computed(() => Array.from(props.text))

function spanAt(i: number) {
  return props.modelValue.find((s) => s.start <= i && i < s.end) ?? null
}

function click(i: number) {
  if (props.disabled) return
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

function cellStyle(i: number) {
  const span = spanAt(i)
  if (!span) return undefined
  const color = labelColor(props.labels, span.label, isDark.value)
  return { background: color.bg, color: color.fg }
}

function cellClass(i: number) {
  const span = spanAt(i)
  return {
    marked: !!span,
    first: span?.start === i,
    last: span ? span.end === i + 1 : false,
    pending: pending.value === i,
  }
}
</script>

<template>
  <div class="spanPicker" :class="{ compact }">
    <div class="cats">
      <button
        v-for="label in labels"
        :key="label"
        type="button"
        class="cat"
        :class="{ on: label === active }"
        :disabled="disabled"
        :style="label === active ? { borderColor: labelColor(labels, label, isDark).swatch } : undefined"
        @click="active = label"
      >
        <span class="swatch" :style="{ background: labelColor(labels, label, isDark).swatch }"></span>{{ label }}
      </button>
    </div>
    <div class="chars">
      <button v-for="(ch, i) in chars" :key="i" type="button" class="ch" :class="cellClass(i)" :style="cellStyle(i)" :disabled="disabled" @click="click(i)">
        {{ ch === ' ' ? ' ' : ch
        }}<span v-if="spanAt(i)?.start === i" class="tag" :style="{ color: labelColor(labels, spanAt(i)!.label, isDark).tag }">{{ spanAt(i)!.label }}</span>
      </button>
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
  -webkit-tap-highlight-color: transparent;
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
</style>

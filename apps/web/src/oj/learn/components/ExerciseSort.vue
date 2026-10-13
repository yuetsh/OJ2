<script setup lang="ts">
import ExerciseResult from "./ExerciseResult.vue"
import type { Exercise, ExerciseSortData } from "utils/types"
import { shuffle } from "../composables/useShuffle"
import { highlightLines } from "shared/highlight"
import { useBreakpoints } from "shared/composables/breakpoints"
import { hangStyle } from "shared/extensions/hangIndent"

const props = defineProps<{ exercise: Exercise; lang?: string }>()
const emit = defineEmits<{
  attempt: [payload: { correct: boolean; answer?: string }]
}>()

const data = computed(() => props.exercise.data as ExerciseSortData)
const { isDesktop } = useBreakpoints()

type LineItem = { originalIdx: number; text: string }

const lines = ref<LineItem[]>([])
const submitted = ref(false)

function init() {
  const shuffled = shuffle(data.value.lines.map((text, idx) => ({ originalIdx: idx, text })))
  // 打乱后若恰好与原顺序一致，交换前两项，避免一进入就是已解出状态
  const isCorrect = shuffled.every((item, i) => item.originalIdx === i)
  if (isCorrect && shuffled.length > 1) {
    ;[shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]]
  }
  lines.value = shuffled
  pickedIdx.value = null
  submitted.value = false
}

onMounted(init)
watch(() => props.exercise.id, init)

const dragIdx = ref<number | null>(null)
// 手机上没有 HTML5 拖放（触屏不触发 dragstart），所以再给一条点选的路：先点一行、再点它该去的位置
const pickedIdx = ref<number | null>(null)

function onDragStart(idx: number) {
  dragIdx.value = idx
  pickedIdx.value = null
}

function moveLine(from: number, to: number) {
  if (from === to) return
  const newLines = [...lines.value]
  const [moved] = newLines.splice(from, 1)
  newLines.splice(to, 0, moved)
  lines.value = newLines
  submitted.value = false
}

function onDrop(targetIdx: number) {
  if (dragIdx.value === null) return
  moveLine(dragIdx.value, targetIdx)
  dragIdx.value = null
}

function onLineClick(idx: number) {
  if (submitted.value && allCorrect.value) return
  if (pickedIdx.value === null) {
    pickedIdx.value = idx
    return
  }
  moveLine(pickedIdx.value, idx)
  pickedIdx.value = null
}

function lineStatus(idx: number): "correct" | "wrong" | "default" {
  if (!submitted.value) return "default"
  return lines.value[idx].originalIdx === idx ? "correct" : "wrong"
}

const allCorrect = computed(() => lines.value.every((item, i) => item.originalIdx === i))

function submit() {
  submitted.value = true
  emit("attempt", {
    correct: allCorrect.value,
    // 报的是「他把原文第几行排在了第几位」，老师对着题面就能看出错在哪
    answer: `顺序 ${lines.value.map((item) => item.originalIdx + 1).join("-")}`,
  })
}

function reset() {
  init()
}

const lineHtml = computed<string[]>(() => highlightLines(data.value.lines, props.lang))
</script>

<template>
  <div>
    <p :style="{ fontWeight: 500, fontSize: '16px', marginBottom: isDesktop ? '12px' : '8px' }">
      {{ data.question }}
    </p>
    <p v-if="!isDesktop" style="color: var(--learn-muted); font-size: 13px; margin: 0 0 12px">
      先点一行，再点它该去的位置。
    </p>

    <n-space vertical :size="6">
      <div
        v-for="(line, idx) in lines"
        :key="line.originalIdx"
        draggable="true"
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 12px',
          borderRadius: '6px',
          border:
            pickedIdx === idx
              ? '2px solid #2080f0'
              : `1.5px ${submitted ? 'solid' : 'dashed'} ${
                  lineStatus(idx) === 'correct'
                    ? '#18a058'
                    : lineStatus(idx) === 'wrong'
                      ? '#d03050'
                      : 'var(--learn-control-line)'
                }`,
          background:
            pickedIdx === idx
              ? 'rgba(32,128,240,0.08)'
              : lineStatus(idx) === 'correct'
                ? 'rgba(24,160,88,0.08)'
                : lineStatus(idx) === 'wrong'
                  ? 'rgba(208,48,80,0.07)'
                  : 'transparent',
          cursor: 'grab',
          fontFamily: 'var(--learn-code-font)',
          userSelect: 'none',
        }"
        @dragstart="onDragStart(idx)"
        @dragover.prevent
        @drop="onDrop(idx)"
        @click="onLineClick(idx)"
      >
        <span style="color: #bbb; cursor: grab">⠿</span>
        <span
          v-html="lineHtml[line.originalIdx]"
          :style="{ minWidth: 0, ...hangStyle(line.text) }"
        />
      </div>
    </n-space>

    <ExerciseResult
      v-if="submitted"
      :type="allCorrect ? 'success' : 'error'"
      :title="allCorrect ? '顺序正确！' : '顺序有误，红色行需要调整'"
    />

    <n-space style="margin-top: 12px" :size="8">
      <n-button type="primary" :disabled="submitted && allCorrect" @click="submit"> 提交 </n-button>
      <n-button @click="reset">重置</n-button>
    </n-space>
  </div>
</template>

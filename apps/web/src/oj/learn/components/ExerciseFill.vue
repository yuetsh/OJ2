<script setup lang="ts">
import ExerciseResult from "./ExerciseResult.vue"
import type { Exercise, ExerciseFillData } from "utils/types"
import { highlightWithHoles } from "shared/highlight"

const props = defineProps<{ exercise: Exercise; lang?: string }>()
const emit = defineEmits<{
  attempt: [payload: { correct: boolean; answer?: string }]
}>()

const data = computed(() => props.exercise.data as ExerciseFillData)

type CodeSeg = { type: "code"; html: string }
type BlankSeg = { type: "blank"; answers: string[]; index: number }
type Segment = CodeSeg | BlankSeg

const segments = computed<Segment[]>(() => {
  // 空里先填上第一个答案再解析，免得空把语法搅乱；答案本身不输出，见 highlightWithHoles
  const blanks: string[][] = []
  const holes: { from: number; to: number }[] = []
  let code = ""
  let last = 0
  for (const m of data.value.code.matchAll(/\{\{([^}]+)\}\}/g)) {
    const answers = m[1].split("|")
    code += data.value.code.slice(last, m.index)
    holes.push({ from: code.length, to: code.length + answers[0].length })
    code += answers[0]
    blanks.push(answers)
    last = m.index + m[0].length
  }
  code += data.value.code.slice(last)

  return highlightWithHoles(code, holes, props.lang).map((part) =>
    typeof part === "string"
      ? { type: "code", html: part }
      : { type: "blank", answers: blanks[part], index: part },
  )
})

const blankCount = computed(() => segments.value.filter((s) => s.type === "blank").length)
const userInputs = ref<string[]>([])
const wrongBlanks = ref<Set<number>>(new Set())
const allCorrect = ref(false)

watch(() => props.exercise.id, reset, { immediate: true })

function reset() {
  userInputs.value = Array(blankCount.value).fill("")
  wrongBlanks.value = new Set()
  allCorrect.value = false
}

function submit() {
  if (allCorrect.value) return
  const wrong = new Set<number>()
  for (const seg of segments.value) {
    if (seg.type !== "blank") continue
    if (!seg.answers.includes(userInputs.value[seg.index]?.trim() ?? "")) {
      wrong.add(seg.index)
    }
  }
  wrongBlanks.value = wrong
  allCorrect.value = wrong.size === 0
  emit("attempt", {
    correct: allCorrect.value,
    answer: `填了 ${userInputs.value.map((v) => v.trim() || "（空）").join(" | ")}`,
  })
}

function inputWidth(idx: number): string {
  return Math.max(4, (userInputs.value[idx]?.length ?? 0) + 2) + "ch"
}
</script>

<template>
  <div>
    <p style="font-weight: 500; font-size: 16px; margin-bottom: 12px">
      {{ data.question }}
    </p>

    <pre
      :style="{
        fontFamily: 'var(--learn-code-font)',
        fontSize: '16px',
        lineHeight: '1.6',
        background: 'var(--learn-soft)',
        border: '1px solid var(--learn-line)',
        borderRadius: '6px',
        padding: '12px',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        margin: 0,
      }"
    ><template v-for="(seg, i) in segments" :key="i"
      ><span v-if="seg.type === 'code'" v-html="seg.html" /><input
        v-else
        :value="userInputs[seg.index]"
        :disabled="allCorrect"
        autocapitalize="off"
        autocorrect="off"
        autocomplete="off"
        spellcheck="false"
        :style="{
          width: inputWidth(seg.index),
          fontFamily: 'var(--learn-code-font)',
          fontSize: '16px',
          padding: '0 6px',
          borderRadius: '3px',
          border: `1.5px solid ${
            allCorrect
              ? '#18a058'
              : wrongBlanks.has(seg.index)
                ? '#d03050'
                : 'var(--learn-control-line)'
          }`,
          background: allCorrect
            ? 'rgba(24,160,88,0.08)'
            : wrongBlanks.has(seg.index)
              ? 'rgba(208,48,80,0.07)'
              : 'transparent',
          outline: 'none',
          color: 'inherit',
          minWidth: '4ch',
        }"
        @input="userInputs[seg.index] = ($event.target as HTMLInputElement).value"
      /></template></pre>

    <ExerciseResult
      v-if="wrongBlanks.size > 0 || allCorrect"
      :type="allCorrect ? 'success' : 'error'"
      :title="allCorrect ? '全部正确！' : '有填写错误，请检查红色标注的空位'"
      style="margin-top: 12px"
    />

    <n-space style="margin-top: 12px" :size="8">
      <n-button type="primary" :disabled="allCorrect" @click="submit"> 提交 </n-button>
      <n-button @click="reset">重置</n-button>
    </n-space>
  </div>
</template>

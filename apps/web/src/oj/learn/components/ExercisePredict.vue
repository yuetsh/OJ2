<script setup lang="ts">
import type { Exercise, ExercisePredictData } from "utils/types"
import { highlight } from "../composables/useCodeHighlight"
import "./exercise-highlight.css"

const props = defineProps<{ exercise: Exercise; lang?: string }>()
const emit = defineEmits<{
  attempt: [payload: { correct: boolean; answer?: string }]
}>()

const data = computed(() => props.exercise.data as ExercisePredictData)

const codeHtml = computed(() => highlight(data.value.code, props.lang))

const userInput = ref("")
const submitted = ref(false)

watch(() => props.exercise.id, reset, { immediate: true })

function normalize(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
}

const allCorrect = computed(() =>
  data.value.answer.some((a) => normalize(a) === normalize(userInput.value)),
)

// 改了答案就把上一次的判定收回去，等他重新点提交 —— 排序/连线/找错/分组四种题
// 本来就是这么做的（各自的交互处都会把 submitted 置回 false），只有这里漏了。
// 不收回的话，`allCorrect` 是跟着输入实时算的，学生错一次之后把答案改对，
// 界面直接跳成「输出正确！」、提交按钮同时禁用 —— submit() 再也不会执行，
// 于是这道题**永远不会被记成做对**（留痕里他就一直卡在那次错的上面）。
watch(userInput, () => {
  submitted.value = false
})

function submit() {
  submitted.value = true
  emit("attempt", {
    correct: allCorrect.value,
    answer: `答「${userInput.value.replace(/\n/g, "⏎")}」`,
  })
}

function reset() {
  userInput.value = ""
  submitted.value = false
}
</script>

<template>
  <n-card style="margin: 16px 0; border: 1.5px solid var(--n-border-color)">
    <template #header>
      <n-tag type="error" :bordered="false">练一练 · 输出预测</n-tag>
    </template>

    <p style="font-weight: 500; font-size: 16px; margin-bottom: 12px">
      {{ data.question }}
    </p>

    <pre
      :style="{
        fontFamily: 'Monaco',
        fontSize: '16px',
        lineHeight: '1.6',
        background: 'var(--n-color)',
        border: '1px solid var(--n-border-color)',
        borderRadius: '6px',
        padding: '12px',
        overflowX: 'auto',
        margin: 0,
      }"
    ><code v-html="codeHtml" /></pre>

    <p style="font-weight: 500; margin: 14px 0 8px">这段代码会输出什么？</p>
    <n-input
      v-model:value="userInput"
      type="textarea"
      :rows="3"
      :disabled="submitted && allCorrect"
      placeholder="在这里输入程序会打印的内容"
      style="font-family: Monaco"
    />

    <n-alert
      v-if="submitted"
      :type="allCorrect ? 'success' : 'error'"
      :title="allCorrect ? '输出正确！' : '输出不正确，再读读代码看看'"
      style="margin-top: 12px"
    />

    <n-space style="margin-top: 12px" :size="8">
      <n-button
        type="error"
        :disabled="submitted && allCorrect"
        @click="submit"
      >
        提交
      </n-button>
      <n-button @click="reset">重置</n-button>
    </n-space>
  </n-card>
</template>

<script setup lang="ts">
import ExerciseResult from './ExerciseResult.vue'
import type { Exercise, ExerciseMcqData } from 'utils/types'

const props = defineProps<{ exercise: Exercise }>()
const emit = defineEmits<{
  attempt: [payload: { correct: boolean; answer?: string }]
}>()

const data = computed(() => props.exercise.data as ExerciseMcqData)
const isSingle = computed(() => data.value.answer.length === 1)
// 选项都不长就排两列，省一半高度；有一条长的就一条一行，免得折成两三行
const twoColumns = computed(() => data.value.options.every((opt) => opt.length <= 16))

const selected = ref<Set<number>>(new Set())
const correct = ref(false)
const wrong = ref(false)
const partial = ref(false)

function select(idx: number) {
  if (correct.value) return
  const s = new Set(selected.value)
  if (isSingle.value) {
    s.clear()
    if (!selected.value.has(idx)) s.add(idx)
  } else {
    if (s.has(idx)) s.delete(idx)
    else s.add(idx)
  }
  selected.value = s
  wrong.value = false
  partial.value = false
}

function submit() {
  if (selected.value.size === 0 || correct.value) return
  const answer = new Set(data.value.answer)
  const sel = selected.value
  const isEqual = sel.size === answer.size && [...sel].every((v) => answer.has(v))
  emit('attempt', { correct: isEqual, answer: describe(sel) })
  if (isEqual) {
    correct.value = true
    wrong.value = false
    partial.value = false
  } else {
    selected.value = new Set()
    const hasIntersection = [...sel].some((v) => answer.has(v))
    if (hasIntersection) {
      partial.value = true
      wrong.value = false
    } else {
      wrong.value = true
      partial.value = false
    }
  }
}

/** 给老师看的一句人话：选项按 A/B/C 报，报下标没人看得懂 */
function describe(sel: Set<number>) {
  return `选了 ${[...sel]
    .sort((a, b) => a - b)
    .map((i) => String.fromCharCode(65 + i))
    .join('、')}`
}

function reset() {
  selected.value = new Set()
  correct.value = false
  wrong.value = false
  partial.value = false
}

function optionType(idx: number): 'default' | 'primary' | 'success' {
  if (correct.value && data.value.answer.includes(idx)) return 'success'
  if (selected.value.has(idx)) return 'primary'
  return 'default'
}
</script>

<template>
  <div>
    <p class="question">
      {{ data.question }}
    </p>

    <div class="opts" :class="{ wide: twoColumns }">
      <button v-for="(opt, idx) in data.options" :key="idx" type="button" class="opt" :class="optionType(idx)" @click="select(idx)">
        <span class="key">{{ String.fromCharCode(65 + idx) }}</span>
        <span>{{ opt }}</span>
      </button>
    </div>

    <ExerciseResult
      v-if="correct || wrong || partial"
      :type="correct ? 'success' : partial ? 'warning' : 'error'"
      :title="correct ? '正确！' : partial ? '部分正确，请重试' : '选择有误，请重试'"
    />

    <n-space style="margin-top: 12px" :size="8">
      <n-button type="primary" :disabled="selected.size === 0 || correct" @click="submit"> 提交 </n-button>
      <n-button @click="reset">重置</n-button>
    </n-space>
  </div>
</template>

<style scoped>
.question {
  font-weight: 600;
  font-size: 15px;
  line-height: 1.6;
  margin: 0 0 12px;
}
.opts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}
.opts.wide {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (max-width: 768px) {
  .opts.wide {
    grid-template-columns: minmax(0, 1fr);
  }
}
.opt {
  min-height: 40px;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.opt:hover {
  border-color: #18a058;
}
.key {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  box-sizing: border-box;
  border-radius: 11px;
  border: 1.5px solid rgba(128, 128, 128, 0.5);
  display: grid;
  place-items: center;
  font-size: 12px;
  opacity: 0.85;
}
.opt.primary {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.08);
}
.opt.primary .key,
.opt.success .key {
  border-color: #18a058;
  background: #18a058;
  color: #fff;
  opacity: 1;
}
.opt.success {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.12);
}
</style>

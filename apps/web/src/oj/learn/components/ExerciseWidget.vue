<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { Exercise, ExerciseMcqData } from 'utils/types'
import { reportExerciseAttempt } from 'oj/api'
import { useUserStore } from 'shared/store/user'

const ExerciseMcq = defineAsyncComponent(() => import('./ExerciseMcq.vue'))
const ExerciseSort = defineAsyncComponent(() => import('./ExerciseSort.vue'))
const ExerciseFill = defineAsyncComponent(() => import('./ExerciseFill.vue'))
const ExerciseMatch = defineAsyncComponent(() => import('./ExerciseMatch.vue'))
const ExercisePredict = defineAsyncComponent(() => import('./ExercisePredict.vue'))
const ExerciseDebug = defineAsyncComponent(() => import('./ExerciseDebug.vue'))
const ExerciseGroup = defineAsyncComponent(() => import('./ExerciseGroup.vue'))

const props = defineProps<{
  exercise: Exercise
  lang?: string
  /** 这一课的第几道、一共几道 */
  index: number
  total: number
  /** 做对过（以前做对的，或者刚才做对的） */
  solved: boolean
}>()
const emit = defineEmits<{ solved: [exerciseId: number] }>()

const userStore = useUserStore()

const KIND: Record<string, string> = {
  sort: '代码排序',
  fill: '代码填空',
  match: '连线匹配',
  predict: '输出预测',
  debug: '代码找错',
  group: '归类分组',
}

const kind = computed(() => {
  if (props.exercise.type !== 'mcq') return KIND[props.exercise.type] ?? '练习'
  return (props.exercise.data as ExerciseMcqData).answer.length === 1 ? '单选题' : '多选题'
})

/**
 * 七种题型各自判完对错后都往上抛 attempt，留痕只在这里做一次 ——
 * 每个题型组件里各写一遍上报，早晚会漏掉一两个。
 *
 * 两道闸：做对之后不再上报（后端也冻结，这里省一次请求）；同一份答案连点两次不算
 * 两次（排序题、连线题的「提交」按钮点完不会禁用，一个字没动再点一下不是新的尝试）。
 */
let solved = false
let lastAnswer: string | null = null

// 教程页里 v-for 的 key 是段落序号，换课时组件实例会被复用 —— 不跟着题目 id 重置的话，
// 上一课做对的状态会把这一课的第一次作答吃掉
watch(
  () => props.exercise.id,
  () => {
    solved = false
    lastAnswer = null
  },
)

function onAttempt(payload: { correct: boolean; answer?: string }) {
  // 做对了就告诉页面（目录、大纲、课末的进度跟着变），没登录也算 —— 只是不留痕
  if (payload.correct) emit('solved', props.exercise.id)
  if (!userStore.isAuthed || solved) return
  const answer = payload.answer ?? ''
  if (answer === lastAnswer) return
  lastAnswer = answer
  if (payload.correct) solved = true
  reportExerciseAttempt(props.exercise.id, payload)
}
</script>

<template>
  <section class="exercise" :id="`exercise-${exercise.id}`">
    <header class="head">
      <span class="tag">练一练</span>
      <span class="kind">{{ kind }}</span>
      <span class="grow" />
      <span v-if="solved" class="done"><Icon icon="ph:check-bold" :width="13" />做对过</span>
      <span class="num">第 {{ index }} 道 · 共 {{ total }} 道</span>
    </header>
    <ExerciseMcq v-if="exercise.type === 'mcq'" :exercise="exercise" @attempt="onAttempt" />
    <ExerciseSort v-else-if="exercise.type === 'sort'" :exercise="exercise" :lang="lang" @attempt="onAttempt" />
    <ExerciseFill v-else-if="exercise.type === 'fill'" :exercise="exercise" :lang="lang" @attempt="onAttempt" />
    <ExerciseMatch v-else-if="exercise.type === 'match'" :exercise="exercise" @attempt="onAttempt" />
    <ExercisePredict v-else-if="exercise.type === 'predict'" :exercise="exercise" :lang="lang" @attempt="onAttempt" />
    <ExerciseDebug v-else-if="exercise.type === 'debug'" :exercise="exercise" :lang="lang" @attempt="onAttempt" />
    <ExerciseGroup v-else-if="exercise.type === 'group'" :exercise="exercise" @attempt="onAttempt" />
  </section>
</template>

<style scoped>
.exercise {
  margin: 0 0 18px;
  padding: 16px 18px;
  border: 1px solid var(--learn-line);
  border-radius: 8px;
  scroll-margin-top: 16px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}
.tag {
  height: 22px;
  padding: 0 8px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--learn-green-bg);
  color: var(--learn-green-text);
}
.kind {
  opacity: 0.6;
}
.grow {
  flex: 1;
}
.done {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: #18a058;
  font-size: 12px;
  font-weight: 600;
}
.num {
  font-size: 12px;
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}
</style>

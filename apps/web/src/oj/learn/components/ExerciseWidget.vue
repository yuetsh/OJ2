<script setup lang="ts">
import type { Exercise } from "utils/types"
import { reportExerciseAttempt } from "oj/api"
import { useUserStore } from "shared/store/user"

const ExerciseMcq = defineAsyncComponent(() => import("./ExerciseMcq.vue"))
const ExerciseSort = defineAsyncComponent(() => import("./ExerciseSort.vue"))
const ExerciseFill = defineAsyncComponent(() => import("./ExerciseFill.vue"))
const ExerciseMatch = defineAsyncComponent(() => import("./ExerciseMatch.vue"))
const ExercisePredict = defineAsyncComponent(
  () => import("./ExercisePredict.vue"),
)
const ExerciseDebug = defineAsyncComponent(() => import("./ExerciseDebug.vue"))
const ExerciseGroup = defineAsyncComponent(() => import("./ExerciseGroup.vue"))

const props = defineProps<{ exercise: Exercise; lang?: string }>()

const userStore = useUserStore()

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
  if (!userStore.isAuthed || solved) return
  const answer = payload.answer ?? ""
  if (answer === lastAnswer) return
  lastAnswer = answer
  if (payload.correct) solved = true
  reportExerciseAttempt(props.exercise.id, payload)
}
</script>

<template>
  <ExerciseMcq
    v-if="exercise.type === 'mcq'"
    :exercise="exercise"
    @attempt="onAttempt"
  />
  <ExerciseSort
    v-else-if="exercise.type === 'sort'"
    :exercise="exercise"
    :lang="lang"
    @attempt="onAttempt"
  />
  <ExerciseFill
    v-else-if="exercise.type === 'fill'"
    :exercise="exercise"
    :lang="lang"
    @attempt="onAttempt"
  />
  <ExerciseMatch
    v-else-if="exercise.type === 'match'"
    :exercise="exercise"
    @attempt="onAttempt"
  />
  <ExercisePredict
    v-else-if="exercise.type === 'predict'"
    :exercise="exercise"
    :lang="lang"
    @attempt="onAttempt"
  />
  <ExerciseDebug
    v-else-if="exercise.type === 'debug'"
    :exercise="exercise"
    :lang="lang"
    @attempt="onAttempt"
  />
  <ExerciseGroup
    v-else-if="exercise.type === 'group'"
    :exercise="exercise"
    @attempt="onAttempt"
  />
</template>

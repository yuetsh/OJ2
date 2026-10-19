<script setup lang="ts">
import type { LessonLanguage } from "@oj2/contract"
import { setClassLesson } from "oj/api"
import { errorMessage } from "utils/api"
import { LANGUAGE_SHOW_VALUE } from "utils/constants"
import type { ClassBoard } from "utils/types"

/**
 * 看板上布置「这节课的题」：题号是上课时当场填的。两种样子 ——
 * - `inline`：顶上一行里点「改 / 布置」展开的那一小条；
 * - `start`：刚上课还没有题时，这页最大的那个框。
 */
const props = defineProps<{
  board: ClassBoard
  className: string
  variant: "inline" | "start"
}>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const message = useMessage()

/**
 * 这份作业用什么语言做，跟着这一次布置走（用户定的：不是给班级定死的设置）。默认是这个班
 * 上一次布置时选的；选了之后看板和学生那边的「做完」都只认这个语言交对的
 */
const lessonLanguage = ref<LessonLanguage>("Python")
const LESSON_LANGUAGES: LessonLanguage[] = ["Python", "C", "C++", "SQL"]
const languageOptions = LESSON_LANGUAGES.map((value) => ({
  label: LANGUAGE_SHOW_VALUE[value],
  value,
}))
const lessonInput = ref("")
const saving = ref(false)

function resetLessonInput() {
  lessonInput.value =
    props.board.source === "teacher"
      ? props.board.problems.map((problem) => problem.problemDisplayId).join(" ")
      : ""
  lessonLanguage.value = props.board.language ?? props.board.lastLanguage ?? "Python"
}

resetLessonInput()
// 推断出来的题也带进框里，老师多半只是确认一下
if (props.variant === "inline" && !lessonInput.value && props.board.problems.length) {
  lessonInput.value = props.board.problems.map((problem) => problem.problemDisplayId).join(" ")
}
// 换了班要把输入框换成那个班今天布置的题、布置时选的语言（15 秒一次的刷新不动它们）
watch(() => [props.board.className, props.board.source] as const, resetLessonInput)

async function saveLesson() {
  const ids = lessonInput.value.split(/[\s,，、;；]+/).filter(Boolean)
  saving.value = true
  try {
    await setClassLesson(props.className, ids, ids.length ? lessonLanguage.value : null)
    message.success(ids.length ? "已布置，学生首页会显示这几道题" : "已清掉")
    emit("saved")
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="variant === 'inline'">
    <n-select
      v-model:value="lessonLanguage"
      :options="languageOptions"
      aria-label="用什么语言做"
      class="lang-select"
    />
    <n-input
      v-model:value="lessonInput"
      placeholder="这节课的题号，用空格隔开"
      clearable
      autofocus
      @keyup.enter="saveLesson"
    />
    <n-button type="primary" :loading="saving" @click="saveLesson">布置</n-button>
    <n-button @click="emit('cancel')">取消</n-button>
  </div>
  <div v-else>
    <n-select
      v-model:value="lessonLanguage"
      :options="languageOptions"
      aria-label="用什么语言做"
      size="large"
      class="lang-select"
    />
    <n-input
      v-model:value="lessonInput"
      size="large"
      placeholder="输入题号，用空格隔开"
      class="start-input"
      @keyup.enter="saveLesson"
    />
    <n-button type="primary" size="large" :loading="saving" @click="saveLesson">布置</n-button>
  </div>
</template>

<style scoped>
.lang-select {
  width: 110px;
  flex-shrink: 0;
}

.start-input {
  flex: 1 1 0;
  font-size: 18px;
}

@media (max-width: 768px) {
  .start-input {
    flex-basis: 100%;
    order: -1;
  }
}
</style>

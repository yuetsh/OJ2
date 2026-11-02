<script setup lang="ts">
import { LESSON_MODE_LABEL, lessonNeeds, type LessonLanguage, type LessonMode } from '@oj2/contract'
import { setClassLesson } from 'oj/api'
import { errorMessage } from 'utils/api'
import { LANGUAGE_SHOW_VALUE } from 'utils/constants'
import type { ClassBoard } from 'utils/types'
import { Icon } from '@iconify/vue'
import ProblemPicker from './ProblemPicker.vue'

/**
 * 看板上布置「这节课的题」：题号是上课时当场填的。两种样子 ——
 * - `inline`：顶上一行里点「改 / 新的一节 / 布置」展开的那一小条；
 * - `start`：刚上课还没有题时，这页最大的那个框。
 *
 * 一个班一天可以上几节内容不同的课：`lessonId` 是要改的那一节，null = 今天新开一节。
 * `carry`：新开的这一节带上这一节的题、改成写代码 —— 先布置画流程图、再让全班写代码时用
 */
const props = defineProps<{
  board: ClassBoard
  className: string
  variant: 'inline' | 'start'
  lessonId: number | null
  carry?: boolean
}>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const message = useMessage()

/**
 * 这份作业用什么语言做，跟着这一次布置走（用户定的：不是给班级定死的设置）。默认是这个班
 * 上一次布置时选的；选了之后看板和学生那边的「做完」都只认这个语言交对的
 */
const lessonLanguage = ref<LessonLanguage>('Python')
const LESSON_LANGUAGES: LessonLanguage[] = ['Python', 'C', 'C++', 'SQL']
const languageOptions = LESSON_LANGUAGES.map((value) => ({
  label: LANGUAGE_SHOW_VALUE[value],
  value,
}))
/**
 * 这节课做什么：写代码 / 先画再写 / 画流程图。画流程图不用选语言（下拉藏起来，存成 null），
 * 要画的两种只能布置打开了画流程图的题（后端会点名拒掉）
 */
const lessonMode = ref<LessonMode>('code')
const modeOptions = (['code', 'both', 'flowchart'] as const).map((value) => ({ label: LESSON_MODE_LABEL[value], value }))
const needsCode = computed(() => lessonNeeds(lessonMode.value).code)
const lessonInput = ref('')
const saving = ref(false)

/** 改的是老师布置的这一节：框里是它的题；新开一节是空的 */
const editingPlanned = computed(() => props.lessonId !== null && props.lessonId === props.board.lessonId)

function resetLessonInput() {
  const keep = editingPlanned.value || props.carry
  lessonInput.value = keep ? props.board.problems.map((problem) => problem.problemDisplayId).join(' ') : ''
  lessonLanguage.value = (editingPlanned.value ? props.board.language : null) ?? props.board.lastLanguage ?? 'Python'
  lessonMode.value = props.carry ? 'code' : editingPlanned.value ? (props.board.mode ?? 'code') : 'code'
}

resetLessonInput()
// 推断出来的题也带进框里，老师多半只是确认一下
if (props.variant === 'inline' && props.board.source === 'inferred' && !lessonInput.value && props.board.problems.length) {
  lessonInput.value = props.board.problems.map((problem) => problem.problemDisplayId).join(' ')
}
// 换了班、换了一节要把输入框换成那一节的题、布置时选的语言（15 秒一次的刷新不动它们）。
// 必须写成几个单值来源：一个 getter 返回数组的话，每次刷新整个 board 换新，数组也是新的，
// 回调次次都跑，老师打到一半的题号每 15 秒被清一次
watch([() => props.board.className, () => props.board.source, () => props.lessonId, () => props.carry], resetLessonInput)

function inputIds() {
  return lessonInput.value.split(/[\s,，、;；]+/).filter(Boolean)
}

async function saveLesson() {
  const ids = inputIds()
  saving.value = true
  try {
    await setClassLesson(props.className, ids, ids.length && needsCode.value ? lessonLanguage.value : null, lessonMode.value, props.lessonId)
    message.success(ids.length ? '已布置，学生首页会显示这几道题' : '已清掉')
    picking.value = false
    emit('saved')
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

// ---- 选题弹框：不用记题号，按知识点挑。框里已经敲了的题号带进去，题名能对上的带上题名 ----
const picking = ref(false)
const pickerInitial = ref<{ id: string; title?: string }[]>([])
function openPicker() {
  const titles = new Map(props.board.problems.map((p) => [p.problemDisplayId.toLowerCase(), p.title]))
  pickerInitial.value = inputIds().map((id) => ({ id, title: titles.get(id.toLowerCase()) }))
  picking.value = true
}
function pickerConfirm(ids: string[]) {
  lessonInput.value = ids.join(' ')
  saveLesson()
}
</script>

<template>
  <div v-if="variant === 'inline'">
    <n-select v-model:value="lessonMode" :options="modeOptions" aria-label="这节课做什么" class="mode-select" />
    <n-select v-if="needsCode" v-model:value="lessonLanguage" :options="languageOptions" aria-label="用什么语言写" class="lang-select" />
    <n-input v-model:value="lessonInput" placeholder="这节课的题号，用空格隔开" clearable autofocus @keyup.enter="saveLesson" />
    <n-button @click="openPicker">
      <template #icon><Icon icon="ph:list-checks" /></template>
      选题
    </n-button>
    <n-button type="primary" :loading="saving" @click="saveLesson">布置</n-button>
    <n-button @click="emit('cancel')">取消</n-button>
    <!-- 弹层挂在 body 下，放在根节点里面：两个根会让看板传进来的 class 落空 -->
    <ProblemPicker
      v-model:show="picking"
      v-model:language="lessonLanguage"
      :initial="pickerInitial"
      :saving="saving"
      @confirm="pickerConfirm"
      v-model:lesson-mode="lessonMode"
    />
  </div>
  <div v-else>
    <n-select v-model:value="lessonMode" :options="modeOptions" aria-label="这节课做什么" size="large" class="mode-select" />
    <n-select v-if="needsCode" v-model:value="lessonLanguage" :options="languageOptions" aria-label="用什么语言写" size="large" class="lang-select" />
    <n-input v-model:value="lessonInput" size="large" placeholder="输入题号，用空格隔开" class="start-input" @keyup.enter="saveLesson" />
    <n-button size="large" @click="openPicker">
      <template #icon><Icon icon="ph:list-checks" /></template>
      选题
    </n-button>
    <n-button type="primary" size="large" :loading="saving" @click="saveLesson">布置</n-button>
    <ProblemPicker
      v-model:show="picking"
      v-model:language="lessonLanguage"
      :initial="pickerInitial"
      :saving="saving"
      @confirm="pickerConfirm"
      v-model:lesson-mode="lessonMode"
    />
  </div>
</template>

<style scoped>
.lang-select {
  width: 110px;
  flex-shrink: 0;
}

.mode-select {
  width: 116px;
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

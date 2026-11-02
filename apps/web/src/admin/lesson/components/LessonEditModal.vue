<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { LESSON_MODE_LABEL, lessonNeeds, type AdminLesson, type LessonLanguage, type LessonMode } from '@oj2/contract'
import ProblemPicker from 'oj/task/components/ProblemPicker.vue'
import { useConfigStore } from 'shared/store/config'
import { errorMessage } from 'utils/api'
import { groupClassOptions } from 'utils/classes'
import { LANGUAGE_SHOW_VALUE } from 'utils/constants'
import { parseTime } from 'utils/functions'
import { createAdminLesson, updateAdminLesson } from '../../api'

/**
 * 后台改一节 / 补一节。改的时候班级、日子、时刻都能动 —— 任务页上点错了班、隔天才想起来布置，
 * 都在这里纠正；补的是任务页外上的课，补了数据统计才认得到。题号可以敲，也可以点「选题」挑
 */
const props = defineProps<{
  /** null = 补一节 */
  lesson: AdminLesson | null
}>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ saved: [] }>()
const message = useMessage()
const configStore = useConfigStore()

const LESSON_LANGUAGES: LessonLanguage[] = ['Python', 'C', 'C++', 'SQL']
const languageOptions = LESSON_LANGUAGES.map((value) => ({ label: LANGUAGE_SHOW_VALUE[value], value }))
const modeOptions = (['code', 'both', 'flowchart'] as const).map((value) => ({ label: LESSON_MODE_LABEL[value], value }))
const classOptions = computed(() => groupClassOptions(configStore.config?.classList ?? []))

const className = ref<string | null>(null)
const day = ref<string | null>(null)
const time = ref<string | null>(null)
const language = ref<LessonLanguage>('Python')
/** 做什么：画流程图不用选语言（存成 null） */
const mode = ref<LessonMode>('code')
const needsCode = computed(() => lessonNeeds(mode.value).code)
const idsInput = ref('')
const saving = ref(false)

watch(show, (open) => {
  if (!open) return
  const lesson = props.lesson
  const now = new Date()
  className.value = lesson?.className ?? null
  // 日子、时刻都按东八区：n-date-picker / n-time-picker 绑的是格式化后的文本，不经过浏览器时区
  day.value = lesson?.day ?? parseTime(now, 'YYYY-MM-DD')
  time.value = parseTime(lesson?.createdAt ?? now, 'HH:mm')
  language.value = lesson?.language ?? 'Python'
  mode.value = lesson?.mode ?? 'code'
  idsInput.value = lesson?.problems.map((p) => p.problemDisplayId).join(' ') ?? ''
})

function inputIds() {
  return idsInput.value.split(/[\s,，、;；]+/).filter(Boolean)
}

// ---- 选题弹框，和任务页上那个是同一个 ----
const picking = ref(false)
const pickerInitial = ref<{ id: string; title?: string }[]>([])
function openPicker() {
  const titles = new Map(props.lesson?.problems.map((p) => [p.problemDisplayId.toLowerCase(), p.title]) ?? [])
  pickerInitial.value = inputIds().map((id) => ({ id, title: titles.get(id.toLowerCase()) }))
  picking.value = true
}
function picked(ids: string[]) {
  idsInput.value = ids.join(' ')
  picking.value = false
}

const ready = computed(() => !!className.value && !!day.value && !!time.value && inputIds().length > 0)

async function save() {
  if (!ready.value) return
  saving.value = true
  const body = {
    className: className.value!,
    day: day.value!,
    time: time.value!,
    language: needsCode.value ? language.value : null,
    mode: mode.value,
    problemDisplayIds: inputIds(),
  }
  try {
    if (props.lesson) await updateAdminLesson(props.lesson.id, body)
    else await createAdminLesson(body)
    message.success(props.lesson ? '改好了' : '补上了')
    show.value = false
    emit('saved')
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" :title="lesson ? '改这一节' : '补一节'" :bordered="false" :style="{ width: 'min(520px, calc(100vw - 32px))' }">
    <n-form label-placement="left" label-width="64">
      <n-form-item label="班级">
        <n-select v-model:value="className" :options="classOptions" filterable placeholder="选班级" />
      </n-form-item>
      <n-form-item label="上课">
        <div class="when">
          <n-date-picker v-model:formatted-value="day" value-format="yyyy-MM-dd" type="date" class="day" />
          <n-time-picker v-model:formatted-value="time" value-format="HH:mm" format="HH:mm" class="time" />
        </div>
      </n-form-item>
      <n-form-item label="做什么">
        <div class="when">
          <n-select v-model:value="mode" :options="modeOptions" class="lang" />
          <n-select v-if="needsCode" v-model:value="language" :options="languageOptions" aria-label="用什么语言写" class="lang" />
        </div>
      </n-form-item>
      <n-form-item label="题目">
        <div class="ids">
          <n-input v-model:value="idsInput" placeholder="题号，用空格隔开" @keyup.enter="save" />
          <n-button @click="openPicker">
            <template #icon><Icon icon="ph:list-checks" /></template>
            选题
          </n-button>
        </div>
      </n-form-item>
    </n-form>
    <template #footer>
      <div class="foot">
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" :disabled="!ready" :loading="saving" @click="save">{{ lesson ? '保存' : '补上' }}</n-button>
      </div>
    </template>
    <ProblemPicker
      v-model:show="picking"
      v-model:language="language"
      v-model:lesson-mode="mode"
      :initial="pickerInitial"
      :saving="false"
      mode="pick"
      @confirm="picked"
    />
  </n-modal>
</template>

<style scoped>
.when,
.ids {
  display: flex;
  gap: 8px;
  width: 100%;
}

.day {
  flex: 1 1 0;
}

.time {
  width: 110px;
}

.lang {
  width: 140px;
}

.ids .n-input {
  flex: 1 1 0;
}

.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

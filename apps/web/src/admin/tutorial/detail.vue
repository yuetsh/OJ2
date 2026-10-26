<script lang="ts" setup>
import { Icon } from '@iconify/vue'
import type { AdminTutorialProblem } from '@oj2/contract'
import { errorMessage } from 'utils/api'
import MarkdownEditor from 'shared/components/MarkdownEditor.vue'
import type { Exercise, TutorialEdit, TutorialListItem } from 'utils/types'
import { parseLesson } from 'oj/learn/composables/useLessonParse'
import { joinTitle, lessonPath, splitTitle } from 'oj/learn/lesson'
import LessonBody from 'oj/learn/components/LessonBody.vue'
import 'oj/learn/learn.css'
import { createTutorial, deleteTutorial, getTutorial, getTutorialList, updateTutorial } from '../api'
import ExerciseManager from './components/ExerciseManager.vue'
import RelatedProblems from './components/RelatedProblems.vue'
import { useBreakpoints } from 'shared/composables/breakpoints'

/**
 * 编辑一课（设计稿「后台 · 编辑一课」）：知识点 / 情境 / 项目三个字段，正文左边写、
 * 右边用学生端同一套组件预览（练一练、能运行的代码块都看得到），右栏是练一练和相关题。
 * 「示例代码」字段去掉了：正文里的代码块直接能运行。
 */
const props = defineProps<{ tutorialID?: string }>()

const route = useRoute()
const router = useRouter()
const message = useMessage()

const isCreate = computed(() => route.name === 'admin tutorial create')

// 手机上左右分栏各剩一百多像素，改成正文「写 / 预览」切着看
const { isMobile } = useBreakpoints()
const pane = ref<'source' | 'preview'>('source')

const tutorial = reactive<TutorialEdit>({
  id: 0,
  title: '',
  content: '',
  project: typeof route.query.project === 'string' ? route.query.project : '',
  isPublic: false,
  order: 0,
  type: route.query.type === 'c' ? 'c' : 'python',
})
const kp = ref('')
const scene = ref('')
const problems = ref<AdminTutorialProblem[]>([])
const exercises = ref<Exercise[]>([])
const allTutorials = ref<{ [key: string]: TutorialListItem[] }>({ python: [], c: [] })
const saving = ref(false)
const editor = useTemplateRef<InstanceType<typeof MarkdownEditor>>('editor')

const typeOptions = [
  { label: 'Python', value: 'python' },
  { label: 'C 语言', value: 'c' },
]

const siblings = computed(() => allTutorials.value[tutorial.type] ?? [])
const projectOptions = computed(() => {
  const names = [...new Set(siblings.value.map((item) => item.project).filter(Boolean))]
  if (tutorial.project && !names.includes(tutorial.project)) names.push(tutorial.project)
  return names.map((name) => ({ label: name, value: name }))
})
/** 学生那边是第几课：只数公开的 */
const step = computed(() => {
  const visible = siblings.value.filter((item) => item.isPublic)
  const index = visible.findIndex((item) => item.id === tutorial.id)
  return index >= 0 ? index + 1 : null
})
const heading = computed(() => {
  if (isCreate.value) return '新建一课'
  const label = tutorial.type === 'c' ? 'C 语言' : 'Python'
  return step.value ? `${label} 第 ${step.value} 课` : `${label} · 没公开`
})
const preview = computed(() => parseLesson(tutorial.content, exercises.value))

async function init() {
  allTutorials.value = await getTutorialList().catch(() => ({ python: [], c: [] }))
  if (!props.tutorialID) {
    // 新建：顺序排在这门课最后
    tutorial.order = Math.max(0, ...siblings.value.map((item) => item.order)) + 1
    return
  }
  const data = await getTutorial(parseInt(props.tutorialID))
  tutorial.id = data.id
  tutorial.title = data.title
  tutorial.content = data.content
  tutorial.project = data.project
  tutorial.isPublic = data.isPublic
  tutorial.order = data.order
  tutorial.type = data.type
  problems.value = data.problems
  const parts = splitTitle(data.title)
  kp.value = parts.kp
  scene.value = parts.scene
}

async function submit() {
  tutorial.title = joinTitle(kp.value, scene.value)
  if (!kp.value.trim() || !tutorial.content.trim()) {
    message.error('知识点和正文必填')
    return
  }
  saving.value = true
  try {
    if (isCreate.value) {
      const created = await createTutorial(tutorial)
      message.success('已新建，接着可以加练一练和相关题')
      router.replace({ name: 'admin tutorial edit', params: { tutorialID: created.id } })
    } else {
      await updateTutorial(tutorial)
      message.success('已保存')
      allTutorials.value = await getTutorialList().catch(() => allTutorials.value)
    }
  } catch (err) {
    message.error(errorMessage(err))
  } finally {
    saving.value = false
  }
}

async function remove() {
  try {
    await deleteTutorial(tutorial.id)
    message.success('已删除')
    router.push({ name: 'admin tutorial list' })
  } catch (err) {
    message.error(errorMessage(err))
  }
}

function insertExercise(id: number) {
  editor.value?.insert(`[[exercise:${id}]]`)
}

function openStudentView() {
  if (step.value) window.open(router.resolve(lessonPath(tutorial.type, step.value)).href, '_blank')
}

watch(() => props.tutorialID, init)
onMounted(init)
</script>

<template>
  <div class="page">
    <div class="top">
      <router-link :to="{ name: 'admin tutorial list' }" class="back"> <Icon icon="ph:caret-left-bold" :width="13" />教程 </router-link>
      <span class="slash">/</span>
      <span class="heading">{{ heading }}</span>
      <span class="grow" />
      <label class="public">
        <n-switch v-model:value="tutorial.isPublic" size="small" />
        公开
      </label>
      <n-button v-if="!isCreate" :disabled="!step" @click="openStudentView">
        <template #icon><Icon icon="ph:eye" /></template>
        看学生那边
      </n-button>
      <n-popconfirm v-if="!isCreate" @positive-click="remove">
        <template #trigger>
          <n-button quaternary type="error">删除</n-button>
        </template>
        这一课连同它的练一练、学生的进度一起删掉，确定吗？
      </n-popconfirm>
      <n-button type="primary" :loading="saving" @click="submit">保存</n-button>
    </div>

    <div class="fields">
      <label class="field">
        <span>知识点</span>
        <n-input v-model:value="kp" placeholder="条件语句基础" style="width: 200px" />
      </label>
      <label class="field">
        <span>情境</span>
        <n-input v-model:value="scene" placeholder="蜜橘园环境预警" style="width: 200px" />
      </label>
      <label class="field">
        <span>项目</span>
        <n-select v-model:value="tutorial.project" :options="projectOptions" filterable tag clearable placeholder="选一个，或者打字新建" style="width: 250px" />
      </label>
      <label v-if="isCreate" class="field">
        <span>语言</span>
        <n-select v-model:value="tutorial.type" :options="typeOptions" style="width: 110px" />
      </label>
    </div>

    <div class="work">
      <section class="card editor-card">
        <div class="card-head">
          <span class="strong">正文</span>
          <span class="muted">Markdown</span>
          <template v-if="isMobile">
            <span class="grow" />
            <n-radio-group v-model:value="pane" size="small">
              <n-radio-button value="source">写</n-radio-button>
              <n-radio-button value="preview">预览</n-radio-button>
            </n-radio-group>
          </template>
        </div>
        <div class="split" :class="isMobile ? `only-${pane}` : ''">
          <div class="source">
            <MarkdownEditor ref="editor" v-model:value="tutorial.content" :code-lang="tutorial.type" height="100%" />
          </div>
          <div class="preview">
            <LessonBody
              :segments="preview.segments"
              :lang="tutorial.type"
              :tutorial-id="tutorial.id"
              :exercise-count="preview.exerciseCount"
              :solved-ids="new Set()"
            />
          </div>
        </div>
      </section>

      <aside class="side">
        <section class="card pad">
          <ExerciseManager v-if="tutorial.id" :tutorial-id="tutorial.id" :content="tutorial.content" @insert="insertExercise" @change="exercises = $event" />
          <div v-else class="muted">保存之后就能加练一练</div>
        </section>
        <section class="card pad">
          <RelatedProblems v-if="tutorial.id" :tutorial-id="tutorial.id" :problems="problems" @update="problems = $event" />
          <div v-else class="muted">保存之后就能挑相关题</div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: calc(100vh - 96px);
  min-height: 600px;
}
.top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: #18a058;
  text-decoration: none;
}
.slash {
  opacity: 0.4;
}
.heading {
  font-size: 18px;
  font-weight: 700;
}
.grow {
  flex: 1;
}
.public {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.fields {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.work {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
}
.card {
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 8px;
}
.pad {
  padding: 12px 14px;
}
.editor-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.card-head {
  height: 38px;
  flex-shrink: 0;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.22);
  font-size: 13px;
}
.strong {
  font-weight: 600;
}
.muted {
  opacity: 0.6;
  font-size: 13px;
}
.split {
  flex: 1;
  min-height: 0;
  display: flex;
}
.source {
  flex: 0 0 50%;
  min-width: 0;
  border-right: 1px solid rgba(128, 128, 128, 0.22);
}
.preview {
  flex: 0 0 50%;
  min-width: 0;
  box-sizing: border-box;
  padding: 12px 20px;
  overflow-y: auto;
}
.side {
  width: 330px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

/* 手机：整页跟着滚，正文一次只露写或预览，练一练和相关题排到下面 */
@media (max-width: 768px) {
  .page {
    height: auto;
    min-height: 0;
  }
  .top {
    flex-wrap: wrap;
    gap: 8px;
  }
  .field {
    width: 100%;
  }
  .field > span {
    width: 3em;
    flex-shrink: 0;
  }
  .field > :deep(.n-input),
  .field > :deep(.n-base-selection),
  .field > :deep(.n-select) {
    flex: 1;
    width: auto !important;
    min-width: 0;
  }
  .work {
    flex-direction: column;
  }
  .editor-card {
    flex: none;
    height: 70vh;
  }
  .only-source .preview,
  .only-preview .source {
    display: none;
  }
  .split .source,
  .split .preview {
    flex-basis: 100%;
    border-right: 0;
  }
  .preview {
    padding: 12px;
  }
  .side {
    width: auto;
    overflow-y: visible;
  }
}
</style>

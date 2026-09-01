<template>
  <div class="learn-container">
    <!-- 桌面端布局 -->
    <n-grid
      :cols="5"
      :x-gap="16"
      v-if="tutorial.id && isDesktop"
      class="learn-grid"
    >
      <n-gi :span="1" class="learn-col">
        <n-card title="教程目录" :bordered="false" size="small">
          <LessonList
            :titles="titles"
            :step="step"
            :progress="progress"
            :traced="traced"
            @select="goToLesson"
          />
        </n-card>
      </n-gi>

      <n-gi :span="tutorial.code ? 2 : 4" class="learn-col">
        <n-card
          :title="`第 ${step} 课：${titles[step - 1]?.title}`"
          :bordered="false"
          size="small"
        >
          <template v-for="(seg, i) in segments" :key="i">
            <MdPreview
              v-if="seg.type === 'md'"
              preview-theme="vuepress"
              :theme="isDark ? 'dark' : 'light'"
              :model-value="seg.content"
            />
            <ExerciseWidget
              v-else
              :exercise="seg.exercise"
              :lang="tutorial.type"
            />
          </template>
        </n-card>
      </n-gi>

      <n-gi :span="2" v-if="tutorial.code" class="learn-col learn-col--code">
        <n-card
          title="示例代码"
          :bordered="false"
          size="small"
          class="code-card"
          content-style="height: calc(100% - 44px); padding: 0;"
        >
          <CodeEditor
            :language="editorLanguage"
            v-model="tutorial.code"
            height="100%"
          />
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 手机端布局 -->
    <template v-if="tutorial.id && !isDesktop">
      <n-tabs type="line" animated v-model:value="activeTab">
        <n-tab-pane name="catalog" tab="目录">
          <LessonList
            :titles="titles"
            :step="step"
            :progress="progress"
            :traced="traced"
            @select="goToLesson"
          />
        </n-tab-pane>

        <n-tab-pane name="content" :tab="`第 ${step} 课`">
          <template v-for="(seg, i) in segments" :key="i">
            <MdPreview
              v-if="seg.type === 'md'"
              preview-theme="vuepress"
              :theme="isDark ? 'dark' : 'light'"
              :model-value="seg.content"
            />
            <ExerciseWidget
              v-else
              :exercise="seg.exercise"
              :lang="tutorial.type"
            />
          </template>
        </n-tab-pane>

        <n-tab-pane name="code" tab="示例代码" v-if="tutorial.code">
          <CodeEditor :language="editorLanguage" v-model="tutorial.code" />
        </n-tab-pane>
      </n-tabs>

      <n-divider style="margin: 12px 0" />

      <n-flex align="center" justify="space-between">
        <n-button
          secondary
          type="primary"
          :disabled="isFirstLesson"
          @click="goToPrevLesson"
        >
          ← 上一课
        </n-button>
        <n-text>{{ step }} / {{ titles.length }}</n-text>
        <n-button
          secondary
          type="primary"
          :disabled="isLastLesson"
          @click="goToNextLesson"
        >
          下一课 →
        </n-button>
      </n-flex>
    </template>

    <n-empty
      v-if="isEmpty"
      description="该教程还没有公开"
      style="margin-top: 80px"
    />
  </div>
</template>

<script setup lang="ts">
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import type { Tutorial, Exercise, LANGUAGE, TutorialProgress } from "utils/types"
import {
  getTutorial,
  getTutorials,
  getExercises,
  getLearnProgress,
} from "../api"
import { parseExercises } from "./composables/useExerciseParse"
import { useLearnTrace } from "./composables/useLearnTrace"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useLearnProgress } from "shared/composables/learnProgress"
import { useUserStore } from "shared/store/user"
import LessonList from "./components/LessonList.vue"

const ExerciseWidget = defineAsyncComponent(
  () => import("./components/ExerciseWidget.vue"),
)
const CodeEditor = defineAsyncComponent(
  () => import("shared/components/CodeEditor.vue"),
)

const isDark = useDark()
const route = useRoute()
const router = useRouter()
const { isDesktop } = useBreakpoints()
const { learnStep } = useLearnProgress()
const userStore = useUserStore()

// 未登录也能看教程（学习页本来就不要求登录），只是不留痕
const traced = computed(() => userStore.isAuthed)

const step = computed(() => {
  const value = route.params.step as string | undefined
  if (!value) return 1
  return parseInt(value)
})

const type = computed<"python" | "c">(() =>
  route.params.type === "c" ? "c" : "python",
)

const tutorial = ref<Partial<Tutorial>>({
  id: 0,
  title: "",
  content: "",
  code: "",
})

const editorLanguage = computed<LANGUAGE>(() =>
  tutorial.value.type === "c" ? "C" : "Python3",
)
const titles = ref<{ id: number; title: string }[]>([])
const progress = ref<Record<number, TutorialProgress>>({})
const exercises = ref<Exercise[]>([])
const activeTab = ref("content")
const isEmpty = ref(false)

const segments = computed(() =>
  parseExercises(tutorial.value.content ?? "", exercises.value),
)

// 留痕的计时器。tutorial.id 变了才算换课 —— 用 step 会在内容还没加载好时就上报
useLearnTrace(
  computed(() => tutorial.value.id ?? 0),
  traced,
)

const isFirstLesson = computed(() => step.value === 1)
const isLastLesson = computed(() => step.value === titles.value.length)

function goToLesson(lessonNumber: number) {
  activeTab.value = "content"
  router.push(
    `/learn/${type.value}/${lessonNumber.toString().padStart(2, "0")}`,
  )
}
function goToPrevLesson() {
  if (step.value > 1) goToLesson(step.value - 1)
}
function goToNextLesson() {
  if (step.value < titles.value.length) goToLesson(step.value + 1)
}

/**
 * 拉自己的自学留痕，给目录打勾。失败就当没有 —— 目录少几个勾不影响上课，
 * 但弹个错会把「我是不是没学」的焦虑塞给学生。
 */
async function loadProgress() {
  if (!traced.value) {
    progress.value = {}
    return
  }
  try {
    const rows = await getLearnProgress(type.value)
    progress.value = Object.fromEntries(rows.map((row) => [row.tutorialId, row]))
  } catch {
    progress.value = {}
  }
}

async function init() {
  const res1 = await getTutorials(type.value)
  titles.value = res1
  isEmpty.value = titles.value.length === 0
  if (isEmpty.value) return
  const id = titles.value[step.value - 1].id
  const [res2, exs] = await Promise.allSettled([
    getTutorial(id),
    getExercises(id),
  ])
  if (res2.status === "fulfilled") tutorial.value = res2.value
  exercises.value = exs.status === "fulfilled" ? exs.value : []
  learnStep.value[type.value] = step.value
  loadProgress()
}

watch(
  () => [route.params.type, route.params.step],
  async () => {
    if (route.name === "learn") init()
  },
  { immediate: true },
)

// 在教程页上登录/退出时把目录的勾重新拉一遍。学生多半是先点开教程、
// 被弹窗拦下才登录的，不盯着这个的话勾要等他刷新页面才出现
watch(traced, loadProgress)
</script>

<style scoped>
/* 桌面端固定高度，让目录/内容/代码三栏各自内部滚动；移动端不限高，交给页面整体滚动 */
@media (min-width: 769px) {
  .learn-container {
    height: calc(100vh - 138px);
  }
}

.learn-grid {
  height: 100%;
}

.learn-col {
  overflow-y: auto;
  height: 100%;
}

.learn-col--code {
  overflow-y: hidden;
}

.code-card {
  height: 100%;
}
</style>

<template>
  <div class="learn-container">
    <template v-if="tutorial.id">
      <!-- 桌面端：目录 | 正文（居中限宽） | 可收起的示例代码 -->
      <div
        v-if="isDesktop"
        class="learn-layout"
        :class="{ 'with-code': codeOpen }"
      >
        <aside class="rail">
          <LearnSummary
            :titles="titles"
            :progress="progress"
            :traced="traced"
          />
          <LessonList
            :titles="titles"
            :step="step"
            :progress="progress"
            :traced="traced"
            @select="goToLesson"
          />
        </aside>

        <main class="reader">
          <article class="reader-body">
            <header class="lesson-head">
              <n-text depth="3">第 {{ step }} / {{ titles.length }} 课</n-text>
              <n-flex align="center" justify="space-between" :wrap="false">
                <span />
                <n-button
                  v-if="tutorial.code"
                  size="small"
                  secondary
                  @click="codeOpen = !codeOpen"
                >
                  {{ codeOpen ? "收起示例代码" : "展开示例代码" }}
                </n-button>
              </n-flex>
            </header>
            <LessonBody :segments="segments" :lang="tutorial.type" />
          </article>
          <PagerBar :step="step" :total="titles.length" @go="goToLesson" />
        </main>

        <aside v-if="tutorial.code && codeOpen" class="code-panel">
          <CodeEditor
            :language="editorLanguage"
            v-model="tutorial.code"
            height="100%"
          />
        </aside>
      </div>

      <!-- 手机端 -->
      <template v-else>
        <LearnSummary :titles="titles" :progress="progress" :traced="traced" />
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
            <LessonBody :segments="segments" :lang="tutorial.type" />
          </n-tab-pane>
          <n-tab-pane name="code" tab="示例代码" v-if="tutorial.code">
            <CodeEditor :language="editorLanguage" v-model="tutorial.code" />
          </n-tab-pane>
        </n-tabs>
        <PagerBar :step="step" :total="titles.length" @go="goToLesson" />
      </template>
    </template>

    <n-empty
      v-if="isEmpty"
      description="该教程还没有公开"
      style="margin-top: 80px"
    />
  </div>
</template>

<script setup lang="ts">
import type {
  Tutorial,
  Exercise,
  LANGUAGE,
  TutorialProgress,
} from "utils/types"
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
import LearnSummary from "./components/LearnSummary.vue"
import LessonBody from "./components/LessonBody.vue"
import PagerBar from "./components/PagerBar.vue"
const CodeEditor = defineAsyncComponent(
  () => import("shared/components/CodeEditor.vue"),
)

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
// 示例代码栏默认展开，收起后正文独占版面；偏好记在本机
const codeOpen = useStorage("oj2:learn-code-open", true)
const isEmpty = ref(false)

const segments = computed(() =>
  parseExercises(tutorial.value.content ?? "", exercises.value),
)

// 留痕的计时器。tutorial.id 变了才算换课 —— 用 step 会在内容还没加载好时就上报
useLearnTrace(
  computed(() => tutorial.value.id ?? 0),
  traced,
)

function goToLesson(lessonNumber: number) {
  activeTab.value = "content"
  router.push(
    `/learn/${type.value}/${lessonNumber.toString().padStart(2, "0")}`,
  )
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
    progress.value = Object.fromEntries(
      rows.map((row) => [row.tutorialId, row]),
    )
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
/* 桌面端固定高度，目录/正文/代码各自内部滚动；移动端交给页面整体滚动 */
@media (min-width: 769px) {
  .learn-container {
    height: calc(100vh - 138px);
  }
}

.learn-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 24px;
  height: 100%;
}
.learn-layout.with-code {
  grid-template-columns: 240px minmax(0, 1fr) minmax(360px, 40%);
}

.rail,
.reader {
  overflow-y: auto;
  height: 100%;
}
.reader {
  display: flex;
  flex-direction: column;
}
.reader-body {
  flex: 1;
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
}
.reader :deep(.pager) {
  max-width: 820px;
  width: 100%;
  margin-left: auto;
  margin-right: auto;
}

.lesson-head h1,
.mobile-title {
  margin: 4px 0 12px;
  font-size: 26px;
  line-height: 1.3;
}
.mobile-title {
  font-size: 20px;
}

.code-panel {
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
}
</style>

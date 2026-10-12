<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import type { Tutorial, TutorialProgress, TutorialSummary } from "@oj2/contract"
import type { Exercise } from "utils/types"
import { getExercises, getLearnProgress, getTutorial, getTutorials } from "../api"
import { parseLesson } from "./composables/useLessonParse"
import { useLearnTrace } from "./composables/useLearnTrace"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import {
  COURSES,
  doneCount,
  groupByProject,
  lessonPath,
  lessonState,
  splitTitle,
  type TutorialType,
} from "./lesson"
import LessonBody from "./components/LessonBody.vue"
import LessonEnd from "./components/LessonEnd.vue"
import LessonOutline from "./components/LessonOutline.vue"
import ProjectTree from "./components/ProjectTree.vue"
import SegBar from "./components/SegBar.vue"
import "./learn.css"

/**
 * 读一课。设计稿「自学重设计」页的阅读页 A（选定）：左边目录按项目折叠、中间正文、
 * 右边这一课的小节和练一练；手机上是顶部课程条 + 底部弹出的目录 + 底部上一课/下一课。
 */
const route = useRoute()
const router = useRouter()
const { isDesktop } = useBreakpoints()
const userStore = useUserStore()
const theme = useThemeVars()

// 未登录也能看教程，只是不留痕、不记进度
const traced = computed(() => userStore.isAuthed)

const type = computed<TutorialType>(() => (route.params.type === "c" ? "c" : "python"))
const courseLabel = computed(() => COURSES.find((item) => item.type === type.value)!.label)
const step = computed(() => {
  const value = parseInt((route.params.step as string | undefined) ?? "1")
  return Number.isFinite(value) && value > 0 ? value : 1
})

const titles = ref<TutorialSummary[]>([])
const progress = ref<Record<number, TutorialProgress>>({})
const tutorial = ref<Tutorial | null>(null)
const exercises = ref<Exercise[]>([])
const solvedIds = ref(new Set<number>())
const loading = ref(true)
const isEmpty = ref(false)
const menuOpen = ref(false)

const groups = computed(() => groupByProject(titles.value))
const parsed = computed(() =>
  tutorial.value
    ? parseLesson(tutorial.value.content, exercises.value)
    : { segments: [], outline: [], exerciseCount: 0 },
)
const parts = computed(() => splitTitle(tutorial.value?.title ?? ""))
const solvedCount = computed(
  () => exercises.value.filter((item) => solvedIds.value.has(item.id)).length,
)
const firstUnsolved = computed(() => {
  for (const seg of parsed.value.segments) {
    if (seg.type === "exercise" && !solvedIds.value.has(seg.exercise.id)) {
      return { id: seg.exercise.id, index: seg.index + 1 }
    }
  }
  return null
})
const prev = computed(() => lessonAt(step.value - 1))
const next = computed(() => lessonAt(step.value + 1))
const done = computed(() => doneCount(titles.value, progress.value))

function lessonAt(at: number) {
  const item = titles.value[at - 1]
  return item ? { title: item.title, to: lessonPath(type.value, at) } : null
}

function stateOf(id: number) {
  return lessonState(progress.value[id])
}

// 留痕的计时器。tutorial.id 变了才算换课 —— 用 step 会在内容还没加载好时就上报
useLearnTrace(
  computed(() => tutorial.value?.id ?? 0),
  traced,
)

/**
 * 拉自己的自学留痕，给目录打勾。失败就当没有 —— 目录少几个勾不影响学，
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

let generation = 0
async function init() {
  const mine = ++generation
  loading.value = true
  menuOpen.value = false
  const list = await getTutorials(type.value)
  if (mine !== generation) return
  titles.value = list
  isEmpty.value = list.length === 0
  if (isEmpty.value) {
    loading.value = false
    return
  }
  if (step.value > list.length) {
    router.replace(lessonPath(type.value, list.length))
    return
  }
  const id = list[step.value - 1]!.id
  const [lesson, exs] = await Promise.allSettled([
    getTutorial(id),
    getExercises(id),
    loadProgress(),
  ])
  if (mine !== generation) return
  tutorial.value = lesson.status === "fulfilled" ? lesson.value : null
  exercises.value = exs.status === "fulfilled" ? exs.value : []
  solvedIds.value = new Set(exercises.value.filter((item) => item.solved).map((item) => item.id))
  loading.value = false
  activeId.value = ""
  await nextTick()
  reader.value?.scrollTo({ top: 0 })
  if (!isDesktop.value) window.scrollTo({ top: 0 })
}

watch(
  () => [route.params.type, route.params.step],
  () => {
    if (route.name === "learn") init()
  },
  { immediate: true },
)

// 在教程页上登录/退出时把勾重新拉一遍（学生多半是点「运行」被拦下才登录的）
watch(traced, async () => {
  await loadProgress()
  if (!tutorial.value) return
  const exs = await getExercises(tutorial.value.id).catch(() => exercises.value)
  exercises.value = exs
  solvedIds.value = new Set([
    ...solvedIds.value,
    ...exs.filter((item) => item.solved).map((item) => item.id),
  ])
})

/** 刚做对一道：本课的进度就地加上，目录、进度条、课末跟着变，不用等刷新 */
function onSolved(exerciseId: number) {
  if (solvedIds.value.has(exerciseId) || !tutorial.value) return
  solvedIds.value = new Set([...solvedIds.value, exerciseId])
  const id = tutorial.value.id
  const row = progress.value[id] ?? {
    tutorialId: id,
    viewCount: 1,
    totalSeconds: 0,
    firstViewedAt: null,
    lastViewedAt: null,
    exerciseTotal: exercises.value.length,
    exerciseSolved: 0,
  }
  progress.value = { ...progress.value, [id]: { ...row, exerciseSolved: solvedCount.value } }
}

// ------------------------------------------------------------------ 读到哪一节
const reader = ref<HTMLElement | null>(null)
const activeId = ref("")

function onScroll() {
  const box = reader.value
  if (!box) return
  const top = box.getBoundingClientRect().top + 160
  let current = parsed.value.outline[0]?.id ?? ""
  for (const item of parsed.value.outline) {
    const el = document.getElementById(item.id)
    if (el && el.getBoundingClientRect().top <= top) current = item.id
  }
  activeId.value = current
}

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

function jumpExercise(id: number) {
  jump(`exercise-${id}`)
}
</script>

<template>
  <div class="learn">
    <n-empty v-if="isEmpty" description="这门课还没有公开的课" style="margin-top: 80px" />

    <!-- 桌面：目录 | 正文 | 这一课 -->
    <div v-else-if="isDesktop" class="layout">
      <aside class="rail">
        <router-link to="/learn" class="back">
          <Icon icon="ph:caret-left-bold" :width="13" />自学首页
        </router-link>
        <div class="course">
          <div class="course-head">
            <span class="course-name">{{ courseLabel }}</span>
            <span v-if="traced" class="muted num">学完 {{ done }} / {{ titles.length }}</span>
          </div>
          <SegBar
            :groups="groups"
            :state-of="stateOf"
            :current="tutorial?.id"
            :width="9"
            :height="5"
            :gap="2"
            :group-gap="6"
          />
        </div>
        <ProjectTree :groups="groups" :progress="progress" :type="type" :current-step="step" />
        <div v-if="!traced" class="login-tip muted">登录后记下学到哪</div>
      </aside>

      <main class="main">
        <div ref="reader" class="reader" @scroll.passive="onScroll">
          <article v-if="tutorial" class="article">
            <div class="crumb muted">
              <span v-if="tutorial.project">{{ tutorial.project }}</span>
              <span v-if="tutorial.project">·</span>
              <span class="num">第 {{ step }} / {{ titles.length }} 课</span>
            </div>
            <h1 class="h1">{{ parts.kp }}</h1>
            <div v-if="parts.scene" class="scene">{{ parts.scene }}</div>
            <LessonBody
              :segments="parsed.segments"
              :lang="type"
              :tutorial-id="tutorial.id"
              :exercise-count="parsed.exerciseCount"
              :solved-ids="solvedIds"
              @solved="onSolved"
            />
            <LessonEnd
              :step="step"
              :total="titles.length"
              :course-label="courseLabel"
              :exercise-count="parsed.exerciseCount"
              :solved-count="solvedCount"
              :first-unsolved="firstUnsolved"
              :problems="tutorial.problems"
              :next="next"
              :groups="groups"
              :state-of="stateOf"
              :done-count="done"
              @jump="jumpExercise"
            />
          </article>
          <n-spin v-else-if="loading" class="spin" />
        </div>
        <nav class="pager">
          <div class="pager-inner">
            <n-button v-if="prev" tag="a" :href="prev.to" @click.prevent="router.push(prev.to)">
              <template #icon><Icon icon="ph:caret-left-bold" /></template>
              上一课<span class="pager-name muted">{{ splitTitle(prev.title).kp }}</span>
            </n-button>
            <span class="grow" />
            <n-button
              v-if="next"
              type="primary"
              icon-placement="right"
              tag="a"
              :href="next.to"
              @click.prevent="router.push(next.to)"
            >
              <template #icon><Icon icon="ph:caret-right-bold" /></template>
              下一课<span class="pager-name next-name">{{ splitTitle(next.title).kp }}</span>
            </n-button>
          </div>
        </nav>
      </main>

      <aside class="side">
        <LessonOutline
          v-if="tutorial"
          :items="parsed.outline"
          :active-id="activeId || parsed.outline[0]?.id || ''"
          :solved-ids="solvedIds"
          :exercise-count="parsed.exerciseCount"
          @jump="jump"
        />
      </aside>
    </div>

    <!-- 手机 -->
    <div v-else class="mobile">
      <div class="mbar">
        <n-button @click="menuOpen = true">
          <template #icon><Icon icon="ph:list" /></template>
          目录
        </n-button>
        <span class="num muted-strong">第 {{ step }} / {{ titles.length }} 课</span>
        <span class="grow" />
        <span v-if="parsed.exerciseCount" class="mpractice">
          <span>练一练</span>
          <span class="mboxes">
            <span
              v-for="n in parsed.exerciseCount"
              :key="n"
              class="mbox"
              :class="{ on: n <= solvedCount }"
            />
          </span>
        </span>
      </div>
      <article v-if="tutorial" class="marticle">
        <div v-if="tutorial.project" class="crumb muted">{{ tutorial.project }}</div>
        <h1 class="h1 small">{{ parts.kp }}</h1>
        <div v-if="parts.scene" class="scene">{{ parts.scene }}</div>
        <LessonBody
          :segments="parsed.segments"
          :lang="type"
          :tutorial-id="tutorial.id"
          :exercise-count="parsed.exerciseCount"
          :solved-ids="solvedIds"
          @solved="onSolved"
        />
        <LessonEnd
          :step="step"
          :total="titles.length"
          :course-label="courseLabel"
          :exercise-count="parsed.exerciseCount"
          :solved-count="solvedCount"
          :first-unsolved="firstUnsolved"
          :problems="tutorial.problems"
          :next="next"
          :groups="groups"
          :state-of="stateOf"
          :done-count="done"
          compact
          @jump="jumpExercise"
        />
      </article>
      <n-spin v-else-if="loading" class="spin" />
      <nav class="mpager">
        <n-button v-if="prev" size="large" @click="router.push(prev.to)">
          <template #icon><Icon icon="ph:caret-left-bold" /></template>
          上一课
        </n-button>
        <span class="grow" />
        <n-button size="large" quaternary @click="menuOpen = true">
          <template #icon><Icon icon="ph:list" /></template>
          目录
        </n-button>
        <span class="grow" />
        <n-button
          v-if="next"
          size="large"
          type="primary"
          icon-placement="right"
          @click="router.push(next.to)"
        >
          <template #icon><Icon icon="ph:caret-right-bold" /></template>
          下一课
        </n-button>
      </nav>

      <n-drawer v-model:show="menuOpen" placement="bottom" height="85%" class="sheet">
        <n-drawer-content :native-scrollbar="false" closable>
          <template #header>
            <span class="sheet-head">
              <span class="course-name">{{ courseLabel }}</span>
              <span v-if="traced" class="muted num">学完 {{ done }} / {{ titles.length }}</span>
              <router-link to="/learn" class="sheet-home">自学首页</router-link>
            </span>
          </template>
          <ProjectTree
            :groups="groups"
            :progress="progress"
            :type="type"
            :current-step="step"
            big
            @go="menuOpen = false"
          />
        </n-drawer-content>
      </n-drawer>
    </div>
  </div>
</template>

<style scoped>
.muted {
  opacity: 0.6;
}
.num {
  font-variant-numeric: tabular-nums;
}
.grow {
  flex: 1;
}
.spin {
  display: flex;
  justify-content: center;
  margin-top: 80px;
}

/* 桌面端固定高度，三栏各自滚动。72 = 顶栏 56 + 外框上内边距 16；
   底下的 16 内边距用负外边距吃掉，上一课 / 下一课那条贴着屏幕底 */
.layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 220px;
  grid-template-rows: minmax(0, 1fr);
  height: calc(100vh - 72px);
  margin-bottom: -16px;
}
@media (max-width: 1180px) {
  .layout {
    grid-template-columns: 240px minmax(0, 1fr);
  }
  .side {
    display: none;
  }
}
.rail {
  box-sizing: border-box;
  border-right: 1px solid var(--learn-line);
  padding: 0 12px 16px 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  padding: 0 8px;
  color: var(--learn-green-text);
  text-decoration: none;
}
.course {
  padding: 10px 8px 12px;
}
.course-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
}
.course-name {
  font-size: 17px;
  font-weight: 700;
}
.login-tip {
  font-size: 13px;
  padding: 8px;
}
.main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.reader {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 40px 0;
}
.article {
  max-width: 720px;
  margin: 0 auto;
}
.crumb {
  display: flex;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 6px;
}
.h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.3;
}
.h1.small {
  font-size: 24px;
}
.scene {
  font-size: 15px;
  opacity: 0.8;
  margin: 4px 0 18px;
}
.pager {
  flex-shrink: 0;
  border-top: 1px solid var(--learn-line);
  padding: 12px 40px;
}
.pager-inner {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.pager-name {
  margin-left: 6px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.next-name {
  opacity: 0.85;
}
.side {
  box-sizing: border-box;
  padding: 24px 0 0 16px;
  overflow-y: auto;
}

/* 手机 */
/* 外层 n-layout 是 overflow: hidden，sticky 粘不住：顶部的条跟着滚走，
   上一课 / 下一课（带目录按钮）固定在屏幕底部 */
.mobile {
  padding-bottom: 72px;
}
.mbar {
  height: 48px;
  margin: 0 -12px;
  padding: 0 12px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--learn-line);
  background: v-bind("theme.bodyColor");
  display: flex;
  align-items: center;
  gap: 8px;
}
.muted-strong {
  font-size: 13px;
  opacity: 0.8;
}
.mpractice {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.mboxes {
  display: flex;
  gap: 3px;
}
.mbox {
  width: 14px;
  height: 6px;
  border-radius: 3px;
  background: var(--learn-todo);
}
.mbox.on {
  background: var(--learn-green);
}
.marticle {
  padding-top: 16px;
}
.mpager {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  padding: 10px 12px;
  border-top: 1px solid var(--learn-line);
  display: flex;
  align-items: center;
  background: v-bind("theme.bodyColor");
}
.sheet-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}
.sheet-home {
  margin-left: 12px;
  color: var(--learn-green-text);
  text-decoration: none;
}
</style>

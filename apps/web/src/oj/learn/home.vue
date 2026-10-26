<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { TutorialProgress, TutorialSummary } from '@oj2/contract'
import { getLearnProgress, getTutorials } from '../api'
import { useBreakpoints } from 'shared/composables/breakpoints'
import { useAuthModalStore } from 'shared/store/authModal'
import AdminLink from 'shared/components/AdminLink.vue'
import { useUserStore } from 'shared/store/user'
import { COURSES, continueStep, doneCount, groupByProject, lessonPath, lessonState, splitProject, splitTitle, type TutorialType } from './lesson'
import LessonRow from './components/LessonRow.vue'
import ProjectTile from './components/ProjectTile.vue'
import ProjectTree from './components/ProjectTree.vue'
import SegBar from './components/SegBar.vue'
import './learn.css'

/**
 * 自学首页 /learn（设计稿「自学首页」）：最上面「接着学」，下面按项目分组的课程地图。
 *
 * 「接着学」看的是**服务端留痕**里最近打开的那一课，不是本机记的：机房一台电脑
 * 轮着好几个班用，本地记的是上一个人学到哪。
 */
const userStore = useUserStore()
const authModal = useAuthModalStore()
const { isDesktop } = useBreakpoints()
const route = useRoute()
const router = useRouter()

interface Course {
  type: TutorialType
  label: string
  titles: TutorialSummary[]
  progress: Record<number, TutorialProgress>
}

const courses = ref<Course[]>([])
const loaded = ref(false)
const tab = ref<TutorialType>(route.query.course === 'c' ? 'c' : 'python')

async function load() {
  const authed = userStore.isAuthed
  courses.value = await Promise.all(
    COURSES.map(async ({ type, label }) => {
      const [titles, rows] = await Promise.all([getTutorials(type), authed ? getLearnProgress(type).catch(() => []) : Promise.resolve([])])
      return {
        type,
        label,
        titles,
        progress: Object.fromEntries(rows.map((row) => [row.tutorialId, row])),
      }
    }),
  )
  // 没指定看哪门课时，打开最近在学的那门
  if (!route.query.course && resume.value) tab.value = resume.value.course.type
  loaded.value = true
}

function latestViewed(course: Course) {
  return Object.values(course.progress).reduce<string>((acc, row) => (row.lastViewedAt && row.lastViewedAt > acc ? row.lastViewedAt : acc), '')
}

/** 接着学：最近打开过的那门课里该接着学的那课 */
const resume = computed(() => {
  const started = courses.value.filter((course) => course.titles.length && latestViewed(course)).sort((a, b) => latestViewed(b).localeCompare(latestViewed(a)))
  const course = started[0]
  if (!course) return null
  const step = continueStep(course.titles, course.progress)
  if (!step) return null
  const item = course.titles[step - 1]!
  return { course, step, item, parts: splitTitle(item.title), project: splitProject(item.project) }
})

const others = computed(() => courses.value.filter((course) => course.titles.length && course.type !== resume.value?.course.type))
const current = computed(() => courses.value.find((course) => course.type === tab.value))
const groups = computed(() => groupByProject(current.value?.titles ?? []))

function stateOf(course: Course) {
  return (id: number) => lessonState(course.progress[id])
}

function firstLesson(course: Course) {
  return course.titles[0] ? splitTitle(course.titles[0].title) : null
}

function courseStep(course: Course) {
  return continueStep(course.titles, course.progress)
}

function pickTab(type: TutorialType) {
  tab.value = type
  router.replace({ query: { ...route.query, course: type } })
}

function doneIn(course: Course, ids: number[]) {
  return ids.filter((id) => lessonState(course.progress[id]) === 'done').length
}

watch(() => userStore.isAuthed, load)
onMounted(load)
</script>

<template>
  <div class="home">
    <template v-if="loaded">
      <!-- 第一排：接着学 + 另一门课；一课没学过就是两张「开始学」 -->
      <div class="top" :class="{ two: !resume }">
        <section v-if="resume" class="resume">
          <div class="resume-main">
            <div class="resume-meta">
              <span class="resume-label">接着学</span>
              <span class="muted">
                {{ resume.course.label }}
                <template v-if="resume.item.project"> · {{ resume.item.project }}</template>
                · 第 {{ resume.step }} 课
              </span>
            </div>
            <div class="resume-title">
              <span class="resume-kp">{{ resume.parts.kp }}</span>
              <span v-if="resume.parts.scene" class="resume-scene">{{ resume.parts.scene }}</span>
            </div>
            <div class="resume-progress">
              <SegBar
                :groups="groupByProject(resume.course.titles)"
                :state-of="stateOf(resume.course)"
                :current="resume.item.id"
                :width="isDesktop ? 20 : 11"
                :gap="isDesktop ? 3 : 2"
                :group-gap="isDesktop ? 10 : 6"
              />
              <span class="num sec"> 学完 {{ doneCount(resume.course.titles, resume.course.progress) }} / {{ resume.course.titles.length }} 课 </span>
            </div>
          </div>
          <n-button type="primary" size="large" class="resume-go" icon-placement="right" @click="router.push(lessonPath(resume.course.type, resume.step))">
            <template #icon><Icon icon="ph:caret-right-bold" /></template>
            接着学
          </n-button>
        </section>

        <!-- 手机上有了「接着学」就不再摆另一门课的卡，下面的页签切得到 -->
        <section v-for="course in resume ? (isDesktop ? others : []) : courses.filter((c) => c.titles.length)" :key="course.type" class="course card">
          <div class="course-text">
            <div class="course-head">
              <span class="course-name">{{ course.label }}</span>
              <span class="muted small">
                {{ course.titles.length }} 课
                <template v-if="resume">
                  ·
                  {{ courseStep(course) ? `学完 ${doneCount(course.titles, course.progress)} 课` : '还没开始' }}</template
                >
                <template v-else> · {{ groupByProject(course.titles).length }} 个项目</template>
              </span>
            </div>
            <div v-if="!resume && firstLesson(course)" class="first">
              <span class="muted">第 1 课</span>
              <span class="first-kp">{{ firstLesson(course)!.kp }}</span>
              <span class="sec">{{ firstLesson(course)!.scene }}</span>
            </div>
            <SegBar :groups="groupByProject(course.titles)" :state-of="stateOf(course)" :width="resume ? 12 : 14" />
            <router-link v-if="resume" :to="lessonPath(course.type, courseStep(course) ?? 1)" class="course-link">
              {{ courseStep(course) ? `接着学第 ${courseStep(course)} 课` : '从第 1 课开始' }}
              <Icon icon="ph:caret-right-bold" :width="13" />
            </router-link>
          </div>
          <n-button v-if="!resume" type="primary" icon-placement="right" @click="router.push(lessonPath(course.type, 1))">
            <template #icon><Icon icon="ph:caret-right-bold" /></template>
            开始学
          </n-button>
        </section>
      </div>

      <div class="tabs" role="tablist">
        <button
          v-for="course in courses.filter((c) => c.titles.length)"
          :key="course.type"
          type="button"
          role="tab"
          class="tab"
          :class="{ on: tab === course.type }"
          :aria-selected="tab === course.type"
          @click="pickTab(course.type)"
        >
          {{ course.label }}
          <span class="tab-sub">
            {{
              userStore.isAuthed && doneCount(course.titles, course.progress)
                ? `学完 ${doneCount(course.titles, course.progress)}/${course.titles.length}`
                : `${course.titles.length} 课`
            }}
          </span>
        </button>
        <span class="grow" />
        <button v-if="!userStore.isAuthed" type="button" class="login" @click="authModal.openLoginModal()">登录后记下学到哪</button>
        <div v-if="isDesktop && userStore.isTeacherOrAbove" class="admin-links">
          <AdminLink to="/admin/learn" size="small">自学情况</AdminLink>
          <AdminLink v-if="userStore.isSuperAdmin" :to="{ path: '/admin/tutorial/list', query: { type: tab } }" size="small"> 管理教程 </AdminLink>
        </div>
      </div>

      <div v-if="current && isDesktop" class="map">
        <section v-for="group in groups" :key="group.lessons[0]!.id" class="project card">
          <div class="project-head">
            <ProjectTile :icon="group.icon" :tone="group.tone" />
            <span class="project-name">
              <span v-if="group.no" class="muted small">{{ group.no }}</span>
              <span class="project-title">{{ group.name }}</span>
            </span>
            <span
              v-if="
                userStore.isAuthed &&
                doneIn(
                  current,
                  group.lessons.map((l) => l.id),
                ) === group.lessons.length
              "
              class="project-count all"
            >
              <Icon icon="ph:check-bold" :width="13" />{{ group.lessons.length }}/{{ group.lessons.length }}
            </span>
            <span
              v-else-if="
                userStore.isAuthed &&
                doneIn(
                  current,
                  group.lessons.map((l) => l.id),
                )
              "
              class="project-count"
            >
              {{
                doneIn(
                  current,
                  group.lessons.map((l) => l.id),
                )
              }}/{{ group.lessons.length }}
            </span>
            <span v-else class="project-count">{{ group.lessons.length }} 课</span>
          </div>
          <LessonRow
            v-for="lesson in group.lessons"
            :key="lesson.id"
            :title="lesson.title"
            :step="lesson.step"
            :to="lessonPath(current.type, lesson.step)"
            :progress="current.progress[lesson.id]"
            :active="resume?.course.type === current.type && resume.step === lesson.step"
            :height="48"
          />
        </section>
      </div>
      <ProjectTree
        v-else-if="current"
        :groups="groups"
        :progress="current.progress"
        :type="current.type"
        :current-step="resume?.course.type === current.type ? resume.step : 0"
        big
      />
      <n-empty v-if="!courses.some((c) => c.titles.length)" description="还没有公开的教程" style="margin-top: 80px" />
    </template>
    <n-spin v-else class="spin" />
  </div>
</template>

<style scoped>
.home {
  max-width: 1286px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.muted {
  opacity: 0.6;
}
.sec {
  opacity: 0.8;
}
.small {
  font-size: 13px;
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
.card {
  border: 1px solid var(--learn-line);
  border-radius: 8px;
}
.top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 20px;
}
.top.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.resume {
  border: 1px solid var(--learn-green-line);
  background: var(--learn-green-bg);
  border-radius: 10px;
  padding: 20px 26px;
  display: flex;
  align-items: center;
  gap: 24px;
}
.resume-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.resume-meta {
  display: flex;
  gap: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}
.resume-label {
  color: var(--learn-green-text);
  font-weight: 700;
}
.resume-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.resume-kp {
  font-size: 26px;
  font-weight: 700;
}
.resume-scene {
  font-size: 15px;
  opacity: 0.8;
}
.resume-progress {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 6px;
  font-size: 13px;
}
.course {
  padding: 18px 22px;
  display: flex;
  align-items: center;
  gap: 20px;
}
.course-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.course-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.course-name {
  font-size: 18px;
  font-weight: 700;
}
.first {
  display: flex;
  gap: 6px;
  font-size: 14px;
  flex-wrap: wrap;
}
.first-kp {
  font-weight: 600;
}
.course-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--learn-green-text);
  text-decoration: none;
}
.tabs {
  display: flex;
  align-items: stretch;
  gap: 24px;
  height: 40px;
  border-bottom: 1px solid var(--learn-line);
}
.tab {
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 15px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 0;
}
.tab.on {
  color: var(--learn-green-text);
  font-weight: 700;
  border-bottom-color: var(--learn-green);
}
.tab-sub {
  font-size: 13px;
  font-weight: 400;
  opacity: 0.6;
}
.admin-links {
  display: flex;
  align-items: center;
  gap: 8px;
}
.login {
  border: 0;
  background: transparent;
  color: var(--learn-green-text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.map {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
@media (max-width: 1180px) {
  .map {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .top {
    grid-template-columns: minmax(0, 1fr);
  }
}
.project {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.project-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 10px;
}
.project-name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.project-title {
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.project-count {
  font-size: 13px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.project-count.all {
  opacity: 1;
  color: var(--learn-green-text);
  font-weight: 600;
}

@media (max-width: 768px) {
  .home {
    gap: 14px;
  }
  .top,
  .top.two {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .resume {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 14px 16px;
  }
  .resume-kp {
    font-size: 22px;
  }
  .resume-go {
    width: 100%;
  }
  .course {
    padding: 14px 16px;
  }
  .tabs {
    gap: 20px;
  }
}
</style>

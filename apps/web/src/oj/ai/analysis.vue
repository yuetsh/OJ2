<script setup lang="ts">
import {
  LEARNING_PERIOD_LABELS,
  learningPeriodSchema,
  type LearningPeriod,
  type LearningReport,
} from "@oj2/contract"
import { useRouteQuery } from "@vueuse/router"
import { useThemeVars } from "naive-ui"
import { useBreakpoints } from "shared/composables/breakpoints"
import AdminLink from "shared/components/AdminLink.vue"
import { useUserStore } from "shared/store/user"
import UserName from "shared/components/UserName.vue"
import { classLabel } from "utils/classes"
import { parseTime } from "utils/functions"
import { getLearningReport } from "../api"
import AiSummary from "./components/AiSummary.vue"
import ErrorsCard from "./components/ErrorsCard.vue"
import KnowledgeCard from "./components/KnowledgeCard.vue"
import LessonDays from "./components/LessonDays.vue"
import StatStrip from "./components/StatStrip.vue"
import UnsolvedCard from "./components/UnsolvedCard.vue"
import { dayLabel, isDone } from "./utils"

const theme = useThemeVars()
const userStore = useUserStore()
const { isDesktop } = useBreakpoints()

const urlUsername = useRouteQuery<string>("username", "")
const urlPeriod = useRouteQuery<string>("period", "term")
const period = computed<LearningPeriod>(() => {
  const parsed = learningPeriodSchema.safeParse(urlPeriod.value)
  return parsed.success ? parsed.data : "term"
})
const PERIODS = Object.entries(LEARNING_PERIOD_LABELS) as [LearningPeriod, string][]

/** 老师看别人。学生在地址栏写了别人的名字，后端也只会给他自己的 */
const viewing = computed(() =>
  userStore.isTeacherOrAbove && urlUsername.value && urlUsername.value !== userStore.user?.username
    ? urlUsername.value
    : undefined,
)

const report = ref<LearningReport | null>(null)
const loading = ref(false)
const notFound = ref(false)
/** 这段时间一道没交时，再拿一份「全部」的，说说上一节课和还差的题 */
const before = ref<LearningReport | null>(null)

async function load() {
  const want = { period: period.value, username: viewing.value }
  loading.value = true
  notFound.value = false
  before.value = null
  try {
    const data = await getLearningReport(want.period, want.username)
    if (want.period !== period.value || want.username !== viewing.value) return
    report.value = data
    if (!data.days.length && want.period !== "all")
      before.value = await getLearningReport("all", want.username)
  } catch {
    report.value = null
    notFound.value = true
  } finally {
    loading.value = false
  }
}

watch([period, viewing], load, { immediate: true })

const span = computed(() => {
  const r = report.value
  if (!r) return ""
  if (!r.start) return ""
  const from = parseTime(r.start, "M月D日")
  const to = parseTime(r.end, "M月D日")
  return from === to ? from : `${from} – ${to}`
})

const emptyHint = computed(() => {
  const last = before.value?.days.find((day) => day.lesson.length)
  if (!last) return ""
  const { date, weekday } = dayLabel(last.day)
  return `上一节课是 ${date} ${weekday}，做对了 ${last.lesson.filter(isDone).length} / ${last.lesson.length} 道`
})
const longer = computed(() => PERIODS.slice(PERIODS.findIndex(([key]) => key === period.value) + 1))

const searchName = ref("")
watch(viewing, (value) => (searchName.value = value ?? ""), { immediate: true })
function goStudent(username: string | null | undefined) {
  if (username) urlUsername.value = username
}
</script>

<template>
  <div class="oj-page ai-page">
    <div class="toolbar" :class="{ single: !isDesktop }">
      <h2>智能分析</h2>
      <div v-if="viewing" class="who">
        <n-button
          :disabled="!report?.neighbors?.prev"
          aria-label="上一个学生"
          @click="goStudent(report?.neighbors?.prev)"
        >
          ‹
        </n-button>
        <n-input
          v-model:value="searchName"
          class="who-input"
          placeholder="用户名"
          @keyup.enter="goStudent(searchName.trim())"
        />
        <n-button
          :disabled="!report?.neighbors?.next"
          aria-label="下一个学生"
          @click="goStudent(report?.neighbors?.next)"
        >
          ›
        </n-button>
        <span v-if="report?.className" class="muted">{{ classLabel(report.className) }}</span>
      </div>
      <div class="seg" role="group" aria-label="时间">
        <button
          v-for="[key, label] in PERIODS"
          :key="key"
          :class="{ on: period === key }"
          @click="urlPeriod = key"
        >
          {{ label }}
        </button>
      </div>
      <span v-if="isDesktop && span" class="muted">{{ span }}</span>
      <span class="grow"></span>
      <router-link
        v-if="viewing"
        :to="{ path: '/submission', query: { username: viewing, exactUsername: '1' } }"
        class="link"
      >
        看<UserName :username="viewing" />的提交 ›
      </router-link>
      <AdminLink
        v-if="userStore.isTeacherOrAbove && isDesktop"
        :to="{ path: '/admin/ai/reports', query: viewing ? { username: viewing } : {} }"
        size="small"
      >
        AI 报告
      </AdminLink>
    </div>

    <n-spin :show="loading" :delay="150">
      <n-empty v-if="notFound" description="没有这个用户" class="blank" />

      <template v-else-if="report && !report.days.length">
        <section class="card blank">
          <b>{{ LEARNING_PERIOD_LABELS[period] }}{{ viewing ? "他" : "" }}还没交过题</b>
          <span v-if="emptyHint" class="muted">{{ emptyHint }}</span>
          <div class="actions">
            <n-button v-for="[key, label] in longer" :key="key" @click="urlPeriod = key">
              看{{ label }}
            </n-button>
          </div>
        </section>
        <section v-if="!viewing && before?.unsolved.length" class="card hint">
          <b>还有 {{ before.unsolved.length }} 道差一点的</b>
          <span class="muted names">{{
            before.unsolved.map((item) => item.title).join("、")
          }}</span>
          <a href="#" class="link" @click.prevent="urlPeriod = 'all'">去看看 ›</a>
        </section>
      </template>

      <div v-else-if="report" class="body">
        <StatStrip :report="report" :teacher="!!viewing" :compact="!isDesktop" />
        <div v-if="isDesktop" class="main">
          <div class="column">
            <LessonDays :days="report.days" :class-name="report.className" :username="viewing" />
            <AiSummary :period="period" :username="viewing" />
          </div>
          <div class="column">
            <UnsolvedCard
              v-if="report.unsolved.length"
              :items="report.unsolved"
              :username="viewing"
            />
            <ErrorsCard v-if="report.errors.length" :errors="report.errors" />
            <KnowledgeCard :knowledge="report.knowledge" />
          </div>
        </div>
        <template v-else>
          <UnsolvedCard
            v-if="report.unsolved.length"
            :items="report.unsolved"
            :username="viewing"
          />
          <LessonDays
            :days="report.days"
            :class-name="report.className"
            :username="viewing"
            compact
          />
          <ErrorsCard v-if="report.errors.length" :errors="report.errors" />
          <KnowledgeCard :knowledge="report.knowledge" />
          <AiSummary :period="period" :username="viewing" compact />
        </template>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.ai-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.toolbar h2 {
  margin: 0;
  font-size: var(--oj-fs-title);
}

.toolbar.single {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.toolbar.single .seg button {
  flex: 1;
}

.who {
  display: flex;
  align-items: center;
  gap: 6px;
}

.who-input {
  width: 160px;
}

.seg {
  display: inline-flex;
  height: var(--oj-ctrl-h);
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 4px;
  overflow: hidden;
}

.seg button {
  padding: 0 14px;
  border: 0;
  border-left: 1px solid v-bind("theme.borderColor");
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor2");
  font: inherit;
  font-size: var(--oj-fs-sec);
  cursor: pointer;
  white-space: nowrap;
}

.seg button:first-child {
  border-left: 0;
}

.seg button.on {
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
  font-weight: 600;
}

.grow {
  flex: 1;
}

.muted {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
}

.link {
  font-size: var(--oj-fs-sec);
  color: #18a058;
  text-decoration: none;
  white-space: nowrap;
}

.body,
.column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  align-items: start;
}

.card {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
}

.blank {
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.blank b {
  font-size: 18px;
}

.actions {
  display: flex;
  gap: 8px;
}

.hint {
  margin-top: 16px;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-color: rgba(240, 160, 32, 0.4);
  background: rgba(240, 160, 32, 0.06);
  font-size: var(--oj-fs-sec);
}

.names {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

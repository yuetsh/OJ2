<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import {
  NO_CLASS,
  type FlowchartStatistics,
  type SubmissionLessons,
  type SubmissionStatistics,
  type SubmissionStatisticsGrid,
} from "@oj2/contract"
import {
  getFlowchartStatistics,
  getSubmissionLessons,
  getSubmissionStatistics,
  getSubmissionStatisticsGrid,
} from "oj/api"
import { useConfigStore } from "shared/store/config"
import { fromPickerValue, toPickerValue } from "utils/functions"
import { useTone } from "oj/submission/composables/tone"
import { classSelectOptions } from "oj/submission/utils"
import { DEFAULT_PERIOD, PERIOD_OPTIONS, dayStartOfDate, periodRange, type Period } from "../period"
import { resultName, useResultColor } from "../results"
import ByClass from "./ByClass.vue"
import CodeStats from "./CodeStats.vue"
import Lessons from "./Lessons.vue"
import RingChart from "./RingChart.vue"
import StatItem from "./StatItem.vue"

/**
 * 统计的主体（设计稿「统计重设计 · 定稿 B」+「统计合二为一」B）。两处用它：提交列表里的弹框
 * （老师平时从这里看），和 /statistics 页面（课堂看板「回头看」、题目页之类从别处进来的，
 * 条件放在地址栏里能刷新、能转发）。
 *
 * 代码页签按条件分三种看法：
 * - 什么都没填：**一行一节课**（Lessons）。原来「今日统计」老师那一版并进来了，选「今天」
 *   就是它，选别的时间段也一样有
 * - 只填了题号：**按班级汇总**（ByClass）—— 题目页统计页签点进来就是这种，口径和那边的各班表一致
 * - 选了班或填了学生：左边题目、右边学生（CodeStats）
 * 从前两种点进去时左上角有「← 全部」回来。
 *
 * 分工：**课堂看板管这节课，这里管回头看**（用户定的）。所以不自动刷新、没有
 * 投影用的大字名单和请假隐藏 —— 那些在看板上。课堂统计一般看一两节课，时间段默认「一节课」。
 *
 * 查询条件都是 v-model：页面接地址栏，弹框接提交列表那边的一份本地状态。
 */
const FlowStats = defineAsyncComponent(() => import("./FlowStats.vue"))

const props = defineProps<{
  /** 在弹框里：右上角多一个关闭；「在提交列表里看」由外面接住，改的是背后那张列表 */
  modal?: boolean
}>()

const emit = defineEmits<{
  close: []
  /** 「在提交列表里看」：带着现在的条件回提交列表（query 是提交列表的地址栏参数） */
  list: [query: Record<string, string>]
}>()

const configStore = useConfigStore()
const theme = useThemeVars()
const tone = useTone()
const resultColor = useResultColor()

const tab = defineModel<string>("tab", { default: "code" })
const className = defineModel<string>("className", { default: "" })
const username = defineModel<string>("username", { default: "" })
const problem = defineModel<string>("problem", { default: "" })
const period = defineModel<string>("period", { default: DEFAULT_PERIOD })
const from = defineModel<string>("from", { default: "" })
const to = defineModel<string>("to", { default: "" })

/** 地址栏里的 from / to 是手改过、不是数字的话当没选（不然 toISOString 抛错整页空白） */
const custom = computed<[number, number] | null>(() => {
  const a = Number(from.value)
  const b = Number(to.value)
  return from.value && to.value && Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null
})

const periodValue = computed<Period>(() => {
  // 「那节课」要带着精确的起止时刻，地址栏里缺了就退回默认
  if (period.value === "lesson") return custom.value ? "lesson" : DEFAULT_PERIOD
  return PERIOD_OPTIONS.some((option) => option.value === period.value)
    ? (period.value as Period)
    : DEFAULT_PERIOD
})

/** 从「一行一节课」点进某一节课时，下拉里临时多一项「那节课」 */
const periodOptions = computed(() => [
  ...(periodValue.value === "lesson" ? [{ label: "那节课", value: "lesson" }] : []),
  ...PERIOD_OPTIONS.map((o) => ({ label: o.label, value: o.value as string })),
])

/** n-date-picker 按浏览器时区渲染，存取都要平移到东八区（见 utils/functions 的注释） */
const pickerValue = computed<[number, number] | null>(() =>
  custom.value ? [toPickerValue(custom.value[0]), toPickerValue(custom.value[1])] : null,
)
function pickDates(value: [number, number] | null) {
  if (!value) {
    from.value = ""
    to.value = ""
    return
  }
  from.value = String(fromPickerValue(value[0]))
  to.value = String(fromPickerValue(value[1]))
}

/** 学生框：包含匹配。班级另外单独传（按 class_name 精确匹配，见后端 scopedUsers） */
const studentParam = computed(() => username.value.trim())

const classOptions = computed(() =>
  classSelectOptions(configStore.config?.classList ?? [], className.value),
)

// ---------- 取数 ----------

const loading = ref(false)
const failed = ref("")
const stats = ref<SubmissionStatistics | null>(null)
const grid = ref<SubmissionStatisticsGrid | null>(null)
const lessons = ref<SubmissionLessons | null>(null)
const flow = ref<FlowchartStatistics | null>(null)

type Mode = "lessons" | "byClass" | "people"
/** 三种看法，见顶上的注释 */
const mode = computed<Mode>(() =>
  className.value || studentParam.value ? "people" : problem.value.trim() ? "byClass" : "lessons",
)

/** 一次列几节课，「更早的课」每点一次多 50 节 */
const LESSON_PAGE = 50
const lessonLimit = ref(LESSON_PAGE)
const loadingMore = ref(false)

/**
 * 这一份数据是按什么条件查出来的。页面上的标签（按班级汇总还是看人、「做完」还是
 * 「做对过题」、时间范围那句话）跟着它走，不跟着输入框 —— 老师边打字边看时，数据还是
 * 上一次的，标签先变了就对不上
 */
const shown = ref<{ mode: Mode; explicit: boolean; rangeText: string; withinToday: boolean }>({
  mode: "lessons",
  explicit: false,
  rangeText: "",
  withinToday: false,
})
let seq = 0

const ERROR_TEXT: Record<string, string> = {
  "problem-not-found": "有题号找不到，检查一下是不是打错了",
  "invalid-request": "一次最多查 20 道题",
}

async function load() {
  const current = ++seq
  const range = periodRange(periodValue.value, custom.value)
  const duration = { start: range.start, end: range.end }
  const snapshot = {
    mode: mode.value,
    explicit: !!problem.value.trim(),
    rangeText: range.text,
    withinToday: range.withinToday,
  }
  loading.value = true
  failed.value = ""
  try {
    if (tab.value === "flow") {
      const res = await getFlowchartStatistics(
        duration,
        problem.value,
        studentParam.value,
        className.value,
      )
      if (current !== seq) return
      flow.value = res
    } else if (snapshot.mode === "lessons") {
      // 一行一节课不要方块串：那个接口最多 5000 条，课在后端切
      lessonLimit.value = LESSON_PAGE
      const [s, l] = await Promise.all([
        getSubmissionStatistics(duration, problem.value, studentParam.value, className.value),
        getSubmissionLessons(duration, lessonLimit.value),
      ])
      if (current !== seq) return
      stats.value = s
      lessons.value = l
    } else {
      const [s, g] = await Promise.all([
        getSubmissionStatistics(duration, problem.value, studentParam.value, className.value),
        getSubmissionStatisticsGrid(duration, problem.value, studentParam.value, className.value),
      ])
      if (current !== seq) return
      stats.value = s
      grid.value = g
    }
    shown.value = snapshot
  } catch (error) {
    if (current !== seq) return
    // 失败了就别留着上一次的结果配这一次的条件 —— 清掉，说清楚为什么
    stats.value = null
    grid.value = null
    lessons.value = null
    flow.value = null
    const code = (error as { error?: string })?.error ?? ""
    failed.value = ERROR_TEXT[code] ?? "没拉下来，改一下条件再试"
  } finally {
    if (current === seq) loading.value = false
  }
}

/** 「更早的课」：只重拉课那一份，数字行不动 */
async function loadMore() {
  const current = seq
  loadingMore.value = true
  try {
    const range = periodRange(periodValue.value, custom.value)
    const next = await getSubmissionLessons(
      { start: range.start, end: range.end },
      lessonLimit.value + LESSON_PAGE,
    )
    if (current !== seq) return
    lessonLimit.value += LESSON_PAGE
    lessons.value = next
  } catch {
    if (current === seq) failed.value = "更早的课没拉下来，再点一次试试"
  } finally {
    loadingMore.value = false
  }
}

onMounted(load)
watch([tab, className, periodValue, custom], load)
watchDebounced([username, problem], load, { debounce: 600, maxWait: 1500 })

// ---------- 数字行（代码） ----------

const doneCount = computed(() => stats.value?.data.filter((row) => row.done).length ?? 0)
/**
 * 没填题号时后端的「做完」是「至少做对一道」—— 一个月里零零散散几十道题，谈不上
 * 「全做完」。这时各处都叫「做对过题」（CodeStats、ByClass 同一个口径）
 */
const hasProblems = computed(() => shown.value.explicit)
const personCount = computed(() => stats.value?.personCount ?? 0)
const judged = computed(() =>
  stats.value ? stats.value.submissionCount - stats.value.judgingCount : 0,
)

// ---------- 右上角的入口 ----------

/**
 * 1366 以下（机房 1280 的屏）「在提交列表里看」只留图标。弹框比屏幕窄一圈、还多一个关闭，
 * 1366 的屏上整排放不下，所以弹框里宽一档才出字。
 * 原来旁边还有一个「这节课去课堂看板」：顶栏已经有看板，统计里再放一个成了干扰项（用户说的），
 * 现在只在有班正在上课时，在课的列表上方引过去
 */
const narrow = useMediaQuery(props.modal ? "(max-width: 1439px)" : "(max-width: 1365px)")

function openList() {
  emit("list", {
    ...(tab.value === "flow" ? { language: "Flowchart" } : {}),
    ...(className.value ? { className: className.value } : {}),
    ...(studentParam.value ? { username: studentParam.value } : {}),
    ...(problem.value ? { problem: problem.value } : {}),
    ...(shown.value.withinToday ? { today: "1" } : {}),
  })
}

// ---------- 点进去 / 回来 ----------

type Snapshot = Record<"className" | "username" | "problem" | "period" | "from" | "to", string>
/** 从「一行一节课」或「按班级汇总」点进去之前的条件，「← 全部」拿它回去 */
const backTo = ref<Snapshot | null>(null)

function remember() {
  backTo.value = {
    className: className.value,
    username: username.value,
    problem: problem.value,
    period: period.value,
    from: from.value,
    to: to.value,
  }
}

function goBack() {
  const snap = backTo.value
  if (!snap) return
  backTo.value = null
  className.value = snap.className
  username.value = snap.username
  problem.value = snap.problem
  period.value = snap.period
  from.value = snap.from
  to.value = snap.to
}

// 自己把条件清回了总览，就不用再显示「← 全部」
watch(mode, (value) => {
  if (value === "lessons") backTo.value = null
})

function pickClass(value: string) {
  remember()
  className.value = value
  username.value = ""
}

/** 点一节课：这个班、这节课的题、这节课第一条到最后一条（多留 1 秒：库里存到微秒，转成毫秒会截掉零头） */
function pickLesson(lesson: SubmissionLessons["lessons"][number]) {
  remember()
  className.value = lesson.className ?? NO_CLASS
  username.value = ""
  problem.value = lesson.problems.join(" ")
  from.value = String(Date.parse(lesson.start))
  to.value = String(Date.parse(lesson.end) + 1000)
  period.value = "lesson"
}

/** 点某天的零散提交：这个班（或没填班级的）那一整天，题号不限 —— 补做、课后练的都在里面 */
function pickScattered(item: SubmissionLessons["scattered"][number]) {
  remember()
  className.value = item.className ?? NO_CLASS
  username.value = ""
  problem.value = ""
  const day = String(dayStartOfDate(item.day))
  from.value = day
  to.value = day
  period.value = "custom"
}

/** 点「错得最多的题」里的一道：只看这道，按班级汇总 */
function pickProblem(displayId: string) {
  remember()
  problem.value = displayId
}

// ---------- 数字行的结果条 ----------

const results = computed(() => stats.value?.results ?? [])
function resultWidth(value: number) {
  const total = stats.value?.submissionCount ?? 0
  return total ? `${(value / total) * 100}%` : "0"
}
</script>

<template>
  <div class="stats" :class="{ modal }">
    <div class="filters">
      <span class="title">统计</span>
      <button v-if="backTo" type="button" class="back" title="回到点进来之前" @click="goBack">
        <Icon icon="ph:caret-left-bold" :width="13" />全部
      </button>
      <n-radio-group v-model:value="tab" size="small">
        <n-radio-button value="code">代码</n-radio-button>
        <n-radio-button value="flow">流程图</n-radio-button>
      </n-radio-group>
      <span class="vsep"></span>
      <n-select
        :value="className || null"
        class="w-class"
        size="small"
        :options="classOptions"
        placeholder="全部班级"
        clearable
        filterable
        @update:value="(v: string | null) => (className = v ?? '')"
      />
      <n-input v-model:value="username" class="w-user" size="small" clearable placeholder="学生">
        <template #prefix><Icon icon="ph:magnifying-glass" /></template>
      </n-input>
      <n-input
        v-model:value="problem"
        class="w-problem"
        size="small"
        clearable
        placeholder="题号，几道用空格隔开"
      >
        <template #prefix><Icon icon="ph:hash" /></template>
      </n-input>
      <n-select
        :value="periodValue"
        class="w-period"
        size="small"
        :options="periodOptions"
        :consistent-menu-width="false"
        @update:value="(v: string) => (period = v)"
      />
      <n-date-picker
        v-if="periodValue === 'custom'"
        :value="pickerValue"
        type="daterange"
        size="small"
        class="w-dates"
        clearable
        @update:value="pickDates"
      />
      <span v-else class="range">{{ shown.rangeText }}</span>
      <n-spin v-if="loading" :size="14" />
      <n-text v-if="failed" type="error" class="range">{{ failed }}</n-text>
      <span v-if="periodValue === 'custom' && !custom" class="range"
        >选一下开始和结束的日子，没选先按今天算</span
      >
      <span class="spacer"></span>
      <n-button size="small" title="在提交列表里看" aria-label="在提交列表里看" @click="openList">
        <template #icon><Icon icon="ph:arrow-square-out" /></template>
        <template v-if="!narrow">在提交列表里看</template>
      </n-button>
      <button v-if="modal" type="button" class="close" aria-label="关闭" @click="emit('close')">
        <Icon icon="ph:x" :width="18" />
      </button>
    </div>

    <template v-if="tab === 'flow'">
      <FlowStats v-if="flow" :data="flow" />
    </template>

    <template v-else-if="stats && (shown.mode === 'lessons' ? lessons : grid)">
      <div class="summary">
        <StatItem label="提交" :value="stats.submissionCount" unit="条" />
        <StatItem
          label="正确率"
          :value="stats.submissionCount ? `${Math.round(stats.correctRate)}%` : '—'"
          :unit="stats.judgingCount ? `判题中 ${stats.judgingCount}` : ''"
        />
        <template v-if="shown.mode === 'lessons' && lessons">
          <StatItem label="交过的人" :value="stats.data.length" unit="人" />
          <StatItem
            label="上了几节课"
            :value="`${lessons.lessons.length}${lessons.hasMore ? '+' : ''}`"
            unit="节"
          />
        </template>
        <template v-if="personCount">
          <StatItem
            :label="hasProblems ? '做完' : '做对过题'"
            :value="`${doneCount} / ${personCount}`"
            unit="人"
            tone="success"
          />
          <StatItem
            v-if="hasProblems"
            label="完成度"
            :value="`${personCount ? Math.round((doneCount / personCount) * 100) : 0}%`"
          />
          <StatItem label="一道没交" :value="stats.dataUnaccepted.length" unit="人" tone="error" />
        </template>
        <StatItem
          :label="hasProblems ? '交了没全对' : '一道没做对'"
          :value="stats.dataAttempted.length"
          unit="人"
          tone="warning"
        />
        <span class="spacer"></span>
        <div v-if="results.length" class="result-bar">
          <div class="result-track">
            <span
              v-for="item in results"
              :key="item.result"
              :style="{ width: resultWidth(item.count), background: resultColor(item.result) }"
              :title="`${resultName(item.result)} ${item.count}`"
            ></span>
          </div>
          <div class="result-legend">
            <span v-for="item in results.slice(0, 3)" :key="item.result">
              <i :style="{ background: resultColor(item.result) }"></i>{{ resultName(item.result) }}
              <b>{{ item.count }}</b>
            </span>
          </div>
        </div>
        <span class="ring-wrap">
          <RingChart
            :value="stats.acceptedCount"
            :total="judged"
            :color="tone('success').solid"
            :labels="['正确', '没对']"
          />
          <span class="ring-label">提交<br />正确率</span>
        </span>
        <span v-if="personCount && hasProblems" class="ring-wrap">
          <RingChart
            :value="doneCount"
            :total="personCount"
            :color="tone('info').solid"
            :labels="['做完', '没做完']"
          />
          <span class="ring-label">班级<br />完成度</span>
        </span>
      </div>
      <Lessons
        v-if="shown.mode === 'lessons' && lessons"
        :data="lessons"
        :timeline="shown.withinToday"
        :loading-more="loadingMore"
        @pick="pickLesson"
        @scattered="pickScattered"
        @problem="pickProblem"
        @more="loadMore"
      />
      <ByClass
        v-else-if="shown.mode === 'byClass' && grid"
        :grid="grid"
        :explicit="shown.explicit"
        @pick="pickClass"
      />
      <CodeStats v-else-if="grid" :stats="stats" :grid="grid" :explicit="shown.explicit" />
    </template>
  </div>
</template>

<style scoped>
/* 高度由外面给（页面铺满顶栏以下、弹框按屏幕高），里面几栏各自滚动 */
.stats {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: v-bind("theme.cardColor");
}

/* 弹框：四周留 24，和今日统计同一种圆角卡片 */
.stats.modal {
  width: calc(100vw - 48px);
  max-width: 1480px;
  height: calc(100vh - 48px);
  border-radius: 12px;
  box-shadow: v-bind("theme.boxShadow3");
  overflow: hidden;
}

.filters {
  height: 52px;
  flex: none;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.title {
  font-size: 17px;
  font-weight: 700;
  margin-right: 6px;
}

.back {
  height: 28px;
  padding: 0 10px 0 6px;
  border: 0;
  border-radius: 4px;
  font: inherit;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  color: v-bind("theme.textColor2");
  background: v-bind("theme.actionColor");
}

.back:hover {
  color: v-bind("theme.primaryColor");
}

.result-bar {
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-track {
  display: flex;
  height: 8px;
  border-radius: 3px;
  overflow: hidden;
  gap: 1px;
}

.result-legend {
  display: flex;
  gap: 10px;
  font-size: 12px;
  white-space: nowrap;
  color: v-bind("theme.textColor2");
}

.result-legend i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 4px;
}

.vsep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: v-bind("theme.dividerColor");
}

.w-class {
  width: 132px;
}
.w-user {
  width: 110px;
}
.w-problem {
  width: 220px;
}
.w-period {
  width: 150px;
}
.w-dates {
  width: 240px;
}

@media (max-width: 1365px) {
  .w-problem {
    width: 190px;
  }
}

.range {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.spacer {
  flex: 1 1 0;
}

.close {
  width: 32px;
  height: 32px;
  margin-right: -8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: v-bind("theme.textColor2");
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.close:hover {
  background: v-bind("theme.actionColor");
}

.summary {
  height: 72px;
  flex: none;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 36px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  background: v-bind("theme.actionColor");
}

.ring-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ring-label {
  font-size: 12px;
  line-height: 1.5;
  color: v-bind("theme.textColor3");
}

/* 手机：老师很少在手机上看统计，只保证不坏 —— 筛选和数字行折行，整页自然滚动 */
@media (max-width: 767px) {
  .stats:not(.modal) {
    height: auto;
  }

  .filters,
  .summary {
    height: auto;
    flex-wrap: wrap;
    padding: 10px 14px;
    row-gap: 10px;
    white-space: normal;
  }

  .summary {
    gap: 12px 24px;
  }

  .vsep,
  .spacer {
    display: none;
  }

  .w-class,
  .w-user,
  .w-period {
    width: calc(50% - 4px);
  }

  .w-problem,
  .w-dates {
    width: 100%;
  }
}
</style>

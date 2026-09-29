<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { useRouteQuery } from "@vueuse/router"
import type {
  FlowchartStatistics,
  SubmissionStatistics,
  SubmissionStatisticsGrid,
} from "@oj2/contract"
import {
  getFlowchartStatistics,
  getSubmissionStatistics,
  getSubmissionStatisticsGrid,
} from "oj/api"
import { useConfigStore } from "shared/store/config"
import { fromPickerValue, toPickerValue } from "utils/functions"
import { useTone } from "oj/submission/composables/tone"
import { classLabel } from "oj/submission/utils"
import ByClass from "./components/ByClass.vue"
import CodeStats from "./components/CodeStats.vue"
import RingChart from "./components/RingChart.vue"
import StatItem from "./components/StatItem.vue"
import { DEFAULT_PERIOD, PERIOD_OPTIONS, periodRange, type Period } from "./period"

/**
 * 数据统计（设计稿「统计重设计 · 定稿 B」）。从提交列表、题目页的弹框改成独立页面。
 *
 * 分工：**课堂看板管这节课，这里管回头看**（用户定的）。所以这页不自动刷新、没有
 * 投影用的大字名单和请假隐藏 —— 那些在看板上。课堂统计一般看一两节课，时间段默认「两节课」。
 *
 * 查询条件都在地址栏里：从提交列表、题目页带过来，刷新、转发给别的老师都还是这一份。
 */
const FlowStats = defineAsyncComponent(() => import("./components/FlowStats.vue"))

const router = useRouter()
const configStore = useConfigStore()
const theme = useThemeVars()
const tone = useTone()
const message = useMessage()

const tab = useRouteQuery<string>("tab", "code", { mode: "replace" })
const className = useRouteQuery<string>("className", "", { mode: "replace" })
const username = useRouteQuery<string>("username", "", { mode: "replace" })
const problem = useRouteQuery<string>("problem", "", { mode: "replace" })
const period = useRouteQuery<string>("period", DEFAULT_PERIOD, { mode: "replace" })
const from = useRouteQuery<string>("from", "", { mode: "replace" })
const to = useRouteQuery<string>("to", "", { mode: "replace" })

const periodValue = computed<Period>(() =>
  PERIOD_OPTIONS.some((option) => option.value === period.value)
    ? (period.value as Period)
    : DEFAULT_PERIOD,
)

const custom = computed<[number, number] | null>(() =>
  from.value && to.value ? [Number(from.value), Number(to.value)] : null,
)

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

/**
 * 统计接口的「用户名」是 ilike：填 `ks253` 圈一个班。选了班级又填了学生时按学生查，
 * 学生名字不带班级前缀的话补上，免得别的班重名的混进来
 */
const usernameParam = computed(() => {
  const name = username.value.trim()
  if (name) {
    return className.value && !name.toLowerCase().startsWith("ks")
      ? `ks${className.value}${name}`
      : name
  }
  return className.value ? `ks${className.value}` : ""
})

/** 没选班级、没填学生：先按班级汇总（多半是从题目页进来的） */
const byClass = computed(() => !usernameParam.value)

const classOptions = computed(() => {
  const list = configStore.config?.classList ?? []
  const all = className.value && !list.includes(className.value) ? [className.value, ...list] : list
  return all.map((item) => ({ label: classLabel(item), value: item }))
})

// ---------- 取数 ----------

const loading = ref(false)
const failed = ref(false)
const stats = ref<SubmissionStatistics | null>(null)
const grid = ref<SubmissionStatisticsGrid | null>(null)
const flow = ref<FlowchartStatistics | null>(null)
const rangeText = ref("")
const withinToday = ref(false)
let seq = 0

async function load() {
  const current = ++seq
  const range = periodRange(periodValue.value, custom.value)
  rangeText.value = range.text
  withinToday.value = range.withinToday
  const duration = { start: range.start, end: range.end }
  loading.value = true
  failed.value = false
  try {
    if (tab.value === "flow") {
      const res = await getFlowchartStatistics(duration, problem.value, usernameParam.value)
      if (current !== seq) return
      flow.value = res
    } else {
      const [s, g] = await Promise.all([
        getSubmissionStatistics(duration, problem.value, usernameParam.value),
        getSubmissionStatisticsGrid(duration, problem.value, usernameParam.value),
      ])
      if (current !== seq) return
      stats.value = s
      grid.value = g
    }
  } catch (error) {
    if (current !== seq) return
    failed.value = true
    // 题号打错是最常见的：后端 404 problem-not-found
    const code = (error as { error?: string })?.error
    if (code === "problem-not-found") message.warning("有题号找不到，检查一下是不是打错了")
  } finally {
    if (current === seq) loading.value = false
  }
}

onMounted(load)
watch([tab, className, periodValue, custom], load)
watchDebounced([username, problem], load, { debounce: 600, maxWait: 1500 })

// ---------- 数字行（代码） ----------

const doneCount = computed(() => stats.value?.data.filter((row) => row.done).length ?? 0)
/**
 * 没填题号时后端的「做完」是「至少做对一道」—— 一个月里零零散散几十道题，谈不上
 * 「全做完」。这时这一格叫「做对过题」，别和左边「全部 N 道 · 做完 0 人」打架
 */
const hasProblems = computed(() => !!problem.value.trim())
const personCount = computed(() => stats.value?.personCount ?? 0)
const judged = computed(() =>
  stats.value ? stats.value.submissionCount - stats.value.judgingCount : 0,
)

// ---------- 两个入口 ----------

/** 1366 以下（机房 1280 的屏）右上两个入口只留图标 */
const narrow = useMediaQuery("(max-width: 1365px)")

function openList() {
  const href = router.resolve({
    name: "submissions",
    query: {
      ...(tab.value === "flow" ? { language: "Flowchart" } : {}),
      ...(className.value && !username.value ? { className: className.value } : {}),
      ...(username.value ? { username: usernameParam.value } : {}),
      ...(problem.value ? { problem: problem.value } : {}),
      ...(withinToday.value ? { today: "1" } : {}),
    },
  }).href
  window.open(href, "_blank")
}

function pickClass(value: string) {
  className.value = value
  username.value = ""
}
</script>

<template>
  <div class="page">
    <div class="filters">
      <span class="title">数据统计</span>
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
        :options="PERIOD_OPTIONS.map((o) => ({ label: o.label, value: o.value }))"
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
      <span v-else class="range">{{ rangeText }}</span>
      <n-spin v-if="loading" :size="14" />
      <n-text v-if="failed" type="error" class="range">没拉下来，改一下条件再试</n-text>
      <span class="spacer"></span>
      <n-button
        size="small"
        quaternary
        title="这节课去课堂看板"
        aria-label="这节课去课堂看板"
        @click="router.push('/classroom')"
      >
        <template #icon><Icon icon="ph:monitor" /></template>
        <template v-if="!narrow">这节课去课堂看板</template>
      </n-button>
      <n-button size="small" title="在提交列表里看" aria-label="在提交列表里看" @click="openList">
        <template #icon><Icon icon="ph:arrow-square-out" /></template>
        <template v-if="!narrow">在提交列表里看</template>
      </n-button>
    </div>

    <template v-if="tab === 'flow'">
      <FlowStats v-if="flow" :data="flow" />
    </template>

    <template v-else-if="stats && grid">
      <div class="summary">
        <StatItem label="提交" :value="stats.submissionCount" unit="条" />
        <StatItem
          label="正确率"
          :value="`${Math.round(stats.correctRate)}%`"
          :unit="stats.judgingCount ? `判题中 ${stats.judgingCount}` : ''"
        />
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
      <ByClass v-if="byClass" :grid="grid" @pick="pickClass" />
      <CodeStats v-else :stats="stats" :grid="grid" />
    </template>
  </div>
</template>

<style scoped>
/* 铺满顶栏以下，和提交列表同一个做法（负边距吃掉外层 16px） */
.page {
  margin: -16px;
  height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  background: v-bind("theme.cardColor");
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
</style>

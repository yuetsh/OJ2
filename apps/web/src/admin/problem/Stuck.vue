<script setup lang="ts">
import { useRouteQuery } from "@vueuse/router"
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { zonedParts } from "utils/functions"
import type { StuckProblem, StuckProblemDetail, StuckStudent } from "utils/types"
import { getStuckProblemDetail, getStuckProblems } from "admin/api"
import { useConfigStore } from "shared/store/config"
import UserName from "shared/components/UserName.vue"
import { classLabel, groupClassOptions } from "utils/classes"
import { periodRange, type Period } from "oj/statistics/period"
import { resultName, useResultColor } from "oj/statistics/results"
import { useBackClose } from "shared/composables/backClose"
import { useBreakpoints } from "shared/composables/breakpoints"
import "oj/learn/learn.css"

/**
 * 卡点分析（设计稿「卡点与趋势」页的定稿 StuckFinalAll / StuckFinalClass）：
 * 知识点 → 这个知识点下的题 → 一道题。
 *
 * 口径见后端 routes/admin/analytics.ts：人 × 题，「一次就对」= 第一次交就对的人占比，
 * 「平均交几次」只数做对那次及之前的。门槛（至少几人做过）在前端卡，知识点的汇总跟着门槛走 ——
 * 选了一个班时默认 10 人，相当于「课上布置过的」，不然会混进一两个人自己做的题。
 */
const router = useRouter()
const configStore = useConfigStore()
const { isMobile } = useBreakpoints()
const theme = useThemeVars()
const resultColor = useResultColor()

const PERIODS: { label: string; value: Period }[] = [
  { label: "这学期", value: "term" },
  { label: "最近 30 天", value: "30d" },
  { label: "最近 7 天", value: "7d" },
  { label: "全部", value: "all" },
]
const THRESHOLDS = [5, 10, 20, 50]

const className = useRouteQuery<string>("className", "", { mode: "replace" })
const period = useRouteQuery<string>("period", "term", { mode: "replace" })
const tag = useRouteQuery<string>("tag", "", { mode: "replace" })
const picked = useRouteQuery<string>("problem", "", { mode: "replace" })
const min = useRouteQuery<string>("min", "", { mode: "replace" })

const problems = ref<StuckProblem[]>([])
const detail = ref<StuckProblemDetail | null>(null)
const loading = ref(false)
const detailLoading = ref(false)

const classOptions = computed(() => groupClassOptions(configStore.config?.classList ?? []))
const threshold = computed(() => Number(min.value) || (className.value ? 10 : 20))
const thresholdOptions = computed(() =>
  THRESHOLDS.map((n) => ({ label: `至少 ${n} 人做过`, value: n })),
)

function rate(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0
}

function firstRate(row: StuckProblem) {
  return rate(row.firstTry, row.users)
}

function avgTries(row: { solved: number; solvedTries: number }) {
  return row.solved ? (row.solvedTries / row.solved).toFixed(1) : "-"
}

function range() {
  return periodRange(period.value as Period, null).start
}

const visible = computed(() => problems.value.filter((row) => row.users >= threshold.value))

/** 知识点：按门槛过滤后的题，人数加权；「全部」在最前，其余一次就对从低到高 */
const knowledge = computed(() => {
  const groups = new Map<string, { problems: number; users: number; firstTry: number }>()
  for (const row of visible.value) {
    for (const name of row.tags) {
      const group = groups.get(name) ?? { problems: 0, users: 0, firstTry: 0 }
      group.problems += 1
      group.users += row.users
      group.firstTry += row.firstTry
      groups.set(name, group)
    }
  }
  const all = visible.value.reduce(
    (sum, row) => ({ users: sum.users + row.users, firstTry: sum.firstTry + row.firstTry }),
    { users: 0, firstTry: 0 },
  )
  return [
    {
      name: "",
      label: "全部",
      problems: visible.value.length,
      rate: rate(all.firstTry, all.users),
    },
    ...[...groups]
      .map(([name, group]) => ({
        name,
        label: name,
        problems: group.problems,
        rate: rate(group.firstTry, group.users),
      }))
      .sort((a, b) => a.rate - b.rate || b.problems - a.problems),
  ]
})

const activeTag = computed(() =>
  knowledge.value.some((row) => row.name === tag.value) ? tag.value : "",
)

const list = computed(() =>
  visible.value
    .filter((row) => !activeTag.value || row.tags.includes(activeTag.value))
    .sort((a, b) => firstRate(a) - firstRate(b) || b.users - a.users),
)

const selected = computed(
  () => list.value.find((row) => String(row.id) === picked.value) ?? list.value[0] ?? null,
)

async function load() {
  loading.value = true
  try {
    problems.value = await getStuckProblems({
      className: className.value || undefined,
      start: range(),
    })
  } finally {
    loading.value = false
  }
}

let detailToken = 0
async function loadDetail() {
  const row = selected.value
  const token = ++detailToken
  if (!row) {
    detail.value = null
    return
  }
  detailLoading.value = true
  try {
    const data = await getStuckProblemDetail(row.id, {
      className: className.value || undefined,
      start: range(),
    })
    if (token === detailToken) detail.value = data
  } finally {
    if (token === detailToken) detailLoading.value = false
  }
}

/**
 * 手机上三栏放不下：知识点横着滑一排、题目列表占满一屏，点一道题，这道题的详情盖满整屏，
 * 按返回键回到列表
 */
const detailOpen = ref(false)
useBackClose(detailOpen, isMobile)
watch(isMobile, (mobile) => {
  if (!mobile) detailOpen.value = false
})

const route = useRoute()
async function pick(row: StuckProblem) {
  if (!isMobile.value) {
    picked.value = String(row.id)
    return
  }
  // 先把地址换好再打开：开着的时候 useBackClose 会拦下一切路由跳转（连 replace 也拦）
  await router.replace({ query: { ...route.query, problem: String(row.id) } })
  detailOpen.value = true
}

watch([className, period], load)
watch(() => [selected.value?.id, problems.value] as const, loadDetail)
onMounted(load)

// ---------------------------------------------------------------- 一道题

const students = computed(() => detail.value?.students ?? [])
const summary = computed(() => {
  const rows = students.value
  const solved = rows.filter((row) => row.solved)
  return {
    users: rows.length,
    firstRate: rate(rows.filter((row) => row.firstTry).length, rows.length),
    avgTries: avgTries({
      solved: solved.length,
      solvedTries: solved.reduce((sum, row) => sum + row.tries, 0),
    }),
    stuck: rows.length - solved.length,
  }
})

const errorTotal = computed(() =>
  (detail.value?.errors ?? []).reduce((sum, row) => sum + row.count, 0),
)

const byClass = computed(() => {
  const groups = new Map<string, StuckStudent[]>()
  for (const row of students.value) {
    const key = row.className ?? ""
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups]
    .map(([name, rows]) => {
      const solved = rows.filter((row) => row.solved)
      return {
        name,
        users: rows.length,
        rate: rate(rows.filter((row) => row.firstTry).length, rows.length),
        avgTries: avgTries({
          solved: solved.length,
          solvedTries: solved.reduce((sum, row) => sum + row.tries, 0),
        }),
        stuck: rows.length - solved.length,
      }
    })
    .sort((a, b) => b.users - a.users)
})

const BUCKETS = [
  { label: "1 次", min: 1, max: 1 },
  { label: "2 次", min: 2, max: 2 },
  { label: "3 次", min: 3, max: 3 },
  { label: "4–5 次", min: 4, max: 5 },
  { label: "6 次以上", min: 6, max: Infinity },
]
const distribution = computed(() => {
  const solved = students.value.filter((row) => row.solved)
  const rows = BUCKETS.map((bucket) => ({
    ...bucket,
    count: solved.filter((row) => row.tries >= bucket.min && row.tries <= bucket.max).length,
  }))
  const max = Math.max(1, ...rows.map((row) => row.count))
  return rows.map((row) => ({ ...row, height: Math.max(2, (row.count / max) * 64) }))
})

const mostTries = computed(() =>
  students.value
    .filter((row) => row.solved && row.tries >= 3)
    .sort((a, b) => b.tries - a.tries)
    .slice(0, 6),
)

const stuckStudents = computed(() =>
  students.value.filter((row) => !row.solved).sort((a, b) => b.tries - a.tries),
)

const currentYear = (() => {
  const now = zonedParts(new Date())!
  return now.month >= 9 ? now.year : now.year - 1
})()
const history = computed(() =>
  (detail.value?.history ?? []).map((row) => ({
    label: `${String(row.year).slice(2)}–${String(row.year + 1).slice(2)}`,
    current: row.year === currentYear,
    users: row.users,
    rate: rate(row.firstTry, row.users),
  })),
)

function gap(minutes: number | null) {
  if (minutes === null) return ""
  if (minutes < 1) return "不到 1 分钟"
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`
  return `隔了 ${Math.round(minutes / 1440)} 天`
}

function href(to: Parameters<typeof router.resolve>[0]) {
  return router.resolve(to).href
}

const links = computed(() => {
  const row = detail.value?.problem
  if (!row) return null
  const scope = className.value ? { className: className.value } : {}
  return {
    problem: href({ name: "problem", params: { problemID: row.displayId } }),
    statistics: href({
      name: "statistics",
      query: { problem: row.displayId, period: period.value, ...scope },
    }),
    submissions: href({ name: "submissions", query: { problem: row.displayId, ...scope } }),
  }
})
</script>

<template>
  <div class="page">
    <div class="top">
      <span class="title">卡点分析</span>
      <span class="grow" />
      <n-select
        :value="className || null"
        :options="classOptions"
        filterable
        clearable
        placeholder="全部班级"
        style="width: 170px"
        @update:value="(value: string | null) => (className = value ?? '')"
      />
      <div class="seg">
        <button
          v-for="option in PERIODS"
          :key="option.value"
          type="button"
          :class="{ on: period === option.value }"
          @click="period = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <n-spin :show="loading">
      <div class="main">
        <section class="card know">
          <div class="card-head">
            <span class="strong">知识点</span>
            <span class="grow" />
            <span class="muted small">一次就对</span>
          </div>
          <div class="know-list">
            <button
              v-for="row in knowledge"
              :key="row.name"
              type="button"
              class="item"
              :class="{ on: row.name === activeTag }"
              @click="tag = row.name"
            >
              <span class="line">
                <span class="name">{{ row.label }}</span>
                <span class="grow" />
                <span class="muted small num">{{ row.problems }} 道</span>
              </span>
              <span class="line">
                <span class="track"><span :style="{ width: `${row.rate}%` }" /></span>
                <span class="pct num">{{ row.rate }}%</span>
              </span>
            </button>
          </div>
        </section>

        <section class="card problems">
          <div class="card-head">
            <span class="strong">{{ activeTag || "全部" }}</span>
            <span class="muted small num">{{ list.length }} 道</span>
            <span class="grow" />
            <n-select
              :value="threshold"
              :options="thresholdOptions"
              size="small"
              style="width: 130px"
              @update:value="(value: number) => (min = String(value))"
            />
          </div>
          <div class="scroll">
            <div v-if="!list.length && !loading" class="none muted">
              这段时间还没有 {{ threshold }} 人以上做过的题
            </div>
            <button
              v-for="row in list"
              :key="row.id"
              type="button"
              class="item"
              :class="{ on: row.id === selected?.id }"
              @click="pick(row)"
            >
              <span class="line">
                <span class="pid muted num">{{ row.displayId }}</span>
                <span class="ptitle">{{ row.title }}</span>
                <span v-if="row.users > row.solved" class="stuck num">
                  {{ row.users - row.solved }} 人没对
                </span>
              </span>
              <span class="line indent">
                <span class="track short"><span :style="{ width: `${firstRate(row)}%` }" /></span>
                <span class="pct num">{{ firstRate(row) }}%</span>
                <span class="muted small num nowrap">
                  {{ row.users }} 人 · 平均 {{ avgTries(row) }} 次
                </span>
              </span>
            </button>
          </div>
        </section>

        <section v-if="list.length" class="card detail" :class="{ open: detailOpen }">
          <div v-if="isMobile" class="detail-bar">
            <n-button quaternary circle @click="detailOpen = false">
              <template #icon><Icon icon="ph:arrow-left" /></template>
            </n-button>
            <span class="strong">{{ activeTag || "全部" }}</span>
          </div>
          <n-spin :show="detailLoading">
            <div v-if="detail && links" class="detail-body">
              <div class="line dhead">
                <span class="muted num">{{ detail.problem.displayId }}</span>
                <span class="dtitle">{{ detail.problem.title }}</span>
                <span v-for="name in detail.problem.tags" :key="name" class="tag">{{ name }}</span>
                <span class="links">
                  <a :href="links.problem" target="_blank" class="link">去题目 ›</a>
                  <a :href="links.statistics" target="_blank" class="link">数据统计 ›</a>
                </span>
              </div>

              <div class="stats">
                <div>
                  <div class="muted small">做过</div>
                  <div class="big num">{{ summary.users }}<span class="unit"> 人</span></div>
                </div>
                <div>
                  <div class="muted small">一次就对</div>
                  <div class="big num">{{ summary.firstRate }}%</div>
                </div>
                <div>
                  <div class="muted small">做对平均交</div>
                  <div class="big num">{{ summary.avgTries }}<span class="unit"> 次</span></div>
                </div>
                <div>
                  <div class="muted small">还没做对</div>
                  <div class="big num" :class="{ red: summary.stuck }">
                    {{ summary.stuck }}<span class="unit"> 人</span>
                  </div>
                </div>
              </div>

              <div v-if="errorTotal" class="block">
                <div class="muted small">错在哪 · {{ errorTotal }} 次</div>
                <div class="errbar">
                  <span
                    v-for="row in detail.errors"
                    :key="row.result"
                    :style="{
                      width: `${(row.count / errorTotal) * 100}%`,
                      background: resultColor(row.result),
                    }"
                  />
                </div>
                <div class="line small num errtext">
                  <span v-for="row in detail.errors" :key="row.result" class="legend">
                    <i :style="{ background: resultColor(row.result) }" />{{
                      resultName(row.result)
                    }}
                    {{ row.count }}
                  </span>
                </div>
              </div>

              <div v-if="!className" class="block">
                <div class="muted small">各班</div>
                <div v-for="row in byClass" :key="row.name" class="crow">
                  <span class="cname">{{ classLabel(row.name || null) }}</span>
                  <span class="num cusers">{{ row.users }} 人</span>
                  <span class="track mid"><span :style="{ width: `${row.rate}%` }" /></span>
                  <span class="pct num">{{ row.rate }}%</span>
                  <span class="muted num cavg">平均 {{ row.avgTries }} 次</span>
                  <span class="grow" />
                  <span v-if="row.stuck" class="stuck num">{{ row.stuck }} 人没对</span>
                  <span v-else class="muted">都对了</span>
                </div>
              </div>

              <template v-else>
                <div class="block">
                  <div class="muted small">交了几次才对</div>
                  <div class="dist">
                    <div v-for="row in distribution" :key="row.label" class="dcol">
                      <span class="small num strong">{{ row.count }} 人</span>
                      <span
                        class="dbar"
                        :class="{ first: row.min === 1, many: row.min === 6 }"
                        :style="{ height: `${row.height}px` }"
                      />
                      <span class="muted small">{{ row.label }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="mostTries.length" class="block">
                  <div class="muted small">交得最多的</div>
                  <div class="names">
                    <div v-for="row in mostTries" :key="row.username" class="nrow">
                      <UserName :username="row.username" class="uname" />
                      <span class="num strong ntries">交了 {{ row.tries }} 次</span>
                      <span class="muted num">{{ gap(row.minutes) }}</span>
                      <span class="grow" />
                      <a
                        :href="
                          href({
                            name: 'submissions',
                            query: { problem: detail.problem.displayId, username: row.username },
                          })
                        "
                        target="_blank"
                        class="link small"
                        >看代码</a
                      >
                    </div>
                  </div>
                </div>
              </template>

              <div v-if="history.length" class="block">
                <div class="muted small">历年一次就对{{ className ? "（全站）" : "" }}</div>
                <div v-for="row in history" :key="row.label" class="hrow num">
                  <span class="hlabel" :class="{ muted: !row.current }">
                    {{ row.label }}{{ row.current ? " 这学年" : "" }}
                  </span>
                  <span class="track mid" :class="{ past: !row.current }"
                    ><span :style="{ width: `${row.rate}%` }"
                  /></span>
                  <span class="pct" :class="{ strong: row.current }">{{ row.rate }}%</span>
                  <span class="muted small">{{ row.users }} 人</span>
                </div>
              </div>

              <div v-if="stuckStudents.length" class="block">
                <div class="line">
                  <span class="muted small">还没做对的 {{ stuckStudents.length }} 人</span>
                  <span class="grow" />
                  <a :href="links.submissions" target="_blank" class="link small"
                    >在提交列表里看 ›</a
                  >
                </div>
                <div class="names">
                  <div v-for="row in stuckStudents" :key="row.username" class="nrow">
                    <UserName :username="row.username" class="uname" />
                    <span class="muted num ntries">交了 {{ row.tries }} 次</span>
                    <span class="legend" :style="{ color: resultColor(row.lastResult) }">
                      <i :style="{ background: resultColor(row.lastResult) }" />{{
                        resultName(row.lastResult)
                      }}
                    </span>
                    <span class="grow" />
                    <a
                      :href="href({ path: `/submission/${row.lastSubmissionId}` })"
                      target="_blank"
                      class="link small"
                      >看代码</a
                    >
                  </div>
                </div>
              </div>
            </div>
          </n-spin>
        </section>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title {
  font-size: 20px;
  font-weight: 700;
}
.grow {
  flex: 1;
}
.muted {
  opacity: 0.6;
}
.small {
  font-size: 12px;
}
.strong {
  font-weight: 700;
}
.num {
  font-variant-numeric: tabular-nums;
}
.seg {
  display: flex;
}
.seg button {
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  margin-left: -1px;
}
.seg button:first-child {
  border-radius: 4px 0 0 4px;
  margin-left: 0;
}
.seg button:last-child {
  border-radius: 0 4px 4px 0;
}
.seg button.on {
  border-color: var(--learn-green);
  color: var(--learn-green-text);
  font-weight: 600;
  position: relative;
}
.main {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.card {
  border: 1px solid var(--learn-line);
  border-radius: 8px;
  overflow: hidden;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 16px;
  font-size: 15px;
}
.know {
  width: 220px;
  flex-shrink: 0;
}
.problems {
  width: 340px;
  flex-shrink: 0;
}
.scroll {
  max-height: calc(100vh - 210px);
  overflow-y: auto;
}
.detail {
  flex: 1;
  min-width: 0;
  min-height: 200px;
}
.item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 9px 16px;
  border: 0;
  border-top: 1px solid var(--learn-line);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.item:hover {
  background: var(--learn-soft);
}
.item.on {
  background: var(--learn-green-bg);
  box-shadow: inset 3px 0 0 var(--learn-green);
}
.item.on .name,
.item.on .ptitle {
  font-weight: 600;
}
.line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.indent {
  padding-left: 42px;
  gap: 8px;
}
.nowrap {
  white-space: nowrap;
}
.links {
  display: flex;
  gap: 12px;
  margin-left: auto;
}
.pid {
  width: 34px;
  flex-shrink: 0;
}
.ptitle {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stuck {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--learn-red-text);
}
.track {
  display: block;
  flex-shrink: 0;
  width: 170px;
  height: 8px;
  border-radius: 4px;
  background: var(--learn-todo);
  overflow: hidden;
}
.track > span {
  display: block;
  height: 100%;
  background: var(--learn-green);
}
.know .track {
  width: 130px;
}
.track.short {
  width: 90px;
}
.track.mid {
  width: 90px;
}
.track.past > span {
  background: var(--learn-green-line);
}
.pct {
  width: 38px;
  flex-shrink: 0;
  text-align: right;
  font-weight: 600;
}
.none {
  padding: 24px 16px;
  font-size: 13px;
}
.detail-body {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dhead {
  flex-wrap: wrap;
  row-gap: 4px;
}
.dtitle {
  font-size: 16px;
  font-weight: 700;
}
.tag {
  flex-shrink: 0;
  height: 20px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 12px;
  line-height: 20px;
  background: var(--learn-soft);
}
.link {
  flex-shrink: 0;
  color: var(--learn-green-text);
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
}
.link.small {
  font-size: 12px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.big {
  font-size: 22px;
  font-weight: 700;
}
.big.red {
  color: var(--learn-red-text);
}
.unit {
  font-size: 13px;
  font-weight: 400;
  opacity: 0.6;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.errbar {
  display: flex;
  gap: 1px;
  max-width: 440px;
  height: 10px;
  border-radius: 4px;
  overflow: hidden;
}
.errtext {
  gap: 12px;
  opacity: 0.85;
}
.legend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.legend i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.crow {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  height: 32px;
  border-top: 1px solid var(--learn-line);
  font-size: 13px;
}
.cname {
  width: 100px;
  flex-shrink: 0;
}
.cusers {
  width: 40px;
  text-align: right;
}
.cavg {
  width: 72px;
}
.dist {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}
.dcol {
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.dbar {
  width: 40px;
  border-radius: 3px 3px 0 0;
  background: var(--learn-green-line);
}
.dbar.first {
  background: var(--learn-green);
}
.dbar.many {
  background: var(--learn-orange);
}
.names {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  column-gap: 24px;
}
.nrow {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  height: 28px;
  font-size: 13px;
  min-width: 0;
}
.uname {
  width: 110px;
  flex-shrink: 0;
}
.ntries {
  width: 64px;
  flex-shrink: 0;
}
.hrow {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
  height: 24px;
  font-size: 13px;
}
.hlabel {
  width: 96px;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .top {
    flex-wrap: wrap;
  }
  .top .grow {
    display: none;
  }
  .title {
    width: 100%;
  }
  .top .n-select {
    flex: 1 1 100%;
    min-width: 0;
  }
  .seg {
    width: 100%;
  }
  .seg button {
    flex: 1;
    padding: 0 4px;
  }
  .main {
    flex-direction: column;
    align-items: stretch;
  }
  .know,
  .problems {
    width: auto;
  }
  /* 知识点横着一排滑 */
  .know-list {
    display: flex;
    overflow-x: auto;
    border-top: 1px solid var(--learn-line);
  }
  .know .item {
    flex: 0 0 150px;
    border-top: 0;
    border-left: 1px solid var(--learn-line);
  }
  .know .item:first-child {
    border-left: 0;
  }
  .know .item.on {
    box-shadow: inset 0 -3px 0 var(--learn-green);
  }
  .know .track {
    width: auto;
    flex: 1;
  }
  .scroll {
    max-height: none;
  }
  /* 一道题的详情盖满整屏 */
  .detail {
    display: none;
  }
  .detail.open {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 2000;
    border: 0;
    border-radius: 0;
    overflow-y: auto;
    background: v-bind("theme.bodyColor");
  }
  .detail-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 48px;
    padding: 0 8px;
    border-bottom: 1px solid var(--learn-line);
    background: v-bind("theme.bodyColor");
  }
  .detail-body {
    padding: 14px 16px 32px;
  }
  .links {
    margin-left: 0;
    width: 100%;
  }
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 12px;
  }
  .cavg {
    display: none;
  }
  .cname {
    width: 84px;
  }
  .track.mid {
    width: 64px;
  }
  .dcol {
    flex: 1;
    width: auto;
  }
  .names {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

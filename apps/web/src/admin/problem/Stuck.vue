<script setup lang="ts">
import { useRouteQuery } from "@vueuse/router"
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import type { StuckProblem, StuckProblemDetail } from "utils/types"
import { getStuckProblemDetail, getStuckProblems } from "admin/api"
import { useConfigStore } from "shared/store/config"
import { groupClassOptions } from "utils/classes"
import { periodRange, type Period } from "oj/statistics/period"
import { useBackClose } from "shared/composables/backClose"
import { useBreakpoints } from "shared/composables/breakpoints"
import "oj/learn/learn.css"
import StuckDetail from "./components/StuckDetail.vue"
import { avgTries, rate } from "./components/stuckMath"

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

function firstRate(row: StuckProblem) {
  return rate(row.firstTry, row.users)
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
            <StuckDetail v-if="detail" :detail="detail" :class-name="className" :period="period" />
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
}
</style>

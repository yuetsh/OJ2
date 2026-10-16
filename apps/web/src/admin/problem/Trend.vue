<script setup lang="ts">
import { useRouteQuery } from "@vueuse/router"
import type { GradeTrendProblem } from "utils/types"
import { getGradeTrend } from "admin/api"
import "oj/learn/learn.css"

/**
 * 年度趋势（设计稿「卡点与趋势」页的 TrendB）：选一届，和往届（或另一届）在两边都做过的题上
 * 逐题比「一次就对」，比往届差的排前面。
 *
 * 按届（班号前两位）比而不是按自然年：一个学年里同时有两三届在做题，按年切会把它们搅在一起。
 * 往届是把更早几届的人合在一起算（人多的届分量大），不是几个百分比再平均。
 * 比输赢按显示出来的整数百分比，差 2 个点以内算差不多。
 */
const router = useRouter()

/** 每边至少这么多人做过，这道题才拿来比 */
const MIN_USERS = 20
const SAME = 2
const PAST = "past"

const problems = ref<GradeTrendProblem[]>([])
const loading = ref(false)
const grade = useRouteQuery<string>("grade", "", { mode: "replace" })
const compare = useRouteQuery<string>("compare", PAST, { mode: "replace" })

/** 有数据的届，新的在前 */
const grades = computed(() =>
  [...new Set(problems.value.flatMap((row) => row.grades.map((cell) => cell.grade)))].sort((a, b) =>
    b.localeCompare(a),
  ),
)

function side(row: GradeTrendProblem, pick: (g: string) => boolean) {
  return row.grades
    .filter((cell) => pick(cell.grade))
    .reduce(
      (sum, cell) => ({ users: sum.users + cell.users, firstTry: sum.firstTry + cell.firstTry }),
      {
        users: 0,
        firstTry: 0,
      },
    )
}

function rate(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0
}

function compareRows(current: string, other: string) {
  const isOther = other === PAST ? (g: string) => g < current : (g: string) => g === other
  return problems.value
    .map((row) => {
      const mine = side(row, (g) => g === current)
      const theirs = side(row, isOther)
      const now = rate(mine.firstTry, mine.users)
      const before = rate(theirs.firstTry, theirs.users)
      return { row, mine, theirs, now, before, delta: now - before }
    })
    .filter((item) => item.mine.users >= MIN_USERS && item.theirs.users >= MIN_USERS)
}

/** 没选就挑最新的一届里能和往届比上至少 5 道题的 */
const selected = computed(() => {
  if (grades.value.includes(grade.value)) return grade.value
  return grades.value.find((g) => compareRows(g, PAST).length >= 5) ?? grades.value[0] ?? ""
})

const pastGrades = computed(() => grades.value.filter((g) => g < selected.value))
const pastLabel = computed(() => {
  const list = pastGrades.value
  if (!list.length) return "往届"
  return list.length === 1 ? `往届（${list[0]} 级）` : `往届（${list.at(-1)}–${list[0]} 级）`
})
const otherLabel = computed(() =>
  compare.value === PAST ? pastLabel.value : `${compare.value} 级`,
)
const shortOther = computed(() => (compare.value === PAST ? "往届" : `${compare.value} 级`))

const gradeOptions = computed(() => grades.value.map((g) => ({ label: `${g} 级`, value: g })))
const compareOptions = computed(() => [
  { label: pastLabel.value, value: PAST },
  ...grades.value.filter((g) => g !== selected.value).map((g) => ({ label: `${g} 级`, value: g })),
])

const rows = computed(() => (selected.value ? compareRows(selected.value, compare.value) : []))
const worse = computed(() =>
  rows.value.filter((item) => item.delta < -SAME).sort((a, b) => a.delta - b.delta),
)
const same = computed(() =>
  rows.value.filter((item) => Math.abs(item.delta) <= SAME).sort((a, b) => a.delta - b.delta),
)
const better = computed(() =>
  rows.value.filter((item) => item.delta > SAME).sort((a, b) => b.delta - a.delta),
)

const summary = computed(() => {
  const total = rows.value.reduce(
    (sum, item) => ({
      mineUsers: sum.mineUsers + item.mine.users,
      mineFirst: sum.mineFirst + item.mine.firstTry,
      theirUsers: sum.theirUsers + item.theirs.users,
      theirFirst: sum.theirFirst + item.theirs.firstTry,
    }),
    { mineUsers: 0, mineFirst: 0, theirUsers: 0, theirFirst: 0 },
  )
  return {
    now: rate(total.mineFirst, total.mineUsers),
    before: rate(total.theirFirst, total.theirUsers),
  }
})

const groups = computed(() =>
  [
    { key: "worse", label: `比${shortOther.value}差`, items: worse.value },
    { key: "same", label: "差不多", items: same.value },
    { key: "better", label: `比${shortOther.value}好`, items: better.value },
  ].filter((group) => group.items.length),
)

function tone(delta: number) {
  return delta < -SAME ? "worse" : delta > SAME ? "better" : "same"
}

function problemHref(displayId: string) {
  return router.resolve({ name: "problem", params: { problemID: displayId } }).href
}

function pickGrade(value: string) {
  grade.value = value
  if (compare.value === value) compare.value = PAST
}

onMounted(async () => {
  loading.value = true
  try {
    problems.value = await getGradeTrend()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <div class="top">
      <span class="title">年度趋势</span>
      <span class="grow" />
      <span class="muted">比</span>
      <n-select
        :value="selected || null"
        :options="gradeOptions"
        class="grade-select"
        @update:value="pickGrade"
      />
      <span class="muted">和</span>
      <n-select
        :value="compare"
        :options="compareOptions"
        class="compare-select"
        @update:value="(value: string) => (compare = value)"
      />
    </div>

    <n-spin :show="loading">
      <template v-if="rows.length">
        <div class="stats">
          <div class="stat">
            <div class="label">两边都做过的题</div>
            <div class="value num">{{ rows.length }}<span class="unit"> 道</span></div>
          </div>
          <div class="stat">
            <div class="label">一次就对</div>
            <div class="value num">
              {{ summary.now }}%<span class="unit"> / {{ shortOther }} {{ summary.before }}%</span>
            </div>
          </div>
          <div class="stat">
            <div class="label">比{{ shortOther }}差</div>
            <div class="value num worse-text">{{ worse.length }}<span class="unit"> 道</span></div>
          </div>
          <div class="stat">
            <div class="label">比{{ shortOther }}好</div>
            <div class="value num better-text">
              {{ better.length }}<span class="unit"> 道</span>
            </div>
          </div>
        </div>

        <section class="card">
          <div class="row axis">
            <span class="c-title" />
            <span class="c-track ticks num">
              <span v-for="tick in [0, 25, 50, 75, 100]" :key="tick" :style="{ left: `${tick}%` }"
                >{{ tick }}%</span
              >
            </span>
            <span class="legend">
              <span><i class="dot-now" />{{ selected }} 级</span>
              <span><i class="dot-before" />{{ shortOther }}</span>
            </span>
          </div>
          <template v-for="group in groups" :key="group.key">
            <div class="group-head">
              <span class="strong" :class="`${group.key}-text`">{{ group.label }}</span>
              <span class="muted small num">{{ group.items.length }} 道</span>
            </div>
            <div v-for="item in group.items" :key="item.row.id" class="row item">
              <a :href="problemHref(item.row.displayId)" target="_blank" class="c-title">
                <span class="muted num pid">{{ item.row.displayId }}</span>
                <span class="ptitle">{{ item.row.title }}</span>
              </a>
              <span class="c-track" :class="tone(item.delta)">
                <span class="rail" />
                <span
                  class="span"
                  :style="{
                    left: `${Math.min(item.now, item.before)}%`,
                    width: `${Math.abs(item.delta)}%`,
                  }"
                />
                <span class="before" :style="{ left: `${item.before}%` }" />
                <span class="now" :style="{ left: `${item.now}%` }" />
              </span>
              <span class="c-values num">
                <b :class="`${tone(item.delta)}-text`">{{ item.now }}%</b>
                <span class="muted"> / {{ item.before }}%</span>
              </span>
              <span class="c-delta num strong" :class="`${tone(item.delta)}-text`">
                {{ item.delta > 0 ? "+" : "" }}{{ item.delta }}
              </span>
              <span class="c-users muted small num">
                {{ selected }} 级 {{ item.mine.users }} 人 · {{ shortOther }}
                {{ item.theirs.users }} 人
              </span>
            </div>
          </template>
        </section>
      </template>
      <n-empty
        v-else-if="!loading"
        :description="`${selected ? `${selected} 级` : '这一届'}和${otherLabel}没有都做过（每边 ${MIN_USERS} 人以上）的题`"
        style="margin: 60px 0"
      />
    </n-spin>
  </div>
</template>

<style scoped>
.page {
  --worse: #d9730d;
  --worse-text: #b35c00;
  --better: #2080f0;
  --better-text: #1a66c2;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
html.dark .page {
  --worse-text: #f2a65a;
  --better-text: #70b0ff;
}
.top {
  display: flex;
  align-items: center;
  gap: 10px;
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
.worse-text {
  color: var(--worse-text);
}
.better-text {
  color: var(--better-text);
}
.stats {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
.stat {
  border: 1px solid var(--learn-line);
  border-radius: 8px;
  padding: 14px 18px;
}
.label {
  font-size: 13px;
  opacity: 0.6;
}
.value {
  font-size: 26px;
  font-weight: 700;
}
.unit {
  font-size: 15px;
  font-weight: 400;
  opacity: 0.6;
}
.card {
  border: 1px solid var(--learn-line);
  border-radius: 8px;
  padding: 8px 0 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
}
.axis {
  height: 24px;
}
.item {
  height: 38px;
  border-top: 1px solid var(--learn-line);
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 6px;
}
.c-title {
  width: 270px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}
a.c-title:hover .ptitle {
  color: var(--learn-green-text);
}
.pid {
  width: 34px;
  flex-shrink: 0;
}
.ptitle {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.c-track {
  position: relative;
  flex: 0 1 420px;
  min-width: 200px;
  height: 20px;
}
.ticks > span {
  position: absolute;
  top: 2px;
  width: 36px;
  margin-left: -18px;
  text-align: center;
  font-size: 11px;
  opacity: 0.6;
}
.rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 9px;
  height: 2px;
  background: var(--learn-line);
}
.span {
  position: absolute;
  top: 8px;
  height: 4px;
  border-radius: 2px;
  opacity: 0.35;
  background: var(--learn-line);
}
.worse .span,
.worse .now {
  background: var(--worse);
}
.better .span,
.better .now {
  background: var(--better);
}
.before {
  position: absolute;
  top: 4px;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  border-radius: 6px;
  box-sizing: border-box;
  border: 2px solid rgba(128, 128, 128, 0.8);
  background: var(--learn-pane);
}
.now {
  position: absolute;
  top: 3px;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  border-radius: 7px;
  background: rgba(128, 128, 128, 0.8);
}
.c-values {
  width: 92px;
  flex-shrink: 0;
  font-size: 13px;
  white-space: nowrap;
}
.c-delta {
  width: 44px;
  flex-shrink: 0;
  text-align: right;
}
.c-users {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.legend {
  display: flex;
  gap: 14px;
  margin-left: 16px;
  font-size: 12px;
  white-space: nowrap;
}
.legend > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dot-now {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background: var(--worse);
}
.grade-select {
  width: 100px;
}
.compare-select {
  width: 170px;
}
.dot-before {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  box-sizing: border-box;
  border: 2px solid rgba(128, 128, 128, 0.8);
}

/* 手机上一道题两行：题名和两个百分比一行，下面一整行是轨道；人数藏掉 */
@media (max-width: 768px) {
  .top {
    flex-wrap: wrap;
  }
  .top .title {
    width: 100%;
  }
  .top .grow {
    display: none;
  }
  .grade-select {
    width: 90px;
  }
  .compare-select {
    flex: 1;
    width: auto;
    min-width: 0;
  }
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stat {
    padding: 12px 14px;
  }
  .value {
    font-size: 22px;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    column-gap: 10px;
    row-gap: 4px;
  }
  .axis {
    height: auto;
    grid-template-columns: minmax(0, 1fr);
  }
  .axis .c-title {
    display: none;
  }
  .legend {
    grid-row: 1;
    margin-left: 0;
  }
  .item {
    height: auto;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .c-title {
    width: auto;
  }
  .c-track {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .item .c-track {
    grid-row: 2;
  }
  .c-values {
    grid-row: 1;
    grid-column: 2;
    width: auto;
  }
  .c-delta {
    grid-row: 1;
    grid-column: 3;
  }
  .c-users {
    display: none;
  }
}
</style>

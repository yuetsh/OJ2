<script setup lang="ts">
import { zonedParts } from 'utils/functions'
import type { StuckProblemDetail, StuckStudent } from 'utils/types'
import UserName from 'shared/components/UserName.vue'
import { classLabel } from 'utils/classes'
import { resultName, useResultColor } from 'oj/statistics/results'
import { avgTries, rate } from './stuckMath'

/**
 * 卡点分析右栏：一道题的详情（做过几人、一次就对、错在哪、各班、交了几次才对、历年、
 * 还没做对的人）。从 Stuck.vue 拆出来，取数和三栏的联动还在那边。
 */
const props = defineProps<{
  detail: StuckProblemDetail
  /** 选了一个班：不分班列、改列这个班交了几次才对 */
  className: string
  period: string
}>()
const router = useRouter()
const resultColor = useResultColor()

const students = computed(() => props.detail.students ?? [])
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

const errorTotal = computed(() => (props.detail.errors ?? []).reduce((sum, row) => sum + row.count, 0))

const byClass = computed(() => {
  const groups = new Map<string, StuckStudent[]>()
  for (const row of students.value) {
    const key = row.className ?? ''
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
  { label: '1 次', min: 1, max: 1 },
  { label: '2 次', min: 2, max: 2 },
  { label: '3 次', min: 3, max: 3 },
  { label: '4–5 次', min: 4, max: 5 },
  { label: '6 次以上', min: 6, max: Infinity },
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

const stuckStudents = computed(() => students.value.filter((row) => !row.solved).sort((a, b) => b.tries - a.tries))

const currentYear = (() => {
  const now = zonedParts(new Date())!
  return now.month >= 9 ? now.year : now.year - 1
})()
const history = computed(() =>
  (props.detail.history ?? []).map((row) => ({
    label: `${String(row.year).slice(2)}–${String(row.year + 1).slice(2)}`,
    current: row.year === currentYear,
    users: row.users,
    rate: rate(row.firstTry, row.users),
  })),
)

function gap(minutes: number | null) {
  if (minutes === null) return ''
  if (minutes < 1) return '不到 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`
  return `隔了 ${Math.round(minutes / 1440)} 天`
}

function href(to: Parameters<typeof router.resolve>[0]) {
  return router.resolve(to).href
}

const links = computed(() => {
  const row = props.detail.problem
  if (!row) return null
  const scope = props.className ? { className: props.className } : {}
  return {
    problem: href({ name: 'problem', params: { problemID: row.displayId } }),
    statistics: href({
      name: 'statistics',
      query: { problem: row.displayId, period: props.period, ...scope },
    }),
    submissions: href({ name: 'submissions', query: { problem: row.displayId, ...scope } }),
  }
})
</script>

<template>
  <div v-if="links" class="detail-body">
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
        <div class="big num" :class="{ red: summary.stuck }">{{ summary.stuck }}<span class="unit"> 人</span></div>
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
          <i :style="{ background: resultColor(row.result) }" />{{ resultName(row.result) }}
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
            <span class="dbar" :class="{ first: row.min === 1, many: row.min === 6 }" :style="{ height: `${row.height}px` }" />
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
      <div class="muted small">历年一次就对{{ className ? '（全站）' : '' }}</div>
      <div v-for="row in history" :key="row.label" class="hrow num">
        <span class="hlabel" :class="{ muted: !row.current }"> {{ row.label }}{{ row.current ? ' 这学年' : '' }} </span>
        <span class="track mid" :class="{ past: !row.current }"><span :style="{ width: `${row.rate}%` }" /></span>
        <span class="pct" :class="{ strong: row.current }">{{ row.rate }}%</span>
        <span class="muted small">{{ row.users }} 人</span>
      </div>
    </div>

    <div v-if="stuckStudents.length" class="block">
      <div class="line">
        <span class="muted small">还没做对的 {{ stuckStudents.length }} 人</span>
        <span class="grow" />
        <a :href="links.submissions" target="_blank" class="link small">在提交列表里看 ›</a>
      </div>
      <div class="names">
        <div v-for="row in stuckStudents" :key="row.username" class="nrow">
          <UserName :username="row.username" class="uname" />
          <span class="muted num ntries">交了 {{ row.tries }} 次</span>
          <span class="legend" :style="{ color: resultColor(row.lastResult) }">
            <i :style="{ background: resultColor(row.lastResult) }" />{{ resultName(row.lastResult) }}
          </span>
          <span class="grow" />
          <a :href="href({ path: `/submission/${row.lastSubmissionId}` })" target="_blank" class="link small">看代码</a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.links {
  display: flex;
  gap: 12px;
  margin-left: auto;
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

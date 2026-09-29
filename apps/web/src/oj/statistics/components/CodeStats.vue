<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import type { SubmissionStatistics, SubmissionStatisticsGrid } from "@oj2/contract"
import { SubmissionStatus } from "utils/constants"
import { parseTime } from "utils/functions"
import StatusPill from "oj/submission/components/StatusPill.vue"
import { useTone } from "oj/submission/composables/tone"
import AttemptSquares from "./AttemptSquares.vue"

/**
 * 代码统计的主体（设计稿「统计重设计 · 定稿 B」）：左边题目，右边学生。
 * 选一道题看全班每人在这道题上的每一次；选「全部」看每人几道做完、展开按题看。
 *
 * 数字口径（做完、没交）跟着统计接口走（stats），这里的方块串和每题做完几人
 * 从 grid 里的逐条提交算。
 */
const props = defineProps<{
  stats: SubmissionStatistics
  grid: SubmissionStatisticsGrid
}>()

const theme = useThemeVars()
const tone = useTone()

type Attempt = SubmissionStatisticsGrid["rows"][number]["submissions"][number]

function isAc(result: number) {
  return result === SubmissionStatus.accepted || result === SubmissionStatus.ast_check_failed
}

interface Student {
  username: string
  name: string
  /** 题号 → 这道题上的每一次，从早到晚 */
  byProblem: Map<string, Attempt[]>
  total: number
  accepted: number
  last: string | null
}

/** 花名册上的每一个人：交过的从 grid 来，一条没交的从统计接口的 dataUnaccepted 来 */
const students = computed<Student[]>(() => {
  const list: Student[] = props.grid.rows.map((row) => {
    const byProblem = new Map<string, Attempt[]>()
    for (const item of row.submissions) {
      const bucket = byProblem.get(item.problemDisplayId) ?? []
      bucket.push(item)
      byProblem.set(item.problemDisplayId, bucket)
    }
    return {
      username: row.username,
      name: row.realName || row.username,
      byProblem,
      total: row.submissions.length,
      accepted: row.submissions.filter((item) => isAc(item.result)).length,
      last: row.submissions.at(-1)?.createTime ?? null,
    }
  })
  const seen = new Set(list.map((item) => item.username))
  for (const row of props.stats.dataUnaccepted) {
    if (seen.has(row.username)) continue
    list.push({
      username: row.username,
      name: row.realName || row.username,
      byProblem: new Map(),
      total: 0,
      accepted: 0,
      last: null,
    })
  }
  return list
})

const problems = computed(() => props.grid.problems)
const personCount = computed(() => props.stats.personCount || students.value.length)

function solvedOn(student: Student, pid: string) {
  return (student.byProblem.get(pid) ?? []).some((item) => isAc(item.result))
}

function doneCount(student: Student) {
  return problems.value.filter((problem) => solvedOn(student, problem.problemDisplayId)).length
}

const problemRows = computed(() =>
  problems.value.map((problem) => {
    const pid = problem.problemDisplayId
    const tried = students.value.filter((student) => student.byProblem.has(pid))
    const done = tried.filter((student) => solvedOn(student, pid)).length
    const attempts = tried.reduce((sum, student) => sum + student.byProblem.get(pid)!.length, 0)
    return {
      ...problem,
      done,
      tried: tried.length,
      avg: tried.length ? (attempts / tried.length).toFixed(1) : "—",
    }
  }),
)

const allDone = computed(
  () => students.value.filter((student) => doneCount(student) === problems.value.length).length,
)

// ---------- 选中哪道题、筛哪些人 ----------

/** "" = 全部。只有一道题时直接选中它 */
const focus = ref("")
watch(
  problems,
  (list) => {
    if (list.length === 1) focus.value = list[0]!.problemDisplayId
    else if (!list.some((problem) => problem.problemDisplayId === focus.value)) focus.value = ""
  },
  { immediate: true },
)

/** 默认只看没做完的：复盘要找的是他们，做完的一长串沉在下面也看不见 */
const onlyUnfinished = ref(true)

const focusRow = computed(() =>
  problemRows.value.find((row) => row.problemDisplayId === focus.value),
)

/** 这道题上：没过的在前（交得越多越靠前 —— 卡得最久），一次没交的其次，做完的沉底 */
const problemStudents = computed(() => {
  const pid = focus.value
  const list = students.value.map((student) => {
    const items = student.byProblem.get(pid) ?? []
    return { student, items, solved: items.some((item) => isAc(item.result)) }
  })
  const rank = (row: (typeof list)[number]) => (row.solved ? 2 : row.items.length ? 0 : 1)
  return list
    .filter((row) => !onlyUnfinished.value || !row.solved)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.items.length - a.items.length ||
        a.student.name.localeCompare(b.student.name, "zh-CN"),
    )
})

/** 全部题：没做完的在前（交得多的更前），一道没交的其次，全做完的沉底 */
const allStudents = computed(() => {
  const n = problems.value.length
  const list = students.value.map((student) => ({ student, done: doneCount(student) }))
  const rank = (row: (typeof list)[number]) => (row.done === n ? 2 : row.student.total ? 0 : 1)
  return list
    .filter((row) => !onlyUnfinished.value || row.done < n)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.student.total - a.student.total ||
        a.student.name.localeCompare(b.student.name, "zh-CN"),
    )
})

const unfinishedCount = computed(() =>
  focus.value
    ? students.value.filter((student) => !solvedOn(student, focus.value)).length
    : students.value.filter((student) => doneCount(student) < problems.value.length).length,
)

const expanded = ref("")
watch([focus, onlyUnfinished], () => (expanded.value = ""))

function toggle(username: string) {
  expanded.value = expanded.value === username ? "" : username
}

/** 展开一个人：没过的题在前、交得多的更前 */
function problemsOf(student: Student) {
  return [...problems.value].sort((a, b) => {
    const sa = solvedOn(student, a.problemDisplayId)
    const sb = solvedOn(student, b.problemDisplayId)
    if (sa !== sb) return sa ? 1 : -1
    return (
      (student.byProblem.get(b.problemDisplayId)?.length ?? 0) -
      (student.byProblem.get(a.problemDisplayId)?.length ?? 0)
    )
  })
}

function rate(student: Student) {
  return student.total ? `${Math.round((student.accepted / student.total) * 100)}%` : "—"
}

function dayText(time: string | null) {
  return time ? parseTime(time, "M月D日 HH:mm") : "—"
}

function pct(done: number, total: number) {
  return total > 0 ? `${Math.min(100, (done / total) * 100)}%` : "0%"
}
</script>

<template>
  <div class="code-stats">
    <!-- 左：题目 -->
    <section class="problems">
      <div class="col-head">题目（按你填的顺序）</div>
      <div class="problem-list">
        <button
          v-if="problems.length > 1"
          class="problem"
          :class="{ on: focus === '' }"
          @click="focus = ''"
        >
          <span class="p-line">
            <b>全部 {{ problems.length }} 道</b>
            <span class="spacer"></span>
            <span class="muted">做完 {{ allDone }}/{{ personCount }} 人</span>
          </span>
          <span class="bar"
            ><span class="fill" :style="{ width: pct(allDone, personCount) }"></span
          ></span>
        </button>
        <button
          v-for="row in problemRows"
          :key="row.problemDisplayId"
          class="problem"
          :class="{ on: focus === row.problemDisplayId }"
          @click="focus = row.problemDisplayId"
        >
          <span class="p-line">
            <span class="muted">{{ row.problemDisplayId }}</span>
            <b class="p-title">{{ row.title }}</b>
            <span class="spacer"></span>
            <span class="muted">做完 {{ row.done }}/{{ personCount }} · 平均 {{ row.avg }} 次</span>
          </span>
          <span class="bar"
            ><span class="fill" :style="{ width: pct(row.done, personCount) }"></span
          ></span>
        </button>
        <div v-if="!problems.length" class="empty">这段时间没有人交</div>
      </div>
    </section>

    <!-- 右：学生 -->
    <section class="students">
      <div class="s-head">
        <template v-if="focusRow">
          <b class="s-title">{{ focusRow.problemDisplayId }} {{ focusRow.title }}</b>
          <span class="muted">
            做完 {{ focusRow.done }}/{{ personCount }} · 交了没对
            {{ focusRow.tried - focusRow.done }} · 没交
            {{ Math.max(0, personCount - focusRow.tried) }}
          </span>
        </template>
        <template v-else>
          <b class="s-title">全部 {{ problems.length }} 道</b>
          <span class="muted">
            做完 {{ allDone }}/{{ personCount }} · 没做完 {{ unfinishedCount }} · 一道没交
            {{ stats.dataUnaccepted.length }}
          </span>
        </template>
        <span class="spacer"></span>
        <button class="chip" :class="{ on: onlyUnfinished }" @click="onlyUnfinished = true">
          没做完 <span class="n">{{ unfinishedCount }}</span>
        </button>
        <button class="chip" :class="{ on: !onlyUnfinished }" @click="onlyUnfinished = false">
          全部 <span class="n">{{ students.length }}</span>
        </button>
      </div>

      <!-- 一道题：每人一行，后面是这道题上的每一次 -->
      <template v-if="focusRow">
        <div class="cols">
          <span class="c-name">学生</span>
          <span class="c-last">最后一次</span>
          <span class="c-n">次数</span>
          <span class="c-seq">每一次（从早到晚）</span>
          <span class="c-when">最近一次在</span>
        </div>
        <div class="rows">
          <div v-for="row in problemStudents" :key="row.student.username" class="row">
            <span class="c-name name" :title="row.student.username">{{ row.student.name }}</span>
            <span class="c-last">
              <StatusPill v-if="row.items.length" :result="row.items.at(-1)!.result" />
              <b v-else class="none" :style="{ color: tone('error').color }">没交</b>
            </span>
            <span class="c-n muted">{{ row.items.length || "—" }}</span>
            <span class="c-seq"><AttemptSquares :items="row.items" /></span>
            <span class="c-when muted">{{ dayText(row.items.at(-1)?.createTime ?? null) }}</span>
          </div>
          <div v-if="!problemStudents.length" class="empty">全都做完了</div>
        </div>
      </template>

      <!-- 全部题：每人一行，一格一道题；点开按题看方块串 -->
      <template v-else>
        <div class="cols">
          <span class="c-caret"></span>
          <span class="c-name">学生</span>
          <span class="c-done">做完</span>
          <span class="c-n">提交</span>
          <span class="c-rate">正确率</span>
          <span class="c-grid">{{ problems.map((p) => p.problemDisplayId).join(" · ") }}</span>
        </div>
        <div class="rows">
          <template v-for="row in allStudents" :key="row.student.username">
            <div
              class="row clickable"
              :class="{ on: expanded === row.student.username }"
              @click="toggle(row.student.username)"
            >
              <span class="c-caret">
                <Icon
                  :icon="
                    expanded === row.student.username ? 'ph:caret-down-bold' : 'ph:caret-right-bold'
                  "
                  :width="12"
                />
              </span>
              <span class="c-name name" :title="row.student.username">{{ row.student.name }}</span>
              <span
                class="c-done done"
                :style="{
                  color:
                    row.done === problems.length
                      ? tone('success').color
                      : row.student.total
                        ? theme.textColor1
                        : tone('error').color,
                }"
              >
                {{ row.done }}/{{ problems.length }}
              </span>
              <span class="c-n muted">{{ row.student.total }}</span>
              <span class="c-rate muted">{{ rate(row.student) }}</span>
              <span class="c-grid cells">
                <span
                  v-for="problem in problems"
                  :key="problem.problemDisplayId"
                  class="cell"
                  :title="problem.problemDisplayId + ' ' + problem.title"
                  :style="
                    solvedOn(row.student, problem.problemDisplayId)
                      ? { background: tone('success').solid, color: '#fff' }
                      : row.student.byProblem.has(problem.problemDisplayId)
                        ? { background: tone('error').background, color: tone('error').color }
                        : { background: theme.actionColor, color: theme.textColor3 }
                  "
                >
                  {{
                    solvedOn(row.student, problem.problemDisplayId)
                      ? "✓"
                      : (row.student.byProblem.get(problem.problemDisplayId)?.length ?? "·")
                  }}
                </span>
              </span>
            </div>
            <div v-if="expanded === row.student.username" class="detail">
              <div
                v-for="problem in problemsOf(row.student)"
                :key="problem.problemDisplayId"
                class="d-line"
              >
                <span class="d-title"
                  ><span class="muted">{{ problem.problemDisplayId }}</span>
                  {{ problem.title }}</span
                >
                <span
                  class="d-state"
                  :style="{
                    color: solvedOn(row.student, problem.problemDisplayId)
                      ? tone('success').color
                      : tone('error').color,
                  }"
                >
                  {{ row.student.byProblem.get(problem.problemDisplayId)?.length ?? 0 }} 次 ·
                  {{
                    solvedOn(row.student, problem.problemDisplayId)
                      ? "已通过"
                      : row.student.byProblem.has(problem.problemDisplayId)
                        ? "还没过"
                        : "没交"
                  }}
                </span>
                <AttemptSquares
                  :items="row.student.byProblem.get(problem.problemDisplayId) ?? []"
                />
              </div>
            </div>
          </template>
          <div v-if="!allStudents.length" class="empty">全都做完了</div>
        </div>
      </template>
      <div v-if="grid.truncated" class="truncated">
        范围太大，方块串只画了最近 5000 条；上面的人数、正确率仍是全部算的。
      </div>
    </section>
  </div>
</template>

<style scoped>
.code-stats {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
}

.problems {
  width: 380px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid v-bind("theme.dividerColor");
  min-height: 0;
}

.col-head {
  height: 36px;
  flex: none;
  box-sizing: border-box;
  padding: 0 16px 0 20px;
  display: flex;
  align-items: center;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.problem-list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

.problem {
  width: 100%;
  height: 50px;
  box-sizing: border-box;
  padding: 0 16px 0 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.problem:hover {
  background: v-bind("theme.hoverColor");
}

.problem.on {
  background: v-bind("tone('success').background");
}

.p-line {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  min-width: 0;
}

.p-title {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.bar {
  height: 4px;
  border-radius: 2px;
  background: v-bind("theme.dividerColor");
  overflow: hidden;
}

.fill {
  display: block;
  height: 4px;
  border-radius: 2px;
  background: v-bind("theme.successColor");
}

.muted {
  color: v-bind("theme.textColor3");
  font-size: 12px;
}

.spacer {
  flex: 1 1 0;
}

.students {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.s-head {
  height: 44px;
  flex: none;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  white-space: nowrap;
}

.s-title {
  font-size: 15px;
}

.chip {
  height: 28px;
  padding: 0 12px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 14px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.chip.on {
  border-color: v-bind("theme.primaryColor");
  background: v-bind("tone('success').background");
  color: v-bind("tone('success').color");
  font-weight: 600;
}

.chip .n {
  opacity: 0.75;
  font-weight: 400;
}

.cols {
  height: 32px;
  flex: none;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.rows {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

.row {
  min-height: 38px;
  box-sizing: border-box;
  padding: 6px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.row.clickable {
  cursor: pointer;
}

.row.clickable:hover {
  background: v-bind("theme.hoverColor");
}

.row.on {
  background: v-bind("tone('success').background");
}

.c-caret {
  width: 16px;
  flex: none;
  display: flex;
  color: v-bind("theme.textColor3");
}
.c-name {
  width: 110px;
  flex: none;
}
.c-last {
  width: 120px;
  flex: none;
}
.c-n {
  width: 50px;
  flex: none;
}
.c-seq {
  flex: 1 1 0;
  min-width: 0;
}
.c-when {
  width: 100px;
  flex: none;
}
.c-done {
  width: 60px;
  flex: none;
}
.c-rate {
  width: 60px;
  flex: none;
}
.c-grid {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.done {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.none {
  font-size: 13px;
}

.cells {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  white-space: normal;
}

.cell {
  width: 30px;
  height: 18px;
  border-radius: 4px;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.detail {
  padding: 6px 20px 8px 46px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  background: v-bind("theme.actionColor");
}

.d-line {
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.d-title {
  width: 190px;
  flex: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.d-state {
  width: 100px;
  flex: none;
  font-size: 12px;
}

.empty {
  padding: 40px 16px;
  text-align: center;
  color: v-bind("theme.textColor3");
}

.truncated {
  padding: 8px 20px;
  font-size: 12px;
  color: v-bind("tone('warning').color");
  border-top: 1px solid v-bind("theme.dividerColor");
}
</style>

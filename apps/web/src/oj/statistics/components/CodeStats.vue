<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import type { SubmissionStatistics, SubmissionStatisticsGrid } from "@oj2/contract"
import { SubmissionStatus } from "utils/constants"
import { parseTime } from "utils/functions"
import StatusPill from "oj/submission/components/StatusPill.vue"
import { useTone } from "oj/submission/composables/tone"
import UserName from "shared/components/UserName.vue"
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
  /**
   * 题号是老师填的（true），还是没填、从范围里出现过的题凑出来的（false）。没填时一个月
   * 零零散散几十道题谈不上「全做完」，「做完」改成「做对过题」（做对至少一道），和数字行一致
   */
  explicit: boolean
}>()

const theme = useThemeVars()
const tone = useTone()
// 暗色下「做对了」那格的底色是浅绿，白字看不清
const isDark = useDark()

type Attempt = SubmissionStatisticsGrid["rows"][number]["submissions"][number]

function isAc(result: number) {
  return result === SubmissionStatus.accepted || result === SubmissionStatus.ast_check_failed
}

function isPending(result: number) {
  return result === SubmissionStatus.pending || result === SubmissionStatus.judging
}

interface Student {
  username: string
  /** 题号 → 这道题上的每一次，从早到晚 */
  byProblem: Map<string, Attempt[]>
  total: number
  accepted: number
  /** 判完的条数，正确率的分母（和数字行一个口径：还在判的不算） */
  judged: number
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
      byProblem,
      total: row.submissions.length,
      accepted: row.submissions.filter((item) => isAc(item.result)).length,
      judged: row.submissions.filter((item) => !isPending(item.result)).length,
      last: row.submissions.at(-1)?.createTime ?? null,
    }
  })
  const seen = new Set(list.map((item) => item.username))
  for (const row of props.stats.dataUnaccepted) {
    if (seen.has(row.username)) continue
    list.push({
      username: row.username,
      byProblem: new Map(),
      total: 0,
      accepted: 0,
      judged: 0,
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

/**
 * 答案对了、但「语法未通过」（AST 规则没按要求写），而且没有一次真正的「答案正确」。
 * 这类算做对了（全站口径），但教学上没达标，格子上单独标出来
 */
function astOnlyOn(student: Student, pid: string) {
  const items = student.byProblem.get(pid) ?? []
  return (
    items.some((item) => item.result === SubmissionStatus.ast_check_failed) &&
    !items.some((item) => item.result === SubmissionStatus.accepted)
  )
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

/** 算「做完」要做对几道：填了题号就要全对，没填就是做对过题 */
const needed = computed(() => (props.explicit ? problems.value.length : 1))
function finished(student: Student) {
  return problems.value.length > 0 && doneCount(student) >= needed.value
}
const doneLabel = computed(() => (props.explicit ? "做完" : "做对过题"))

const allDone = computed(() => students.value.filter(finished).length)

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
        a.student.username.localeCompare(b.student.username, "zh-CN"),
    )
})

/** 全部题：没做完的在前（交得多的更前），一道没交的其次，全做完的沉底 */
const allStudents = computed(() => {
  // 这段时间没人交：没有题可言，别列一排「0 道」
  if (!problems.value.length) return []
  const list = students.value.map((student) => ({
    student,
    done: doneCount(student),
    finished: finished(student),
  }))
  const rank = (row: (typeof list)[number]) => (row.finished ? 2 : row.student.total ? 0 : 1)
  return list
    .filter((row) => !onlyUnfinished.value || !row.finished)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.student.total - a.student.total ||
        a.student.username.localeCompare(b.student.username, "zh-CN"),
    )
})

const unfinishedCount = computed(() =>
  focus.value
    ? students.value.filter((student) => !solvedOn(student, focus.value)).length
    : students.value.filter((student) => !finished(student)).length,
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
  return student.judged ? `${Math.round((student.accepted / student.judged) * 100)}%` : "—"
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
            <span class="muted">{{ doneLabel }} {{ allDone }}/{{ personCount }} 人</span>
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
        <template v-else-if="!problems.length">
          <b class="s-title">这段时间没有人交</b>
          <span class="muted">换个时间段试试，比如「今天」或「最近 7 天」</span>
        </template>
        <template v-else>
          <b class="s-title">全部 {{ problems.length }} 道</b>
          <span class="muted">
            {{ doneLabel }} {{ allDone }}/{{ personCount }} · 没做完 {{ unfinishedCount }} ·
            一道没交
            {{ stats.dataUnaccepted.length }}
          </span>
        </template>
        <span class="spacer"></span>
        <button
          v-if="problems.length"
          class="chip"
          :class="{ on: onlyUnfinished }"
          @click="onlyUnfinished = true"
        >
          没做完 <span class="n">{{ unfinishedCount }}</span>
        </button>
        <button
          v-if="problems.length"
          class="chip"
          :class="{ on: !onlyUnfinished }"
          @click="onlyUnfinished = false"
        >
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
            <UserName :username="row.student.username" class="c-name" />
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
        <div v-if="problems.length" class="cols">
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
              role="button"
              tabindex="0"
              :aria-expanded="expanded === row.student.username"
              @click="toggle(row.student.username)"
              @keydown.enter.prevent="toggle(row.student.username)"
              @keydown.space.prevent="toggle(row.student.username)"
            >
              <span class="c-caret">
                <Icon
                  :icon="
                    expanded === row.student.username ? 'ph:caret-down-bold' : 'ph:caret-right-bold'
                  "
                  :width="12"
                />
              </span>
              <UserName :username="row.student.username" class="c-name" />
              <span
                class="c-done done"
                :style="{
                  color: row.finished
                    ? tone('success').color
                    : row.student.total
                      ? theme.textColor1
                      : tone('error').color,
                }"
              >
                {{ explicit ? `${row.done}/${problems.length}` : `${row.done} 道` }}
              </span>
              <span class="c-n muted">{{ row.student.total }}</span>
              <span class="c-rate muted">{{ rate(row.student) }}</span>
              <span class="c-grid cells">
                <span
                  v-for="problem in problems"
                  :key="problem.problemDisplayId"
                  class="cell"
                  :title="
                    problem.problemDisplayId +
                    ' ' +
                    problem.title +
                    (astOnlyOn(row.student, problem.problemDisplayId)
                      ? '：答案对了，但没按要求的写法写'
                      : '')
                  "
                  :style="
                    astOnlyOn(row.student, problem.problemDisplayId)
                      ? { background: tone('warning').background, color: tone('warning').color }
                      : solvedOn(row.student, problem.problemDisplayId)
                        ? { background: tone('success').solid, color: isDark ? '#18181c' : '#fff' }
                        : row.student.byProblem.has(problem.problemDisplayId)
                          ? { background: tone('error').background, color: tone('error').color }
                          : { background: theme.actionColor, color: theme.textColor3 }
                  "
                >
                  {{
                    astOnlyOn(row.student, problem.problemDisplayId)
                      ? "语"
                      : solvedOn(row.student, problem.problemDisplayId)
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
          <div v-if="problems.length && !allStudents.length" class="empty">全都做完了</div>
        </div>
      </template>
      <div v-if="grid.truncated" class="truncated">
        范围太大，只取了最近的 5000 条提交：上面一排数字是全部算的，左边每道题的「做完」、
        右边的名单和方块串只按这 5000 条算，更早交的人可能不在里面。缩短时间段就准了。
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
  width: 404px; /* 380 + 放大一档后多出的留白和字宽，「求两门课程成绩总分(1)」在 1280 下要放得下 */
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid v-bind("theme.dividerColor");
  min-height: 0;
}

.col-head {
  height: 40px;
  flex: none;
  box-sizing: border-box;
  padding: 0 16px 0 var(--oj-pad-x);
  display: flex;
  align-items: center;
  font-size: var(--oj-fs-meta);
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
  height: 56px;
  box-sizing: border-box;
  padding: 0 16px 0 var(--oj-pad-x);
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
  font-size: var(--oj-fs-meta);
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
  height: 52px;
  flex: none;
  box-sizing: border-box;
  padding: 0 var(--oj-pad-x);
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  white-space: nowrap;
}

.s-title {
  font-size: var(--oj-fs-h2);
}

.chip {
  height: 32px;
  padding: 0 14px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 16px;
  background: transparent;
  font: inherit;
  font-size: var(--oj-fs-sec);
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
  height: 40px;
  flex: none;
  box-sizing: border-box;
  padding: 0 var(--oj-pad-x);
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--oj-fs-meta);
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
  min-height: 46px;
  box-sizing: border-box;
  padding: 8px var(--oj-pad-x);
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

.done {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.none {
  font-size: var(--oj-fs-sec);
}

.cells {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  white-space: normal;
}

.cell {
  width: 30px;
  height: 20px;
  border-radius: 4px;
  font-size: 12px;
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
  font-size: var(--oj-fs-meta);
}

.empty {
  padding: 40px 16px;
  text-align: center;
  color: v-bind("theme.textColor3");
}

.truncated {
  padding: 10px var(--oj-pad-x);
  font-size: var(--oj-fs-meta);
  color: v-bind("tone('warning').color");
  border-top: 1px solid v-bind("theme.dividerColor");
}

/* 手机：题目在上、学生在下，整页滚动 */
@media (max-width: 767px) {
  .code-stats {
    flex-direction: column;
    flex: none;
  }

  .problems {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid v-bind("theme.dividerColor");
  }

  .problem-list,
  .rows {
    flex: none;
    overflow: visible;
  }

  .s-head {
    height: auto;
    flex-wrap: wrap;
    padding: 8px 14px;
    row-gap: 6px;
    white-space: normal;
  }

  .cols {
    display: none;
  }

  .row {
    flex-wrap: wrap;
    padding: 8px 14px;
    row-gap: 6px;
  }

  .c-seq,
  .c-grid {
    flex-basis: 100%;
  }

  .c-when {
    display: none;
  }

  .detail {
    padding-left: 14px;
  }
}
</style>

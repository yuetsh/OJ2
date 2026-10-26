<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import type { LearnBoard, LearnBoardStudent, LearnExerciseProgress } from 'utils/types'
import { getLearnBoard, getLearnExercises } from 'admin/api'
import { parseTime, readableDuration } from 'utils/functions'
import { useConfigStore } from 'shared/store/config'
import UserName from 'shared/components/UserName.vue'
import { groupClassOptions } from 'utils/classes'
import { groupByProject, splitTitle, type TutorialType } from 'oj/learn/lesson'
import 'oj/learn/learn.css'
import ExerciseAttempts from './ExerciseAttempts.vue'
import ProblemReaders, { type ProblemReader } from './ProblemReaders.vue'
import StudentDrawer from './StudentDrawer.vue'
import { EXERCISE_KIND } from './kinds'

/**
 * 自学情况（设计稿「后台 · 自学情况」）：一个班学到哪了。
 *
 * 中间是学生 × 课的方块格（浅绿 = 打开过，绿 = 学完，也就是练一练全对；练一练做了一部分的
 * 按做对的比例从下往上涨绿，一道没做对的底下压一条橙），一课没打开过的学生收成一串名单。
 * 点名字看这个人每课每道练一练、每道配套题的明细；右边按课看练一练和配套题做对了多少，
 * 点一道看每个人的情况。配套题做对不论早晚，读这课之前在课上做对的也算。
 * 不选班就按排名页同一套规则猜老师在教哪个班。
 */
const configStore = useConfigStore()
const theme = useThemeVars()

const type = ref<TutorialType>('python')
const className = ref<string | null>(null)
const board = ref<LearnBoard | null>(null)
const exercises = ref<LearnExerciseProgress[]>([])
const lessonId = ref<number | null>(null)
const expanded = ref<number | null>(null)
const side = ref<'exercise' | 'problem'>('exercise')
const problemOpen = ref<number | null>(null)
const studentId = ref<number | null>(null)
const showStudent = ref(false)
const loading = ref(false)

const classOptions = computed(() => groupClassOptions(configStore.config?.classList ?? []))
const groups = computed(() => groupByProject((board.value?.tutorials ?? []).map(({ id, title, project }) => ({ id, title, project }))))
const started = computed(() =>
  (board.value?.students ?? [])
    .filter((row) => row.opened.length || row.exerciseSolved)
    .sort((a, b) => b.done.length - a.done.length || b.opened.length - a.opened.length || (b.lastViewedAt ?? '').localeCompare(a.lastViewedAt ?? '')),
)
const idle = computed(() => (board.value?.students ?? []).filter((row) => !row.opened.length && !row.exerciseSolved))
const finishedOne = computed(() => started.value.filter((row) => row.done.length > 0).length)
const avgSeconds = computed(() => {
  const rows = started.value
  return rows.length ? Math.round(rows.reduce((n, row) => n + row.totalSeconds, 0) / rows.length) : 0
})
const openedCount = computed(() => {
  const counts = new Map<number, number>()
  for (const row of board.value?.students ?? []) {
    for (const id of row.opened) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
})
const lessonProblems = computed(() => new Map((board.value?.tutorials ?? []).map((row) => [row.id, row.problems])))
/** 学生 → 题 → 交过的情况 */
const problemStates = computed(
  () => new Map((board.value?.students ?? []).map((row) => [row.userId, new Map(row.problems.map((problem) => [problem.problemId, problem]))])),
)
const exerciseTotal = computed(() => new Map((board.value?.tutorials ?? []).map((row) => [row.id, row.exerciseTotal])))
const steps = computed(() => new Map(groups.value.flatMap((group) => group.lessons.map((lesson) => [lesson.id, lesson.step]))))
const maxOpened = computed(() => Math.max(1, ...openedCount.value.values()))
const lessonOptions = computed(() =>
  groups.value.flatMap((group) =>
    group.lessons.map((lesson) => ({
      label: `第 ${lesson.step} 课 ${splitTitle(lesson.title).kp}`,
      value: lesson.id,
    })),
  ),
)
const lessonExercises = computed(() => exercises.value.filter((row) => row.tutorialId === lessonId.value))
/** 读过（或做过练一练）这一课的人 */
function readersOf(id: number) {
  return started.value.filter((row) => row.opened.includes(id) || row.lessons.some((lesson) => lesson.tutorialId === id))
}
const sideProblems = computed(() => {
  const id = lessonId.value
  if (id === null) return []
  const readers = readersOf(id)
  return (lessonProblems.value.get(id) ?? []).map((problem) => {
    const people: ProblemReader[] = readers.map((row) => ({
      userId: row.userId,
      username: row.username,
      state: problemStates.value.get(row.userId)?.get(problem.id) ?? null,
    }))
    return {
      ...problem,
      people,
      solved: people.filter((person) => person.state?.solved).length,
    }
  })
})
const openProblem = computed(() => sideProblems.value.find((row) => row.id === problemOpen.value))

function lessonOf(row: LearnBoardStudent, id: number) {
  return row.lessons.find((lesson) => lesson.tutorialId === id)
}

function cellOf(row: LearnBoardStudent, id: number) {
  if (row.done.includes(id)) return 'done'
  const lesson = lessonOf(row, id)
  if (lesson) return lesson.solved ? 'partial' : 'partial stuck'
  if (row.opened.includes(id)) return 'opened'
  return ''
}

/** 做了一部分的格子：做对几成，绿就从下往上涨几成 */
function cellStyle(row: LearnBoardStudent, id: number) {
  const lesson = lessonOf(row, id)
  const total = exerciseTotal.value.get(id) ?? 0
  if (!lesson || !total || row.done.includes(id)) return undefined
  return { '--fill': `${Math.round((lesson.solved / total) * 100)}%` }
}

function cellTitle(row: LearnBoardStudent, step: number, title: string, id: number) {
  const head = `第 ${step} 课 ${splitTitle(title).kp}`
  const total = exerciseTotal.value.get(id) ?? 0
  const lesson = lessonOf(row, id)
  const wrong = lesson?.wrongAttempts ? `，错了 ${lesson.wrongAttempts} 次` : ''
  const problems = lessonProblems.value.get(id) ?? []
  const states = problemStates.value.get(row.userId)
  const tail = problems.length ? ` · 配套题 ${problems.filter((problem) => states?.get(problem.id)?.solved).length}/${problems.length}` : ''
  if (row.done.includes(id)) return `${head}：学完了${wrong}${tail}`
  if (lesson) return `${head}：练一练 ${lesson.solved}/${total}${wrong}${tail}`
  if (row.opened.includes(id)) return `${head}：${total ? '打开过，练一练没做' : '打开过'}${tail}`
  return `${head}：没打开`
}

/** 他打开过或做过练一练的那些课 */
function touched(row: LearnBoardStudent) {
  return new Set([...row.opened, ...row.lessons.map((lesson) => lesson.tutorialId)])
}

/** 应做 = 他碰过的那些课，练一练加起来几道 */
function exerciseDue(row: LearnBoardStudent) {
  let due = 0
  for (const id of touched(row)) due += exerciseTotal.value.get(id) ?? 0
  return due
}

/** 他碰过的那些课的配套题，做对几道 / 一共几道（一道题挂在两课只算一次） */
function problemCount(row: LearnBoardStudent) {
  const ids = new Set<number>()
  for (const id of touched(row)) {
    for (const problem of lessonProblems.value.get(id) ?? []) ids.add(problem.id)
  }
  const states = problemStates.value.get(row.userId)
  let solved = 0
  for (const id of ids) if (states?.get(id)?.solved) solved++
  return { solved, total: ids.size }
}

function openStudent(row: LearnBoardStudent) {
  studentId.value = row.userId
  showStudent.value = true
}

function flag(row: LearnExerciseProgress) {
  if (row.triedUsers < 3) return ''
  if (row.firstTryUsers === 0 && row.solvedUsers > 0) return '没人一次对'
  if (row.solvedUsers / row.triedUsers < 0.5) return '多数人卡住'
  return ''
}

async function load() {
  loading.value = true
  expanded.value = null
  try {
    const params = { type: type.value, ...(className.value ? { className: className.value } : {}) }
    const data = await getLearnBoard(params)
    board.value = data
    className.value = data.className
    const ex = data.className ? await getLearnExercises({ type: type.value, className: data.className }) : { results: [] }
    exercises.value = ex.results
    // 练一练默认看大家打开得最多的那课
    const busiest = [...openedCount.value.entries()].sort((a, b) => b[1] - a[1])[0]
    lessonId.value = busiest?.[0] ?? data.tutorials[0]?.id ?? null
  } finally {
    loading.value = false
  }
}

function pickType(value: TutorialType) {
  type.value = value
  load()
}

watch(className, (value, old) => {
  if (old !== null && value !== old) load()
})
onMounted(load)
</script>

<template>
  <div class="page">
    <div class="top">
      <span class="title">自学情况</span>
      <span class="grow" />
      <div class="seg">
        <button type="button" :class="{ on: type === 'python' }" @click="pickType('python')">Python</button>
        <button type="button" :class="{ on: type === 'c' }" @click="pickType('c')">C 语言</button>
      </div>
      <n-select v-model:value="className" :options="classOptions" filterable placeholder="选班级" class="class-select" />
    </div>

    <n-spin :show="loading">
      <n-empty v-if="board && !board.className" description="选一个班看看" style="margin: 60px 0" />
      <template v-else-if="board">
        <div class="stats">
          <div class="stat">
            <div class="stat-label">打开过教程</div>
            <div class="stat-value">
              {{ started.length }}<span class="unit"> / {{ board.students.length }} 人</span>
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">学完过至少一课</div>
            <div class="stat-value">{{ finishedOne }}<span class="unit"> 人</span></div>
          </div>
          <div class="stat">
            <div class="stat-label">人均停留</div>
            <div class="stat-value">{{ readableDuration(avgSeconds) }}</div>
          </div>
        </div>

        <div class="main">
          <section class="card grid-card">
            <div class="grid-scroll">
              <div class="line head">
                <span class="c-name strong">学到哪了</span>
                <div class="cells-head">
                  <div v-for="group in groups" :key="group.lessons[0]!.id" class="group-head">
                    <span class="group-no" :title="group.project">{{ group.no || group.name }}</span>
                    <span class="group-steps">
                      <span v-for="lesson in group.lessons" :key="lesson.id" class="step" :title="splitTitle(lesson.title).kp">
                        {{ lesson.step }}
                      </span>
                    </span>
                  </div>
                </div>
                <span class="c-num muted">练一练</span>
                <span class="c-num muted">配套题</span>
                <span class="c-stay muted">停留</span>
                <span class="c-last muted">最后学习</span>
              </div>
              <div v-for="row in started" :key="row.userId" class="line">
                <button type="button" class="c-name name-btn" @click="openStudent(row)">
                  <UserName :username="row.username" />
                </button>
                <div class="cells">
                  <div v-for="group in groups" :key="group.lessons[0]!.id" class="group-cells">
                    <span
                      v-for="lesson in group.lessons"
                      :key="lesson.id"
                      class="cell"
                      :class="cellOf(row, lesson.id)"
                      :style="cellStyle(row, lesson.id)"
                      :title="cellTitle(row, lesson.step, lesson.title, lesson.id)"
                    />
                  </div>
                </div>
                <span class="c-num num">
                  <template v-if="exerciseDue(row)"
                    >{{ row.exerciseSolved }}<span class="muted">/{{ exerciseDue(row) }}</span></template
                  >
                  <template v-else>-</template>
                </span>
                <span class="c-num num">
                  <template v-if="problemCount(row).total"
                    >{{ problemCount(row).solved }}<span class="muted">/{{ problemCount(row).total }}</span></template
                  >
                  <template v-else>-</template>
                </span>
                <span class="c-stay num">{{ readableDuration(row.totalSeconds) }}</span>
                <span class="c-last num muted">{{ row.lastViewedAt ? parseTime(row.lastViewedAt, 'M月D日') : '-' }}</span>
              </div>
              <div v-if="!started.length" class="none muted">这个班还没人打开过</div>
              <div v-else class="line foot">
                <span class="c-name muted small">每课打开过</span>
                <div class="cells bars">
                  <div v-for="group in groups" :key="group.lessons[0]!.id" class="group-cells">
                    <span v-for="lesson in group.lessons" :key="lesson.id" class="bar-col">
                      <span class="bar-num num">{{ openedCount.get(lesson.id) || '' }}</span>
                      <span
                        class="bar"
                        :class="{ zero: !openedCount.get(lesson.id) }"
                        :style="{
                          height: `${Math.max(2, ((openedCount.get(lesson.id) ?? 0) / maxOpened) * 40)}px`,
                        }"
                      />
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="idle.length" class="idle">
              <div class="idle-head">
                <span class="strong">还没打开过</span>
                <span class="muted num">{{ idle.length }} 人</span>
              </div>
              <div class="chips">
                <span v-for="row in idle" :key="row.userId" class="chip"><UserName :username="row.username" /></span>
              </div>
            </div>
          </section>

          <section class="card side">
            <div class="side-head">
              <div class="seg small">
                <button type="button" :class="{ on: side === 'exercise' }" @click="side = 'exercise'">练一练</button>
                <button type="button" :class="{ on: side === 'problem' }" @click="side = 'problem'">配套题</button>
              </div>
              <n-select v-model:value="lessonId" :options="lessonOptions" size="small" class="lesson-select" />
            </div>
            <template v-if="side === 'problem'">
              <div v-if="!sideProblems.length" class="muted none">这课没有配套题</div>
              <div v-for="row in sideProblems" :key="row.id" class="ex">
                <button type="button" class="ex-main" @click="problemOpen = row.id">
                  <span class="ex-line">
                    <span class="kind num">{{ row.displayId }}</span>
                    <span class="question">{{ row.title }}</span>
                    <Icon icon="ph:caret-right-bold" :width="12" class="muted" />
                  </span>
                  <span class="ex-line small num">
                    <span>做对 {{ row.solved }} / 读过 {{ row.people.length }}</span>
                  </span>
                </button>
              </div>
            </template>
            <div v-else-if="!lessonExercises.length" class="muted none">这课没有练一练</div>
            <div v-for="row in side === 'exercise' ? lessonExercises : []" :key="row.exerciseId" class="ex">
              <button type="button" class="ex-main" @click="expanded = row.exerciseId">
                <span class="ex-line">
                  <span class="kind">{{ EXERCISE_KIND[row.type] ?? row.type }}</span>
                  <span class="question">{{ row.question || '（没有题干）' }}</span>
                  <Icon icon="ph:caret-right-bold" :width="12" class="muted" />
                </span>
                <span class="ex-line small num">
                  <span>做对 {{ row.solvedUsers }} / 做过 {{ row.triedUsers }}</span>
                  <span class="muted">一次就对 {{ row.firstTryUsers }}</span>
                  <span v-if="flag(row)" class="flag">{{ flag(row) }}</span>
                </span>
              </button>
            </div>
          </section>
        </div>
      </template>
    </n-spin>

    <!-- 点一道练一练：每个人做了几次、最后一次错在哪 -->
    <n-modal
      :show="expanded !== null"
      preset="card"
      :title="exercises.find((row) => row.exerciseId === expanded)?.question || '练一练'"
      style="width: 820px; max-width: 95vw"
      @update:show="(show: boolean) => !show && (expanded = null)"
    >
      <ExerciseAttempts v-if="expanded !== null" :exercise-id="expanded" :class-name="board?.className ?? ''" />
    </n-modal>

    <!-- 点一道配套题：读过这课的人各自做没做对 -->
    <n-modal
      :show="problemOpen !== null"
      preset="card"
      :title="openProblem ? `${openProblem.displayId} ${openProblem.title}` : '配套题'"
      style="width: 640px; max-width: 95vw"
      @update:show="(show: boolean) => !show && (problemOpen = null)"
    >
      <ProblemReaders v-if="openProblem" :display-id="openProblem.displayId" :people="openProblem.people" />
    </n-modal>

    <StudentDrawer v-model:show="showStudent" :user-id="studentId" :type="type" :steps="steps" />
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
}
.seg button:first-child {
  border-radius: 4px 0 0 4px;
}
.seg button:last-child {
  border-radius: 0 4px 4px 0;
  margin-left: -1px;
}
.seg.small {
  flex-shrink: 0;
}
.seg.small button {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  white-space: nowrap;
}
.seg button.on {
  border-color: #18a058;
  color: var(--learn-green-text);
  font-weight: 600;
  position: relative;
}
.card {
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 8px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat {
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 8px;
  padding: 14px 18px;
}
.stat-label {
  font-size: 13px;
  opacity: 0.6;
}
.stat-value {
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.unit {
  font-size: 15px;
  font-weight: 400;
  opacity: 0.6;
}
.main {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.grid-card {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.grid-scroll {
  overflow-x: auto;
}
.line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 16px;
  border-top: 1px solid rgba(128, 128, 128, 0.1);
  width: max-content;
  min-width: 100%;
  box-sizing: border-box;
}
.line.head {
  align-items: flex-end;
  padding-top: 12px;
  padding-bottom: 6px;
  border-top: 0;
}
.c-name {
  width: 110px;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
}
.cells,
.cells-head {
  display: flex;
  gap: 6px;
}
.group-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.group-no {
  font-size: 11px;
  opacity: 0.6;
  text-align: center;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  padding-bottom: 2px;
  white-space: nowrap;
}
.group-steps,
.group-cells {
  display: flex;
  gap: 2px;
}
.step {
  width: 18px;
  text-align: center;
  font-size: 11px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.cell {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.12);
}
.cell.opened {
  background: rgba(24, 160, 88, 0.3);
}
.cell.done {
  background: #18a058;
}
.cell.partial {
  background: linear-gradient(to top, #18a058 var(--fill), rgba(24, 160, 88, 0.3) var(--fill));
}
.cell.stuck {
  box-shadow: inset 0 -4px 0 v-bind('theme.warningColor');
}
.name-btn {
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.name-btn :deep(.name) {
  color: v-bind('theme.primaryColor');
}
.name-btn:hover :deep(.name) {
  text-decoration: underline;
}
.c-num {
  width: 44px;
  text-align: right;
  font-size: 13px;
  flex-shrink: 0;
}
.c-stay {
  width: 70px;
  text-align: right;
  font-size: 13px;
  white-space: nowrap;
  flex-shrink: 0;
}
.c-last {
  width: 64px;
  text-align: right;
  font-size: 13px;
  white-space: nowrap;
  flex-shrink: 0;
}
.foot {
  align-items: flex-end;
  padding-top: 10px;
  padding-bottom: 12px;
  border-top-color: rgba(128, 128, 128, 0.22);
}
.bars {
  align-items: flex-end;
}
.bars .group-cells {
  align-items: flex-end;
}
.bar-col {
  width: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.bar-num {
  font-size: 11px;
  opacity: 0.8;
}
.bar {
  width: 12px;
  border-radius: 2px;
  background: rgba(24, 160, 88, 0.45);
}
.bar.zero {
  background: rgba(128, 128, 128, 0.2);
}
.none {
  padding: 16px;
  font-size: 13px;
}
.idle {
  padding: 14px 16px 16px;
  border-top: 1px solid rgba(128, 128, 128, 0.22);
}
.idle-head {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 14px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  height: 26px;
  padding: 0 10px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 13px;
  display: inline-flex;
  align-items: center;
  font-size: 12px;
}
.side {
  width: 250px;
  flex-shrink: 0;
  padding: 14px 16px;
}
.side-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.ex {
  border-top: 1px solid rgba(128, 128, 128, 0.12);
}
.ex-main {
  width: 100%;
  padding: 10px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
}
.ex-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.kind {
  height: 22px;
  padding: 0 8px;
  border-radius: 3px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  background: rgba(128, 128, 128, 0.12);
  flex-shrink: 0;
}
.question {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.flag {
  color: var(--learn-orange-text);
}
.class-select {
  width: 170px;
}
.lesson-select {
  flex: 1 0 100%;
  min-width: 0;
}

/* 手机上：方块格在自己的框里横着滑（名字列钉在左边），练一练排到下面 */
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
  .class-select {
    flex: 1;
    width: auto;
    min-width: 0;
  }
  .stats {
    gap: 8px;
    margin-bottom: 12px;
  }
  .stat {
    padding: 10px 12px;
  }
  .stat-label {
    font-size: 12px;
  }
  .stat-value {
    font-size: 18px;
  }
  .unit {
    font-size: 13px;
  }
  .main {
    flex-direction: column;
    align-items: stretch;
  }
  .c-name {
    position: sticky;
    left: 0;
    z-index: 1;
    width: 96px;
    margin-left: -16px;
    padding-left: 16px;
    background: v-bind('theme.bodyColor');
  }
  .side {
    width: auto;
  }
}
</style>

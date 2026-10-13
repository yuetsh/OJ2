<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { getClassBoard, setClassLesson } from "oj/api"
import { useTone } from "oj/submission/composables/tone"
import { groupClassOptions } from "oj/submission/utils"
import UserName from "shared/components/UserName.vue"
import { useLeaveStudents } from "shared/composables/leaveStudents"
import { useCollabStore } from "shared/store/collab"
import { useConfigStore } from "shared/store/config"
import type { LessonLanguage } from "@oj2/contract"
import { errorMessage } from "utils/api"
import { LANGUAGE_SHOW_VALUE } from "utils/constants"
import { parseTime } from "utils/functions"
import type { ClassBoard, ClassBoardCell, ClassBoardProblem, ClassBoardStudent } from "utils/types"
import ExplainModal, { type ExplainPerson } from "./components/ExplainModal.vue"
import { errorKind, type ErrorKind } from "./errorKind"

/**
 * 课堂看板（老师，设计稿「课堂看板重设计」A+B）：这个班、今天、这节课的几道题 × 全班学生。
 *
 * 用法（用户说的）：开在教师电脑上，不投影；看完成情况、谁卡住了，讲没交对的代码错在哪；
 * 题号是上课时当场填的。所以：
 * - 顶上一行是班级和这节课的题，题号当场填，填完收成一排小块；
 * - 一排题卡片（做对 / 错着 / 没做），点一道题，下面把错着的人按错法归堆 —— 同一种错讲一遍；
 * - 全班一张表，按 举手 → 没交过 → 卡住 → 在做 → 做完 → 请假 排；
 * - 点红格子或堆里的名字，弹层里讲这份代码（和提交详情同一块），← → 换人。
 *
 * 班级**不记本地**，默认由后端猜最近两小时在交题的班 —— 记本地的话，上一节课的班会
 * 悄悄留在框里，老师看的整个是别人的班。
 */

/** 同一道题今天交了这么多次还没过，算卡住 */
const STUCK_ATTEMPTS = 3
const REFRESH_MS = 15_000

const configStore = useConfigStore()
const collabStore = useCollabStore()
const message = useMessage()
const theme = useThemeVars()
const tone = useTone()
const router = useRouter()

const board = ref<ClassBoard | null>(null)
const className = ref<string | null>(null)

const classOptions = computed(() => {
  const list = configStore.config?.classList ?? []
  return groupClassOptions(board.value?.className ? [board.value.className, ...list] : list)
})

async function load() {
  if (document.hidden) return
  try {
    const data = await getClassBoard(className.value ?? undefined)
    board.value = data
    // 第一次由后端猜，之后就固定在这个班上，别每次刷新都换
    className.value = data.className
  } catch (error) {
    message.error(errorMessage(error))
  }
}

function changeClass(value: string) {
  className.value = value
  selectedId.value = null
  editing.value = false
  load()
}

onMounted(load)
const { pause } = useIntervalFn(load, REFRESH_MS)
onUnmounted(pause)

// ---------- 这节课的题：上课时当场填 ----------

/**
 * 这份作业用什么语言做，跟着这一次布置走（用户定的：不是给班级定死的设置）。默认是这个班
 * 上一次布置时选的；选了之后看板和学生那边的「做完」都只认这个语言交对的
 */
const lessonLanguage = ref<LessonLanguage>("Python")
const LESSON_LANGUAGES: LessonLanguage[] = ["Python", "C", "C++", "SQL"]
const languageOptions = LESSON_LANGUAGES.map((value) => ({
  label: LANGUAGE_SHOW_VALUE[value],
  value,
}))
const lessonInput = ref("")
const editing = ref(false)
const saving = ref(false)

/** 还没有题（没布置、今天也推断不出来）：填题号的框就是这页最大的东西 */
const needLesson = computed(() => !!board.value?.className && !board.value.problems.length)

// 换了班要把输入框换成那个班今天布置的题、布置时选的语言（15 秒一次的刷新不动它们）
watch(
  () => [board.value?.className, board.value?.source] as const,
  () => resetLessonInput(),
)

function resetLessonInput() {
  lessonInput.value =
    board.value?.source === "teacher"
      ? board.value.problems.map((problem) => problem.problemDisplayId).join(" ")
      : ""
  lessonLanguage.value = board.value?.language ?? board.value?.lastLanguage ?? "Python"
}

function startEdit() {
  resetLessonInput()
  // 推断出来的题也带进框里，老师多半只是确认一下
  if (!lessonInput.value && board.value?.problems.length) {
    lessonInput.value = board.value.problems.map((problem) => problem.problemDisplayId).join(" ")
  }
  editing.value = true
}

async function saveLesson() {
  if (!className.value) return
  const ids = lessonInput.value.split(/[\s,，、;；]+/).filter(Boolean)
  saving.value = true
  try {
    await setClassLesson(className.value, ids, ids.length ? lessonLanguage.value : null)
    message.success(ids.length ? "已布置，学生首页会显示这几道题" : "已清掉")
    editing.value = false
    selectedId.value = null
    await load()
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

// ---------- 分组与排序 ----------

type Group = "help" | "idle" | "stuck" | "working" | "done" | "leave"

/**
 * 正在课堂求助的学生。列表是老师端 WebSocket 实时推的（collabStore，全局常驻连接），
 * 不经看板接口 —— 求助只在 serve 进程的内存里，本来就不落库。所以也只看得到连着
 * **本站**的学生：服务器和机房各有各的求助队列，和课堂求助本身一样。
 */
function helpOf(student: ClassBoardStudent) {
  return collabStore.requests.find((request) => request.studentId === student.userId) ?? null
}

/**
 * 经常不动手：最近几节课里最多只交过一节。至少有 3 节课可比才下结论，
 * 开学头两节谁都一样。没交过的人里把他们排在前面，「最后交」那格写上来过几节
 */
function oftenIdle(student: ClassBoardStudent) {
  const total = board.value?.recentLessons ?? 0
  return total >= 3 && student.recentAttended <= 1
}

function doneCount(student: ClassBoardStudent) {
  return student.cells.filter((cell) => cell.status === "accepted").length
}

function groupOf(student: ClassBoardStudent): Group {
  if (absent(student)) return "leave"
  if (helpOf(student)) return "help"
  const cells = student.cells
  if (cells.length && cells.every((cell) => cell.status === "accepted")) return "done"
  if (!student.lastSubmitAt) return "idle"
  if (cells.some((cell) => cell.status === "tried" && cell.attempts >= STUCK_ATTEMPTS))
    return "stuck"
  return "working"
}

const GROUP_ORDER: Record<Group, number> = {
  help: 0,
  idle: 1,
  stuck: 2,
  working: 3,
  done: 4,
  leave: 5,
}

const GROUP_LABEL: Record<Group, string> = {
  help: "举手了",
  idle: "还没交过",
  stuck: "卡住了",
  working: "在做",
  done: "全做完了",
  leave: "请假",
}

/**
 * 请假：老师在「请假」框里勾上今天不在的人，人数、进度、卡片都不算他们，
 * 表格里变灰排到最后（不藏掉 —— 标了谁、标错没有，一眼看得见）。
 * 今天有效，只记在这台电脑上（见 leaveStudents.ts）。
 *
 * **只有今天还没交过的人能算请假**：请假的人一定在这里面。标过的人后来交了题、或者举手了，
 * 就是来了（迟到），自动取消标记，回到正常的分组里 —— 老师得看得见他卡住、举手
 */
const { onLeave, setLeave, cancelLeave } = useLeaveStudents("oj_leave_students")
function canLeave(student: ClassBoardStudent) {
  return !student.lastSubmitAt && !helpOf(student)
}
function absent(student: ClassBoardStudent) {
  return canLeave(student) && onLeave(student.username)
}
const boardStudents = computed(() => board.value?.students ?? [])
const leaveStudents = computed(() => boardStudents.value.filter(absent).sort(byName))

// 标过请假、后来交了题或举手的：来了，把标记清掉（不然名单里一直挂着一个其实在的人）
watchEffect(() => {
  const arrived = boardStudents.value
    .filter((student) => !canLeave(student) && onLeave(student.username))
    .map((student) => student.username)
  if (arrived.length) cancelLeave(arrived)
})

const leaveDialog = ref(false)
/** 弹框里能勾的：今天还没交过的（刚上课时就是全班），按名字排 */
const leaveCandidates = computed(() => boardStudents.value.filter(canLeave).sort(byName))
const leaveSelected = ref<string[]>([])
function openLeaveDialog() {
  leaveSelected.value = leaveStudents.value.map((student) => student.username)
  leaveDialog.value = true
}
function saveLeave() {
  setLeave(
    boardStudents.value.map((student) => student.username),
    leaveSelected.value,
  )
  leaveDialog.value = false
}

function byName(a: ClassBoardStudent, b: ClassBoardStudent) {
  return a.username.localeCompare(b.username, "zh-CN")
}

const students = computed(() =>
  [...boardStudents.value].sort(
    (a, b) =>
      GROUP_ORDER[groupOf(a)] - GROUP_ORDER[groupOf(b)] ||
      // 同样是没交过，经常不动手的排前面
      Number(oftenIdle(b)) - Number(oftenIdle(a)) ||
      // 同样在做，做对得少的排前面（只做了一道的那几个）
      (groupOf(a) === "working" ? doneCount(a) - doneCount(b) : 0) ||
      byName(a, b),
  ),
)
/** 到了的人：人数、卡片都按这些算 */
const present = computed(() => students.value.filter((student) => groupOf(student) !== "leave"))
const groupCount = computed(() => {
  const count: Record<Group, number> = { help: 0, idle: 0, stuck: 0, working: 0, done: 0, leave: 0 }
  for (const student of students.value) count[groupOf(student)]++
  return count
})
/** 每组第一个人，在他上面插一行组名 */
const groupStarts = computed(() => {
  const starts = new Set<number>()
  let last: Group | null = null
  for (const student of students.value) {
    const group = groupOf(student)
    if (group !== last) starts.add(student.userId)
    last = group
  }
  return starts
})

// ---------- 题卡片和「错着的人按错法归堆」 ----------

interface WrongPerson {
  student: ClassBoardStudent
  cell: ClassBoardCell
  kind: ErrorKind
}

/**
 * 没做对的人：今天交过代码的按最后一次提交归错法。另外两种没有今天的代码可讲，单独成堆，
 * 和卡片上「错着 N」的 N 对得上：今天只画了流程图的，以前交过没做对、今天还没动的
 */
function wrongOf(index: number): WrongPerson[] {
  return present.value.flatMap((student) => {
    const cell = student.cells[index]
    if (!cell || cell.status !== "tried") return []
    const kind: ErrorKind = cell.latest
      ? errorKind(cell.latest)
      : cell.attempts
        ? { key: "flowchart", label: "今天只画了流程图", line: null }
        : { key: "before", label: "以前交过，今天还没交", line: null }
    return [{ student, cell, kind }]
  })
}

const problemStats = computed(() =>
  (board.value?.problems ?? []).map((problem, i) => {
    const done = present.value.filter((student) => student.cells[i]?.status === "accepted").length
    const wrong = present.value.filter((student) => student.cells[i]?.status === "tried").length
    const total = present.value.length
    return { problem, done, wrong, none: total - done - wrong, total }
  }),
)

const selectedId = ref<number | null>(null)
const selectedIndex = computed(() =>
  (board.value?.problems ?? []).findIndex((problem) => problem.problemId === selectedId.value),
)
function toggleProblem(problemId: number) {
  selectedId.value = selectedId.value === problemId ? null : problemId
}

/** 选中那道题错着的人，按错法归堆：人多的堆在前，堆里次数多的在前 */
const wrongGroups = computed(() => {
  if (selectedIndex.value < 0) return []
  const groups = new Map<string, { kind: ErrorKind; people: WrongPerson[] }>()
  for (const person of wrongOf(selectedIndex.value)) {
    const group = groups.get(person.kind.key) ?? { kind: person.kind, people: [] }
    group.people.push(person)
    groups.set(person.kind.key, group)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      people: group.people.sort((a, b) => b.cell.attempts - a.cell.attempts),
      // 一堆人报错指到同一行才写「第 N 行」
      line: group.people.every((p) => p.kind.line === group.people[0]!.kind.line)
        ? group.kind.line
        : null,
    }))
    .sort((a, b) => b.people.length - a.people.length)
})

// ---------- 讲错误的弹层 ----------

const explainShow = ref(false)
const explainIndex = ref(0)
const explainProblemIndex = ref(-1)
const explainProblem = computed(() => board.value?.problems[explainProblemIndex.value] ?? null)
/** 弹层顶上那排人：这道题错着的人，顺序和错法堆一样 */
const explainPeople = computed<ExplainPerson[]>(() => {
  if (explainProblemIndex.value < 0) return []
  const people = wrongOf(explainProblemIndex.value).filter((person) => person.cell.latest)
  const order = new Map<string, number>()
  for (const person of people) {
    order.set(person.kind.key, (order.get(person.kind.key) ?? 0) + 1)
  }
  return people
    .sort(
      (a, b) =>
        order.get(b.kind.key)! - order.get(a.kind.key)! ||
        a.kind.key.localeCompare(b.kind.key) ||
        b.cell.attempts - a.cell.attempts,
    )
    .map((person) => ({
      userId: person.student.userId,
      username: person.student.username,
      submissionId: person.cell.latest!.submissionId,
      label: person.kind.label,
    }))
})

function openExplain(problemIndex: number, userId: number) {
  explainProblemIndex.value = problemIndex
  explainIndex.value = Math.max(
    0,
    explainPeople.value.findIndex((person) => person.userId === userId),
  )
  explainShow.value = true
}

// ---------- 格子 ----------

/** 今天之前就通过了的，颜色淡一档 */
function acceptedToday(cell: ClassBoardCell) {
  return !!cell.acceptedAt && parseTime(cell.acceptedAt, "YYYY-MM-DD") === board.value?.day
}

function cellText(cell: ClassBoardCell) {
  if (cell.status === "accepted") return "✓"
  if (cell.status === "tried") return cell.attempts ? `✗ ${cell.attempts}` : "✗"
  return ""
}

function cellStyle(cell: ClassBoardCell) {
  if (cell.status === "accepted") {
    const t = tone("success")
    return acceptedToday(cell)
      ? { background: t.background, color: t.color }
      : { background: t.background, color: t.color, opacity: 0.5 }
  }
  if (cell.status === "tried") {
    if (cell.attempts >= STUCK_ATTEMPTS) {
      return { background: theme.value.errorColor, color: "#ffffff" }
    }
    const t = tone("warning")
    return { background: t.background, color: t.color }
  }
  return { background: theme.value.actionColor }
}

function cellTitle(cell: ClassBoardCell, student: ClassBoardStudent) {
  if (cell.status === "accepted") {
    return acceptedToday(cell) ? `${parseTime(cell.acceptedAt!, "HH:mm")} 做对` : "以前就做对了"
  }
  if (cell.status === "tried") {
    if (cell.latest) return `讲讲 ${student.username} 这道题的错`
    return cell.attempts ? `今天画了 ${cell.flowchartAttempts} 张流程图` : "以前交过，没做对"
  }
  return ""
}

/**
 * 点格子 / 名字到提交列表看他今天交的。新标签打开：看板一般开着不关，别把它顶掉。
 * 用户名按整名匹配（学号互相包含是常态，ks24a1 会混进 ks24a10）。
 *
 * 今天只画了流程图、没写代码的，跳到列表的「流程图」那边 —— 不然这节课整班在画流程图时，
 * 点进去是一片「没有符合条件的提交」
 */
function submissionsHref(
  student: ClassBoardStudent,
  problem: ClassBoardProblem | undefined,
  flowchart: boolean,
  /** 「以前交过、今天还没交」的人要看以前的，不能只列今天 */
  today = true,
) {
  // SQL 题不受布置的语言限制，格子数的是 SQL 交的
  const language = problem?.isSql ? "SQL" : board.value?.language
  return router.resolve({
    name: "submissions",
    query: {
      username: student.username,
      exactUsername: "1",
      ...(today ? { today: "1" } : {}),
      // 布置时选了语言的，代码那边只看这个语言交的（和格子里数的一致）
      ...(flowchart ? { language: "Flowchart" } : language ? { language } : {}),
      ...(problem ? { problem: problem.problemDisplayId } : {}),
    },
  }).href
}

function lastText(student: ClassBoardStudent) {
  if (student.lastSubmitAt) return parseTime(student.lastSubmitAt, "HH:mm")
  if (oftenIdle(student)) {
    return `近 ${board.value?.recentLessons} 节交过 ${student.recentAttended} 节`
  }
  return "—"
}

function shortTitle(title: string, size: number) {
  const chars = [...title]
  return chars.length <= size ? title : chars.slice(0, size - 1).join("") + "…"
}
</script>

<template>
  <div class="board">
    <div class="toolbar">
      <n-select
        :value="className"
        :options="classOptions"
        placeholder="选择班级"
        filterable
        class="class-select"
        @update:value="changeClass"
      />

      <!-- 这节课的题：当场填，填完收成一排小块 -->
      <div v-if="editing" class="lesson-edit">
        <n-select
          v-model:value="lessonLanguage"
          :options="languageOptions"
          aria-label="用什么语言做"
          class="lang-select"
        />
        <n-input
          v-model:value="lessonInput"
          placeholder="这节课的题号，用空格隔开"
          clearable
          autofocus
          @keyup.enter="saveLesson"
        />
        <n-button type="primary" :loading="saving" @click="saveLesson">布置</n-button>
        <n-button @click="editing = false">取消</n-button>
      </div>
      <div v-else-if="board?.problems.length" class="lesson">
        <span class="lesson-label">{{ board.source === "teacher" ? "这节课" : "今天在做" }}</span>
        <span v-if="board.language" class="chip lang">{{
          LANGUAGE_SHOW_VALUE[board.language]
        }}</span>
        <span v-for="problem in board.problems" :key="problem.problemId" class="chip">
          {{ problem.problemDisplayId }}
        </span>
        <span v-if="board.assignedAt" class="assigned">
          {{ parseTime(board.assignedAt, "HH:mm") }} 布置
        </span>
        <n-button text class="edit" @click="startEdit">
          <template #icon><Icon icon="ph:pencil-simple" /></template>
          {{ board.source === "teacher" ? "改" : "布置" }}
        </n-button>
      </div>

      <div class="spacer"></div>
      <n-button
        v-if="board?.className"
        :type="leaveStudents.length ? 'warning' : 'default'"
        :secondary="!!leaveStudents.length"
        @click="openLeaveDialog"
      >
        {{ leaveStudents.length ? `请假 ${leaveStudents.length} 人` : "请假" }}
      </n-button>
      <!-- 看板只管今天；以前几节课的、任意时间段的去统计（带上这个班） -->
      <n-button @click="router.push({ name: 'statistics', query: className ? { className } : {} })">
        回头看 →
      </n-button>
    </div>

    <n-empty
      v-if="board && !board.className"
      description="最近两小时没有哪个班在交题，先在上面选一个班"
      style="margin: 60px 0"
    />

    <template v-else-if="board">
      <!-- 刚上课还没有题：填题号的框是这页最大的东西 -->
      <section v-if="needLesson" class="start">
        <div class="start-title">这节课做哪几道题？</div>
        <div class="start-row">
          <n-select
            v-model:value="lessonLanguage"
            :options="languageOptions"
            aria-label="用什么语言做"
            size="large"
            class="lang-select"
          />
          <n-input
            v-model:value="lessonInput"
            size="large"
            placeholder="输入题号，用空格隔开"
            class="start-input"
            @keyup.enter="saveLesson"
          />
          <n-button type="primary" size="large" :loading="saving" @click="saveLesson">
            布置
          </n-button>
        </div>
      </section>

      <template v-else>
        <div class="cards">
          <button
            v-for="stat in problemStats"
            :key="stat.problem.problemId"
            type="button"
            class="card"
            :class="{ on: stat.problem.problemId === selectedId }"
            @click="toggleProblem(stat.problem.problemId)"
          >
            <span class="card-title">
              <b>{{ stat.problem.problemDisplayId }}</b>
              <span class="muted">{{ stat.problem.title }}</span>
            </span>
            <span class="card-done">
              <b>{{ stat.done }}</b
              ><span class="muted">/{{ stat.total }} 做对</span>
            </span>
            <span class="bar">
              <i :style="{ width: stat.total ? `${(stat.done / stat.total) * 100}%` : '0' }"></i>
            </span>
            <span class="card-foot">
              <span :class="stat.wrong ? 'wrong' : 'muted'">错着 {{ stat.wrong }}</span>
              <span class="muted">没做 {{ stat.none }}</span>
            </span>
          </button>
        </div>

        <section v-if="selectedIndex >= 0" class="panel">
          <div class="panel-head">
            <b class="panel-title">
              <span class="muted">{{ board.problems[selectedIndex]!.problemDisplayId }}</span>
              {{ board.problems[selectedIndex]!.title }}
            </b>
            <span>
              错着的 <b class="wrong">{{ problemStats[selectedIndex]!.wrong }}</b> 人
            </span>
            <span class="muted">没做 {{ problemStats[selectedIndex]!.none }} 人</span>
            <div class="spacer"></div>
            <n-button quaternary size="small" aria-label="收起" @click="selectedId = null">
              <template #icon><Icon icon="ph:x-bold" /></template>
            </n-button>
          </div>
          <div v-if="wrongGroups.length" class="groups">
            <div
              v-for="group in wrongGroups"
              :key="group.kind.key"
              class="err-group"
              :class="{ quiet: group.kind.key === 'before' || group.kind.key === 'flowchart' }"
            >
              <div class="err-title">
                {{ group.kind.label }}
                <span class="wrong">{{ group.people.length }} 人</span>
                <span v-if="group.line" class="muted"> · 第 {{ group.line }} 行</span>
              </div>
              <div class="err-people">
                <template v-for="person in group.people" :key="person.student.userId">
                  <button
                    v-if="person.cell.latest"
                    type="button"
                    class="who"
                    @click="openExplain(selectedIndex, person.student.userId)"
                  >
                    <UserName :username="person.student.username" />
                    <span class="mini" :style="cellStyle(person.cell)"
                      >✗ {{ person.cell.attempts }}</span
                    >
                  </button>
                  <!-- 没有今天的代码可讲：去提交列表看他交过的 -->
                  <a
                    v-else
                    class="who"
                    :href="
                      submissionsHref(
                        person.student,
                        board.problems[selectedIndex],
                        !!person.cell.attempts,
                        !!person.cell.attempts,
                      )
                    "
                    target="_blank"
                  >
                    <UserName :username="person.student.username" />
                  </a>
                </template>
              </div>
            </div>
          </div>
          <div v-else class="muted">这道题现在没有人错着</div>
        </section>
      </template>

      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="name">学生</th>
              <th
                v-for="(stat, i) in problemStats"
                :key="stat.problem.problemId"
                class="col"
                :class="{ hl: i === selectedIndex }"
                @click="toggleProblem(stat.problem.problemId)"
              >
                <div class="col-id">{{ stat.problem.problemDisplayId }}</div>
                <div class="col-title" :title="stat.problem.title">
                  {{ shortTitle(stat.problem.title, 6) }}
                </div>
                <div class="col-count">{{ stat.done }}/{{ stat.total }}</div>
                <div class="bar">
                  <i
                    :style="{ width: stat.total ? `${(stat.done / stat.total) * 100}%` : '0' }"
                  ></i>
                </div>
              </th>
              <th class="narrow-col">做对</th>
              <th class="narrow-col">最后交</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="student in students" :key="student.userId">
              <tr v-if="groupStarts.has(student.userId)" class="group-row">
                <td :colspan="board.problems.length + 3">
                  {{ GROUP_LABEL[groupOf(student)] }}
                  <span class="muted">{{ groupCount[groupOf(student)] }}</span>
                </td>
              </tr>
              <tr :class="{ 'leave-row': groupOf(student) === 'leave' }">
                <td class="name">
                  <a
                    v-if="student.codeToday || student.drawnToday"
                    class="plain"
                    :href="submissionsHref(student, undefined, !student.codeToday)"
                    target="_blank"
                    :title="`看 ${student.username} 今天交的全部`"
                  >
                    <UserName :username="student.username" />
                  </a>
                  <UserName v-else :username="student.username" />
                  <n-tag
                    v-if="helpOf(student)"
                    size="small"
                    :bordered="false"
                    type="warning"
                    class="help-tag"
                    @click="collabStore.helpPanelOpen = true"
                  >
                    {{ helpOf(student)!.status === "active" ? "老师在帮" : "举手了" }}
                  </n-tag>
                </td>
                <td
                  v-for="(cell, i) in student.cells"
                  :key="i"
                  :class="{ hl: i === selectedIndex }"
                >
                  <button
                    v-if="cell.status === 'tried' && cell.latest"
                    type="button"
                    class="cell"
                    :style="cellStyle(cell)"
                    :title="cellTitle(cell, student)"
                    @click="openExplain(i, student.userId)"
                  >
                    {{ cellText(cell) }}
                  </button>
                  <a
                    v-else-if="cell.attempts"
                    class="cell"
                    :style="cellStyle(cell)"
                    :href="submissionsHref(student, board.problems[i], !cell.codeAttempts)"
                    target="_blank"
                    :title="cellTitle(cell, student)"
                  >
                    {{ cellText(cell) }}
                  </a>
                  <span
                    v-else
                    class="cell"
                    :style="cellStyle(cell)"
                    :title="cellTitle(cell, student)"
                  >
                    {{ cellText(cell) }}
                  </span>
                </td>
                <td class="num">{{ doneCount(student) }}/{{ board.problems.length }}</td>
                <td class="num muted">{{ lastText(student) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>

    <ExplainModal
      v-model:show="explainShow"
      v-model:index="explainIndex"
      :problem="explainProblem"
      :people="explainPeople"
    />

    <n-modal
      v-model:show="leaveDialog"
      preset="card"
      :title="
        leaveCandidates.length
          ? `今天还没交过的 ${leaveCandidates.length} 人里，谁请假了？`
          : '今天全班都交过题了'
      "
      style="width: 640px; max-width: calc(100vw - 32px)"
    >
      <n-checkbox-group v-if="leaveCandidates.length" v-model:value="leaveSelected">
        <div class="leave-grid">
          <n-checkbox
            v-for="student in leaveCandidates"
            :key="student.userId"
            :value="student.username"
            :label="student.username"
            class="leave-option"
          />
        </div>
      </n-checkbox-group>
      <n-text v-else depth="3">请假的人一定是没交过题的，现在没有人可以标。</n-text>
      <template #footer>
        <n-flex align="center" :wrap="false">
          <n-text depth="3" class="meta" style="flex-grow: 1">
            已选 {{ leaveSelected.length }} 人 · 只记在这台电脑上，今天有效
          </n-text>
          <n-button :disabled="!leaveSelected.length" @click="leaveSelected = []">
            全部取消
          </n-button>
          <n-button @click="leaveDialog = false">取消</n-button>
          <n-button type="primary" @click="saveLeave">确定</n-button>
        </n-flex>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.board {
  max-width: 1286px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 8px;
}

.muted {
  color: v-bind("theme.textColor3");
}

.wrong {
  color: v-bind("theme.errorColor");
  font-weight: 600;
}

.spacer {
  flex: 1 1 0;
}

/* ---------- 顶上一行 ---------- */

.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.class-select {
  width: 160px;
}

.lang-select {
  width: 110px;
  flex-shrink: 0;
}

.lesson,
.lesson-edit {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.lesson-edit {
  flex: 1 1 520px;
  gap: 8px;
}

.lesson-label {
  margin-right: 4px;
  font-size: 14px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  border-radius: 4px;
  background: v-bind("theme.actionColor");
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.chip.lang {
  background: v-bind("tone('success').background");
  color: v-bind("tone('success').color");
  font-weight: 600;
}

.assigned {
  margin-left: 4px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}

.edit {
  margin-left: 4px;
  font-size: 14px;
  color: v-bind("theme.textColor2");
}

/* ---------- 刚上课 ---------- */

.start {
  padding: 22px 24px;
  border-radius: 10px;
  border: 1px solid v-bind("tone('success').background");
  background: v-bind("theme.cardColor");
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.start-title {
  font-size: 18px;
  font-weight: 600;
}

.start-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.start-input {
  flex: 1 1 0;
  font-size: 18px;
}

/* ---------- 题卡片 ---------- */

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid v-bind("theme.dividerColor");
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor1");
  font: inherit;
  text-align: left;
  min-width: 0;
  cursor: pointer;
}

.card:hover {
  border-color: v-bind("theme.borderColor");
}

.card.on {
  border-color: v-bind("theme.successColor");
  box-shadow: inset 0 0 0 1px v-bind("theme.successColor");
}

.card-title {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-title b {
  margin-right: 4px;
  font-variant-numeric: tabular-nums;
}

.card-done {
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-size: 13px;
}

.card-done b {
  font-size: 22px;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
}

.card-foot {
  display: flex;
  gap: 10px;
  font-size: 13px;
}

.bar {
  display: block;
  height: 4px;
  border-radius: 2px;
  background: v-bind("theme.actionColor");
  overflow: hidden;
}

.bar i {
  display: block;
  height: 4px;
  background: v-bind("theme.successColor");
}

/* ---------- 点开一道题：错着的人按错法归堆 ---------- */

.panel {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid v-bind("tone('success').background");
  background: v-bind("theme.cardColor");
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}

.panel-title {
  font-size: 16px;
}

.groups {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}

.err-group {
  min-width: 260px;
  padding: 10px 14px;
  border-radius: 8px;
  background: v-bind("tone('error').background");
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 今天没有代码可讲的两堆（以前交过 / 只画了流程图）不是今天的错，不用红底 */
.err-group.quiet {
  background: v-bind("theme.actionColor");
}

.err-title {
  font-size: 15px;
  font-weight: 600;
}

.err-people {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.who {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid v-bind("theme.dividerColor");
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor1");
  font: inherit;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}

a.who {
  text-decoration: none;
}

.who:hover {
  border-color: v-bind("theme.borderColor");
}

.mini {
  height: 22px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  font-variant-numeric: tabular-nums;
}

/* ---------- 全班一张表 ---------- */

.table-wrap {
  overflow-x: auto;
}

.grid {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  font-size: var(--oj-fs-body);
}

.grid th {
  padding: 8px 4px;
  font-weight: 400;
  vertical-align: bottom;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  white-space: nowrap;
}

.grid td {
  height: 40px;
  padding: 0 4px;
  text-align: center;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  white-space: nowrap;
}

.grid .name {
  width: 200px;
  padding-left: 12px;
  text-align: left;
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.grid td.name {
  font-size: inherit;
  color: inherit;
}

.grid th.col {
  width: 96px;
  cursor: pointer;
}

.grid th.narrow-col {
  width: 80px;
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.grid .hl {
  background: v-bind("tone('success').background");
}

.col-id {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.col-title {
  max-width: 88px;
  margin: 0 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.col-count {
  margin: 2px 0 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.grid th .bar {
  margin: 0 6px;
}

.group-row td {
  height: 34px;
  padding-left: 12px;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  background: v-bind("theme.actionColor");
}

.group-row .muted {
  margin-left: 4px;
  font-weight: 400;
}

.leave-row td {
  opacity: 0.45;
}

.cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 28px;
  box-sizing: border-box;
  border: 0;
  border-radius: 5px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-decoration: none;
  vertical-align: middle;
}

button.cell,
a.cell {
  cursor: pointer;
}

.num {
  font-variant-numeric: tabular-nums;
}

.plain {
  color: inherit;
  text-decoration: none;
}

.plain:hover {
  text-decoration: underline;
}

.help-tag {
  margin-left: 8px;
  cursor: pointer;
}

.leave-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px 8px;
}

.leave-option {
  font-size: 15px;
}

.meta {
  font-size: var(--oj-fs-sec);
}
</style>

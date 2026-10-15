<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { getClassBoard, setClassLesson } from "oj/api"
import { useTone } from "oj/submission/composables/tone"
import { groupClassOptions } from "oj/submission/utils"
import UserName from "shared/components/UserName.vue"
import { useLeaveStudents } from "shared/composables/leaveStudents"
import { useTeacherHelp } from "shared/composables/teacherHelp"
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
const route = useRoute()
const { help, peek } = useTeacherHelp()

const board = ref<ClassBoard | null>(null)
/**
 * 带着 ?className= 进来的（协作条「帮完了」回来、举手面板「讲这道题」）就看那个班，
 * 否则第一次由后端猜
 */
const queryText = (value: unknown) => (typeof value === "string" && value ? value : null)
const className = ref<string | null>(queryText(route.query.className))
/** ?problem= 带来的题号：加载完选中那道题，下面展开它的错法（「讲这道题」） */
let wantedProblem = queryText(route.query.problem)

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
    if (wantedProblem) {
      const wanted = wantedProblem.toLowerCase()
      const hit = data.problems.find((item) => item.problemDisplayId.toLowerCase() === wanted)
      if (hit) selectedId.value = hit.problemId
      wantedProblem = null
    }
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
// 已经停在看板上时又从举手面板点了「讲这道题」：同一条路由只换 query，组件不重建
watch(
  () => route.query,
  (query) => {
    wantedProblem = queryText(query.problem)
    const next = queryText(query.className)
    if (next && next !== className.value) {
      className.value = next
      editing.value = false
    }
    load()
  },
)

/** 举手多久了，每秒走一格 */
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, 1000) })
function waitedText(createdAt: number) {
  const seconds = Math.max(0, Math.floor((now.value.getTime() - createdAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
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

/**
 * 今天一次都没上过线。机房有两人共用一台电脑的，同桌只有一个登着，所以「谁没来」
 * 看今天上没上过线，不看此刻在不在线（见契约 seenAt）
 */
function unseen(student: ClassBoardStudent) {
  return !student.seenAt
}

/** 没在线的人最后一次上线是多久前，「在写」那格用 */
function seenText(seenAt: string) {
  const minutes = Math.max(0, Math.floor((now.value.getTime() - Date.parse(seenAt)) / 60_000))
  return minutes < 60 ? `${minutes} 分钟前在` : `${Math.floor(minutes / 60)} 小时前在`
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
/** 今天没上过线的分在前面一堆：请假的人基本在这里面，剩下的是和同桌共用电脑的 */
const leaveSections = computed(() =>
  [
    { label: "今天没上线", students: leaveCandidates.value.filter(unseen) },
    {
      label: "今天上过线",
      students: leaveCandidates.value.filter((student) => !unseen(student)),
    },
  ].filter((section) => section.students.length),
)
const leaveSelected = ref<string[]>([])
function selectAll(list: ClassBoardStudent[]) {
  leaveSelected.value = [
    ...new Set([...leaveSelected.value, ...list.map((student) => student.username)]),
  ]
}
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
      // 同样是没交过，今天没上过线的排最前（多半没来，好标请假），再是经常不动手的
      Number(unseen(b)) - Number(unseen(a)) ||
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
            <n-button
              quaternary
              size="small"
              class="panel-close"
              aria-label="收起"
              @click="selectedId = null"
            >
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
              <th class="narrow-col where-col">在线</th>
              <th
                v-for="(stat, i) in problemStats"
                :key="stat.problem.problemId"
                class="col"
                :class="{ hl: i === selectedIndex }"
                :style="{ width: `${100 / problemStats.length}%` }"
                @click="toggleProblem(stat.problem.problemId)"
              >
                <div class="col-id">{{ stat.problem.problemDisplayId }}</div>
                <div class="col-title" :title="stat.problem.title">
                  {{ stat.problem.title }}
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
                <td :colspan="board.problems.length + 4">
                  <span class="group-label">
                    {{ GROUP_LABEL[groupOf(student)] }}
                    <span class="muted">{{ groupCount[groupOf(student)] }}</span>
                  </span>
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
                  <span v-if="helpOf(student)?.status === 'pending'" class="waited">
                    举手 {{ waitedText(helpOf(student)!.createdAt) }}
                  </span>
                </td>
                <!-- 在线：举手的「帮他」；别人在帮的写谁在帮；开着题目的点题号直接打开他正在写的
                     代码（他没举手也行，他那边会显示「xxx 在看你的代码」）；剩下的写在不在线、
                     多久前在、今天没上过线 -->
                <td class="where-col">
                  <n-button
                    v-if="helpOf(student)?.status === 'pending'"
                    type="primary"
                    size="tiny"
                    @click="help(student.userId)"
                  >
                    帮他 · {{ helpOf(student)!.problemId }}
                  </n-button>
                  <span v-else-if="helpOf(student)" class="helping">
                    {{ helpOf(student)!.teacherName }} 在帮
                  </span>
                  <button
                    v-else-if="student.editing"
                    type="button"
                    class="where"
                    :title="`打开 ${student.username} 正在写的 ${student.editing}`"
                    @click="peek(student.userId)"
                  >
                    {{ student.editing }}
                  </button>
                  <span v-else-if="student.online" class="present">在线</span>
                  <span v-else-if="student.seenAt" class="seen">
                    {{ seenText(student.seenAt) }}
                  </span>
                  <span v-else class="seen">今天没上线</span>
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
        <div v-for="section in leaveSections" :key="section.label" class="leave-section">
          <div v-if="leaveSections.length > 1 || unseen(section.students[0])" class="leave-head">
            {{ section.label }} {{ section.students.length }} 人
            <n-button
              v-if="unseen(section.students[0])"
              text
              type="primary"
              :disabled="
                section.students.every((student) => leaveSelected.includes(student.username))
              "
              @click="selectAll(section.students)"
            >
              全勾上
            </n-button>
          </div>
          <div class="leave-grid">
            <n-checkbox
              v-for="student in section.students"
              :key="student.userId"
              :value="student.username"
              :label="student.username"
              class="leave-option"
            />
          </div>
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

/* 名字、在线、做对、最后交这几列按内容收紧（width: 1% 是表格收到最窄的写法），
   剩下的宽度题目列平分（模板里按题数给百分比），题名才写得开 */
.grid .name {
  width: 1%;
  padding-left: 12px;
  padding-right: 24px;
  text-align: left;
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.grid td.name {
  font-size: inherit;
  color: inherit;
}

/* 题多了表格要横着滑，名字钉在左边，不然滑过去就不知道是谁的格子 */
.grid .name {
  position: sticky;
  left: 0;
  z-index: 1;
  background: v-bind("theme.cardColor");
}

.grid th.col {
  min-width: 110px;
  cursor: pointer;
}

.grid th.narrow-col {
  width: 1%;
  padding: 8px 12px;
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

/* 题名写全，长的折成两行；题名中位 7 个字、九成在 13 个字以内，两行放得下 */
.col-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  max-width: 180px;
  margin: 0 auto;
  overflow: hidden;
  white-space: normal;
  line-height: 1.4;
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.col-count {
  margin: 2px 0 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.grid th .bar {
  max-width: 160px;
  margin: 0 auto;
}

.group-row td {
  height: 34px;
  padding-left: 12px;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  background: v-bind("theme.actionColor");
}

/* 和名字一样钉在左边：横着滑过去也看得见这一组是什么 */
.group-label {
  position: sticky;
  left: 12px;
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

.waited {
  margin-left: 8px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: v-bind("tone('error').color");
}

.grid .where-col {
  width: 1%;
  padding-right: 24px;
  text-align: left;
}

.where {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: v-bind("tone('success').color");
  cursor: pointer;
}

.present {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: v-bind("tone('success').color");
}

.seen {
  font-size: 13px;
  white-space: nowrap;
  color: v-bind("theme.textColor3");
}

.where::before,
.present::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.where:hover {
  text-decoration: underline;
}

.helping {
  font-size: 13px;
  font-weight: 600;
  color: v-bind("tone('info').color");
}

.leave-section + .leave-section {
  margin-top: 18px;
}

.leave-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-weight: 600;
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

/* ---------- 手机 ---------- */

@media (max-width: 768px) {
  /* 题名占一行（收起钉在右边），人数挪到第二行，别把「人」挤到下一行去 */
  .panel-head {
    flex-wrap: wrap;
    gap: 6px 12px;
  }

  .panel-head > span {
    order: 2;
    white-space: nowrap;
  }

  .panel-title {
    flex: 1 1 calc(100% - 50px);
    min-width: 0;
  }

  .panel-head .spacer {
    display: none;
  }

  .panel-close {
    order: 1;
  }

  .err-group {
    min-width: 0;
    flex: 1 1 100%;
    box-sizing: border-box;
  }

  .start-row {
    flex-wrap: wrap;
  }

  .start-input {
    flex-basis: 100%;
    order: -1;
  }

  .grid .name {
    padding-left: 4px;
    padding-right: 8px;
  }

  .grid th.col {
    min-width: 64px;
  }

  .cell {
    width: 48px;
  }
}
</style>

<script setup lang="ts">
import { displayName } from '@oj2/contract'
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import { getTaskBoard } from 'oj/api'
import { useTone } from 'shared/composables/tone'
import { groupClassOptions } from 'utils/classes'
import UserName from 'shared/components/UserName.vue'
import { useLeaveStudents } from 'shared/composables/leaveStudents'
import { useTeacherHelp } from 'shared/composables/teacherHelp'
import { useCollabStore } from 'shared/store/collab'
import { useConfigStore } from 'shared/store/config'
import { requestSpeech } from 'shared/mascot/behavior'
import { useMascotGuide, type MascotAction, type MascotGuide } from 'shared/mascot/guide'
import { errorMessage } from 'utils/api'
import { LANGUAGE_SHOW_VALUE } from 'utils/constants'
import { parseTime } from 'utils/functions'
import type { TaskBoard, TaskBoardCell, TaskBoardProblem, TaskBoardStudent } from 'utils/types'
import ExplainModal, { type ExplainPerson } from './components/ExplainModal.vue'
import LeaveModal from './components/LeaveModal.vue'
import AdminLink from 'shared/components/AdminLink.vue'
import { useBreakpoints } from 'shared/composables/breakpoints'
import LessonForm from './components/LessonForm.vue'
import TrailPanel from './components/TrailPanel.vue'
import { errorKind, type ErrorKind } from 'utils/errorKind'
import { LESSON_MODE_LABEL } from '@oj2/contract'
import { cellStage, cellStyle as cellStyleOf, cellText as cellTextOf, cellTitle as cellTitleOf, isStuck, trailSummary } from './cells'

/**
 * 课堂任务（老师，设计稿「课堂看板重设计」A+B）：这个班、今天、这节课的几道题 × 全班学生。
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

const REFRESH_MS = 15_000

const configStore = useConfigStore()
const collabStore = useCollabStore()
const message = useMessage()
const theme = useThemeVars()
const tone = useTone()
const { isDesktop } = useBreakpoints()
const router = useRouter()
const route = useRoute()
const { help, peek } = useTeacherHelp()

const board = ref<TaskBoard | null>(null)
/**
 * 带着 ?className= 进来的（协作条「帮完了」回来、举手面板「讲这道题」）就看那个班，
 * 否则第一次由后端猜
 */
const queryText = (value: unknown) => (typeof value === 'string' && value ? value : null)
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
    const data = await getTaskBoard(className.value ?? undefined)
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
// 已经停在任务页上时又从举手面板点了「讲这道题」：同一条路由只换 query，组件不重建
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
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
const { pause } = useIntervalFn(load, REFRESH_MS)
onUnmounted(pause)

// ---------- 这节课的题：上课时当场填 ----------

/**
 * 顶上那条布置框开着没有：edit = 改这一节，new = 今天再开一节，
 * carry = 再开一节、带上这一节的题改成写代码（这一节是画流程图时才有）
 */
const editing = ref<false | 'edit' | 'new' | 'carry'>(false)

/**
 * 第几道题今天做什么：今天几节里有这道题的要求合起来（先画流程图一节、再写代码一节 = 先画再写），
 * 和学生那边的「做完」一致。推断出来的课为 null（代码交对或流程图画对都算）
 */
const modeAt = (index: number) => board.value?.problems[index]?.mode ?? null

/**
 * 一个班一天可以上几节内容不同的课。打开任务页（或换到这个班）时，这一节已经布置了这么久，
 * 多半是上一节课的 —— 先问这节课做哪几道题，底下能点回去接着看上一节。
 * 只在第一次看到这一节时判一次：老师一直开着任务页时，15 秒一刷不会把表突然换掉
 */
const STALE_LESSON_MINUTES = 100
const staleLessonId = ref<number | null>(null)
const seenLessonIds = new Set<number>()
watch(
  () => board.value?.lessonId ?? null,
  (lessonId) => {
    if (lessonId === null || seenLessonIds.has(lessonId)) return
    seenLessonIds.add(lessonId)
    const assignedAt = board.value?.assignedAt
    if (assignedAt && Date.now() - Date.parse(assignedAt) > STALE_LESSON_MINUTES * 60_000) staleLessonId.value = lessonId
  },
)
const staleLesson = computed(() => board.value?.lessonId != null && board.value.lessonId === staleLessonId.value)

/** 还没有题（没布置、今天也推断不出来），或者布置的是上一节课的：填题号的框就是这页最大的东西 */
const needLesson = computed(() => !!board.value?.className && (!board.value.problems.length || staleLesson.value))

async function lessonSaved() {
  editing.value = false
  staleLessonId.value = null
  selectedId.value = null
  await load()
}

// ---------- 分组与排序 ----------

type Group = 'help' | 'idle' | 'stuck' | 'working' | 'done' | 'leave'

/**
 * 正在课堂求助的学生。列表是老师端 WebSocket 实时推的（collabStore，全局常驻连接），
 * 不经任务页接口 —— 求助只在 serve 进程的内存里，本来就不落库。所以也只看得到连着
 * **本站**的学生：服务器和机房各有各的求助队列，和课堂求助本身一样。
 */
function helpOf(student: TaskBoardStudent) {
  return collabStore.requests.find((request) => request.studentId === student.userId) ?? null
}

/**
 * 经常不动手：最近几节课里最多只交过一节。至少有 3 节课可比才下结论，
 * 开学头两节谁都一样。没交过的人里把他们排在前面，「最后交」那格写上来过几节
 */
function oftenIdle(student: TaskBoardStudent) {
  const total = board.value?.recentLessons ?? 0
  return total >= 3 && student.recentAttended <= 1
}

/**
 * 今天一次都没上过线。机房有两人共用一台电脑的，同桌只有一个登着，所以「谁没来」
 * 看今天上没上过线，不看此刻在不在线（见契约 seenAt）
 */
function unseen(student: TaskBoardStudent) {
  return !student.seenAt
}

/** 没在线的人最后一次上线是多久前，「在写」那格用 */
function seenText(seenAt: string) {
  const minutes = Math.max(0, Math.floor((now.value.getTime() - Date.parse(seenAt)) / 60_000))
  return minutes < 60 ? `${minutes} 分钟前在` : `${Math.floor(minutes / 60)} 小时前在`
}

function doneCount(student: TaskBoardStudent) {
  return student.cells.filter((cell) => cell.status === 'accepted').length
}

function groupOf(student: TaskBoardStudent): Group {
  if (absent(student)) return 'leave'
  if (helpOf(student)) return 'help'
  const cells = student.cells
  if (cells.length && cells.every((cell) => cell.status === 'accepted')) return 'done'
  if (!student.lastSubmitAt) return 'idle'
  if (cells.some((cell, i) => isStuck(cell, modeAt(i)))) return 'stuck'
  return 'working'
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
  help: '举手了',
  idle: '还没交过',
  stuck: '卡住了',
  working: '在做',
  done: '全做完了',
  leave: '请假',
}

/**
 * 请假：老师在「请假」框里勾上今天不在的人，人数、进度、卡片都不算他们，
 * 表格里变灰排到最后（不藏掉 —— 标了谁、标错没有，一眼看得见）。
 * 今天有效，只记在这台电脑上（见 leaveStudents.ts）。
 *
 * **只有今天还没交过的人能算请假**：请假的人一定在这里面。标过的人后来交了题、或者举手了，
 * 就是来了（迟到），自动取消标记，回到正常的分组里 —— 老师得看得见他卡住、举手
 */
const { onLeave, setLeave, cancelLeave } = useLeaveStudents('oj_leave_students')
function canLeave(student: TaskBoardStudent) {
  return !student.lastSubmitAt && !helpOf(student)
}
function absent(student: TaskBoardStudent) {
  return canLeave(student) && onLeave(student.username)
}
const boardStudents = computed(() => board.value?.students ?? [])
const leaveStudents = computed(() => boardStudents.value.filter(absent).sort(byName))

// 标过请假、后来交了题或举手的：来了，把标记清掉（不然名单里一直挂着一个其实在的人）
watchEffect(() => {
  const arrived = boardStudents.value.filter((student) => !canLeave(student) && onLeave(student.username)).map((student) => student.username)
  if (arrived.length) cancelLeave(arrived)
})

const leaveDialog = ref(false)
/** 弹框里能勾的：今天还没交过的（刚上课时就是全班），按名字排 */
const leaveCandidates = computed(() => boardStudents.value.filter(canLeave).sort(byName))
function saveLeave(selected: string[]) {
  setLeave(
    boardStudents.value.map((student) => student.username),
    selected,
  )
}

function byName(a: TaskBoardStudent, b: TaskBoardStudent) {
  return a.username.localeCompare(b.username, 'zh-CN')
}

const students = computed(() =>
  [...boardStudents.value].sort(
    (a, b) =>
      GROUP_ORDER[groupOf(a)] - GROUP_ORDER[groupOf(b)] ||
      // 同样是没交过，今天没上过线的排最前（多半没来，好标请假），再是经常不动手的
      Number(unseen(b)) - Number(unseen(a)) ||
      Number(oftenIdle(b)) - Number(oftenIdle(a)) ||
      // 同样在做，做对得少的排前面（只做了一道的那几个）
      (groupOf(a) === 'working' ? doneCount(a) - doneCount(b) : 0) ||
      byName(a, b),
  ),
)
/** 到了的人：人数、卡片都按这些算 */
const present = computed(() => students.value.filter((student) => groupOf(student) !== 'leave'))
const groupCount = computed(() => {
  const count: Record<Group, number> = { help: 0, idle: 0, stuck: 0, working: 0, done: 0, leave: 0 }
  for (const student of students.value) count[groupOf(student)]++
  return count
})
/**
 * 全做完了的人里有几个在挑战：做对之后又交了、还没做到（见契约 taskBoardCellSchema.challenge）。
 * 做完了又没在挑战的，就是空着的
 */
const challengingCount = computed(
  () => students.value.filter((student) => groupOf(student) === 'done' && student.cells.some((cell) => cell.challenge === 'doing')).length,
)
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
  student: TaskBoardStudent
  cell: TaskBoardCell
  kind: ErrorKind
  /** 点名字讲的是哪一份：代码（cell.latest）还是最后一张图（cell.flowchart.latest）；null = 没有可讲的 */
  explain: 'code' | 'draw' | null
}

/**
 * 卡在画流程图上的人按最后一张图归堆：一组都没走对的、对了一部分的分开讲；还在评、评失败的、
 * 老评法（数不出几组）各一堆
 */
function drawKind(cell: TaskBoardCell): ErrorKind {
  const latest = cell.flowchart?.latest
  if (!latest) return { key: 'draw-none', label: '还没画对', line: null }
  if (latest.status === 0 || latest.status === 1) return { key: 'draw-wait', label: 'AI 在评', line: null }
  if (latest.status === 3) return { key: 'draw-failed', label: '评分失败', line: null }
  if (latest.passed === null) return { key: 'draw-old', label: '还没画对', line: null }
  return latest.passed > 0 ? { key: 'draw-some', label: '图对了一部分', line: null } : { key: 'draw-zero', label: '图一组都没走对', line: null }
}

/**
 * 没做对的人：今天交过代码的按最后一次提交归错法。另外两种没有今天的代码可讲，单独成堆，
 * 和卡片上「错着 N」的 N 对得上：今天只画了流程图的，以前交过没做对、今天还没动的。
 * 要画流程图的课，卡在画图上的按最后一张图归堆（drawKind）；先写了代码、没画图的单独一堆
 */
function wrongOf(index: number): WrongPerson[] {
  const mode = modeAt(index)
  return present.value.flatMap((student): WrongPerson[] => {
    const cell = student.cells[index]
    if (!cell || cell.status !== 'tried') return []
    const stage = cellStage(cell, mode)
    if (stage === 'draw') {
      const latest = cell.flowchart?.latest
      const evaluated = !!latest && latest.status !== 0 && latest.status !== 1
      return [{ student, cell, kind: drawKind(cell), explain: evaluated ? 'draw' : null }]
    }
    if (stage === 'nodraw') return [{ student, cell, kind: { key: 'nodraw', label: '代码对了，还没画图', line: null }, explain: null }]
    if (mode === 'both' && cell.flowchart?.status === 'accepted' && cell.codeStatus === 'none') {
      return [{ student, cell, kind: { key: 'drawn', label: '图画对了，还没写代码', line: null }, explain: null }]
    }
    // 推断出来的课不分步：今天没代码、却画了流程图的单独一堆
    const kind: ErrorKind = cell.latest
      ? errorKind(cell.latest)
      : !mode && cell.attempts
        ? { key: 'flowchart', label: '今天只画了流程图', line: null }
        : { key: 'before', label: '以前交过，今天还没交', line: null }
    return [{ student, cell, kind, explain: cell.latest ? 'code' : null }]
  })
}

/** 没有今天的错可讲的那几堆：灰底，不是今天的错 */
const QUIET_KINDS = new Set(['before', 'flowchart', 'nodraw', 'drawn', 'draw-wait'])

const problemStats = computed(() =>
  (board.value?.problems ?? []).map((problem, i) => {
    const done = present.value.filter((student) => student.cells[i]?.status === 'accepted').length
    const wrong = present.value.filter((student) => student.cells[i]?.status === 'tried').length
    const total = present.value.length
    // 挑战成功几人：只有配了挑战的题才写
    const challenged = problem.hasChallenges ? present.value.filter((student) => student.cells[i]?.challenge === 'done').length : null
    // 先画再写：两步各几人做到，老师一眼看出全班卡在画图还是写代码
    const steps =
      problem.mode === 'both'
        ? {
            drawn: present.value.filter((student) => student.cells[i]?.flowchart?.status === 'accepted').length,
            coded: present.value.filter((student) => student.cells[i]?.codeStatus === 'accepted').length,
          }
        : null
    // 先画再写的题，没做完的里面有图画对了、还没写代码的，说「错着」不对 —— 改说「没做完」
    const wrongWord = problem.mode === 'both' ? '没做完' : '错着'
    return { problem, done, wrong, none: total - done - wrong, total, challenged, steps, wrongWord }
  }),
)

const selectedId = ref<number | null>(null)
const selectedIndex = computed(() => (board.value?.problems ?? []).findIndex((problem) => problem.problemId === selectedId.value))
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
      line: group.people.every((p) => p.kind.line === group.people[0]!.kind.line) ? group.kind.line : null,
    }))
    .sort((a, b) => b.people.length - a.people.length)
})

// ---------- 讲错误的弹层 ----------

const explainShow = ref(false)
const explainIndex = ref(0)
const explainProblemIndex = ref(-1)
const explainProblem = computed(() => board.value?.problems[explainProblemIndex.value] ?? null)
/**
 * 弹层顶上那排人：这道题错着的人，顺序和错法堆一样。打开那一刻定下来，开着时不跟 15 秒的刷新变：
 * 弹层记的是第几个人，名单一变（有人改对了、图评完了回到名单里）就成了讲着讲着换了个人
 */
const explainPeople = ref<ExplainPerson[]>([])
function explainPeopleOf(problemIndex: number): ExplainPerson[] {
  if (problemIndex < 0) return []
  const people = wrongOf(problemIndex).filter((person) => person.explain)
  const order = new Map<string, number>()
  for (const person of people) {
    order.set(person.kind.key, (order.get(person.kind.key) ?? 0) + 1)
  }
  return people
    .sort((a, b) => order.get(b.kind.key)! - order.get(a.kind.key)! || a.kind.key.localeCompare(b.kind.key) || b.cell.attempts - a.cell.attempts)
    .map((person) =>
      person.explain === 'draw'
        ? { userId: person.student.userId, username: person.student.username, flowchartId: person.cell.flowchart!.latest!.id, label: person.kind.label }
        : { userId: person.student.userId, username: person.student.username, submissionId: person.cell.latest!.submissionId, label: person.kind.label },
    )
}

function openExplain(problemIndex: number, userId: number) {
  explainProblemIndex.value = problemIndex
  explainPeople.value = explainPeopleOf(problemIndex)
  explainIndex.value = Math.max(
    0,
    explainPeople.value.findIndex((person) => person.userId === userId),
  )
  explainShow.value = true
}

// ---------- 格子（显示规则在 cells.ts） ----------

const cellColors = computed(() => ({
  tone,
  errorColor: theme.value.errorColor,
  actionColor: theme.value.actionColor,
  successColor: theme.value.successColor,
}))
/** `index`：第几道题，格子按那道题今天做什么来画（modeAt） */
const cellStyle = (cell: TaskBoardCell, index: number) => cellStyleOf(cell, board.value?.day, cellColors.value, modeAt(index))
const cellTitle = (cell: TaskBoardCell, student: TaskBoardStudent, index: number) => cellTitleOf(cell, student, board.value?.day, modeAt(index))
const cellText = (cell: TaskBoardCell, index: number) => cellTextOf(cell, modeAt(index))

/** 点了能讲的格子：没做完，卡着的那一步有评完的图或今天的代码 */
function explainable(cell: TaskBoardCell, index: number) {
  if (cell.status !== 'tried') return false
  const stage = cellStage(cell, modeAt(index))
  if (stage === 'draw') {
    const latest = cell.flowchart?.latest
    return !!latest && latest.status !== 0 && latest.status !== 1
  }
  return stage === 'code' && !!cell.latest
}

/**
 * 点开着轨迹的那个格子（学生 id:第几道题）。做对了、今天交过代码的格子点了不再直接去提交列表，
 * 先在格子下面看他是怎么一次次做对的，列表在弹出来的那块里
 */
const trailKey = ref<string | null>(null)

function toggleTrail(key: string) {
  trailKey.value = trailKey.value === key ? null : key
}

/** 点到别的格子时，那边自己会换过去；这里只管点到空白处收起 */
function trailOutside(event: MouseEvent) {
  if ((event.target as Element | null)?.closest('.cell')) return
  trailKey.value = null
}

/**
 * 点格子 / 名字到提交列表看他今天交的。新标签打开：任务页一般开着不关，别把它顶掉。
 * 用户名按整名匹配（学号互相包含是常态，ks24a1 会混进 ks24a10）。
 *
 * 今天只画了流程图、没写代码的，跳到列表的「流程图」那边 —— 不然这节课整班在画流程图时，
 * 点进去是一片「没有符合条件的提交」
 */
function submissionsHref(
  student: TaskBoardStudent,
  problem: TaskBoardProblem | undefined,
  flowchart: boolean,
  /** 「以前交过、今天还没交」的人要看以前的，不能只列今天 */
  today = true,
) {
  // SQL 题不受布置的语言限制，格子数的是 SQL 交的
  const language = problem?.isSql ? 'SQL' : board.value?.language
  // 只画流程图的课，格子数的全是流程图
  const flowSide = flowchart || problem?.mode === 'flowchart'
  return router.resolve({
    name: 'submissions',
    query: {
      username: student.username,
      exactUsername: '1',
      ...(today ? { today: '1' } : {}),
      // 布置时选了语言的，代码那边只看这个语言交的（和格子里数的一致）
      ...(flowSide ? { language: 'Flowchart' } : language ? { language } : {}),
      ...(problem ? { problem: problem.problemDisplayId } : {}),
    },
  }).href
}

/**
 * 看板娘：布置了就带去这节课的提交，筛法同提交列表「这节课」（班、这几道题、今天）。
 * 语言和格子一致：画流程图的课看流程图，选了语言的只看它 —— 夹着 SQL 题的不筛语言，免得把 SQL 交的藏掉。
 * 还没布置时填题号的框就是这页最大的东西，不给按钮
 */
const startForm = useTemplateRef<{ openPicker: () => void }>('startForm')
// ---------- 看板娘：点她时挑全班这一刻最要紧的一件说；卡住的多起来、全班做完时她自己开口 ----------

/** 同一种错有这么多人才算「扎堆」 */
const PILE_MIN = 3
/** 布置这么久了，人在线却一道没交，才算「没动」 */
const IDLE_AFTER_MS = 10 * 60_000
/** 一道题卡住的人涨到这么多，她主动说一声 */
const STUCK_RISE = 3

/** 人最多的那一堆错（灰底那几堆不算：不是今天的错，没得讲） */
function biggestPile() {
  let best: { index: number; kind: ErrorKind; people: WrongPerson[] } | null = null
  const count = board.value?.problems.length ?? 0
  for (let index = 0; index < count; index++) {
    const groups = new Map<string, WrongPerson[]>()
    for (const person of wrongOf(index)) {
      if (QUIET_KINDS.has(person.kind.key)) continue
      groups.set(person.kind.key, [...(groups.get(person.kind.key) ?? []), person])
    }
    for (const people of groups.values()) {
      if (!best || people.length > best.people.length) best = { index, kind: people[0]!.kind, people }
    }
  }
  return best && best.people.length >= PILE_MIN ? best : null
}

/** 卡住的人（cells.ts 的 isStuck），交得多的在前 */
function stuckPeople() {
  return present.value
    .flatMap((student) => student.cells.map((cell, index) => ({ student, cell, index })))
    .filter(({ cell, index }) => isStuck(cell, modeAt(index)))
    .sort((a, b) => b.cell.attempts - a.cell.attempts)
}

/** 在线、今天一道没交、也不是早就全做完了的人 */
function idlePeople() {
  const assignedAt = board.value?.assignedAt
  if (!assignedAt || Date.now() - Date.parse(assignedAt) < IDLE_AFTER_MS) return []
  return present.value.filter(
    (student) => student.online && student.cells.every((cell) => cell.attempts === 0) && student.cells.some((cell) => cell.status !== 'accepted'),
  )
}

const allDone = () => present.value.length > 0 && present.value.every((student) => student.cells.every((cell) => cell.status === 'accepted'))

/** 点名字：能讲的打开讲错误的弹层，不能讲的展开那道题的错法 */
function lookAt(index: number, student: TaskBoardStudent): MascotAction {
  const cell = student.cells[index]!
  const problem = board.value!.problems[index]!
  return {
    label: `看 ${displayName(student.username)} 的`,
    run: () => (explainable(cell, index) ? openExplain(index, student.userId) : (selectedId.value = problem.problemId)),
  }
}

useMascotGuide((): MascotGuide | null => {
  const b = board.value
  if (!b?.className) return null
  if (needLesson.value)
    return { situation: 'teacher.task.unassigned', actions: startForm.value ? [{ label: '选题', run: () => startForm.value?.openPicker() }] : [] }
  const language = b.mode === 'flowchart' ? 'Flowchart' : b.problems.some((problem) => problem.isSql) ? null : b.language
  const query = {
    className: b.className,
    problem: b.problems.map((problem) => problem.problemDisplayId).join(','),
    today: '1',
    ...(language ? { language } : {}),
  }
  // 新标签打开，和点格子一样：任务页一般开着不关
  const submissions: MascotAction = { label: '这节课的提交', run: () => window.open(router.resolve({ name: 'submissions', query }).href, '_blank') }

  if (allDone())
    return { situation: 'teacher.task.allDone', actions: [{ label: b.source === 'teacher' ? '改题' : '布置', run: () => (editing.value = 'edit') }] }

  const pile = biggestPile()
  if (pile) {
    const problem = b.problems[pile.index]!
    const first = pile.people.find((person) => person.explain)
    const actions: MascotAction[] = [{ label: '看这堆', run: () => (selectedId.value = problem.problemId) }]
    if (first) actions.push({ label: '讲第一个', run: () => openExplain(pile.index, first.student.userId) })
    return {
      situation: 'teacher.task.errorPile',
      n: pile.people.length,
      vars: { pid: problem.problemDisplayId, kind: pile.kind.label },
      actions: [...actions, submissions],
    }
  }

  const stuck = stuckPeople()
  if (stuck.length) {
    const top = stuck[0]!
    return {
      situation: 'teacher.task.stuck',
      n: new Set(stuck.map((it) => it.student.userId)).size,
      vars: { name: displayName(top.student.username), k: top.cell.attempts, pid: b.problems[top.index]!.problemDisplayId },
      actions: [lookAt(top.index, top.student), submissions],
    }
  }

  const idle = idlePeople()
  if (idle.length) {
    const name = displayName(idle[0]!.username)
    return idle.length === 1 ? { situation: 'teacher.task.idleOne', vars: { name } } : { situation: 'teacher.task.idle', n: idle.length, vars: { name } }
  }

  const challenging = present.value.filter((student) => student.cells.some((cell) => cell.challenge === 'doing')).length
  if (challenging) return { situation: 'teacher.task.challenging', n: challenging, actions: [submissions] }

  return { situation: 'teacher.task.assigned', actions: [submissions] }
})

/**
 * 主动开口：每 15 秒刷新一次，和上一次比 —— 某道题卡住的人从不到 3 个涨到 3 个、全班刚做完。
 * 刚打开页面（或换了班、换了一节）的那一次只记数不说，不然一刷新就把已经知道的事再说一遍
 */
let seen: { key: string; stuck: Map<number, number>; done: boolean } | null = null
watch(board, (b) => {
  if (!b?.className || needLesson.value) return
  const key = `${b.className}|${b.day}|${b.lessonId ?? ''}|${b.problems.map((problem) => problem.problemId).join(',')}`
  const stuck = new Map<number, number>()
  for (const { index } of stuckPeople()) {
    const id = b.problems[index]!.problemId
    stuck.set(id, (stuck.get(id) ?? 0) + 1)
  }
  const done = allDone()
  const before = seen?.key === key ? seen : null
  seen = { key, stuck, done }
  if (!before) return
  if (done && !before.done) {
    requestSpeech({
      key: `done:${key}`,
      situation: 'teacher.task.allDone',
      actions: [{ label: b.source === 'teacher' ? '改题' : '布置', run: () => (editing.value = 'edit') }],
    })
    return
  }
  for (const [id, n] of stuck) {
    if (n < STUCK_RISE || (before.stuck.get(id) ?? 0) >= STUCK_RISE) continue
    const problem = b.problems.find((it) => it.problemId === id)!
    requestSpeech({
      key: `stuck:${key}:${id}`,
      situation: 'teacher.task.stuckRise',
      n,
      vars: { pid: problem.problemDisplayId },
      actions: [{ label: '看这道', run: () => (selectedId.value = id) }],
    })
    return
  }
})

function lastText(student: TaskBoardStudent) {
  if (student.lastSubmitAt) return parseTime(student.lastSubmitAt, 'HH:mm')
  if (oftenIdle(student)) {
    return `近 ${board.value?.recentLessons} 节交过 ${student.recentAttended} 节`
  }
  return '—'
}
</script>

<template>
  <div class="board">
    <div class="toolbar">
      <n-select :value="className" :options="classOptions" placeholder="选择班级" filterable class="class-select" @update:value="changeClass" />

      <!-- 这节课的题：当场填，填完收成一排小块 -->
      <LessonForm
        v-if="editing && board && className"
        :board="board"
        :class-name="className"
        :lesson-id="editing === 'edit' ? board.lessonId : null"
        :carry="editing === 'carry'"
        variant="inline"
        class="lesson-edit"
        @saved="lessonSaved"
        @cancel="editing = false"
      />
      <div v-else-if="board?.problems.length && !needLesson" class="lesson">
        <span class="lesson-label">{{ board.source === 'teacher' ? '这节课' : '今天在做' }}</span>
        <!-- 写代码也写出来：只写「Python」的话，看不出这节是写代码还是先画再写 -->
        <span v-if="board.mode" class="chip lang">{{ LESSON_MODE_LABEL[board.mode] }}</span>
        <span v-if="board.language" class="chip lang">{{ LANGUAGE_SHOW_VALUE[board.language] }}</span>
        <span v-for="problem in board.problems" :key="problem.problemId" class="chip">
          {{ problem.problemDisplayId }}
        </span>
        <span v-if="board.assignedAt" class="assigned"> {{ parseTime(board.assignedAt, 'HH:mm') }} {{ board.assignedBy }} 布置 </span>
        <n-button size="small" class="edit" @click="editing = 'edit'">
          <template #icon><Icon icon="ph:pencil-simple" /></template>
          {{ board.source === 'teacher' ? '改' : '布置' }}
        </n-button>
        <!-- 一天上几节内容不同的课：下一节另开一份，别把上一节的改掉（统计按布置切课） -->
        <n-button v-if="board.source === 'teacher'" size="small" class="edit" @click="editing = 'new'">
          <template #icon><Icon icon="ph:plus" /></template>
          新的一节
        </n-button>
        <!-- 画完流程图让全班写代码：新开一节、带上这几道题（学生那边还没画完的照样看得到要画） -->
        <n-button v-if="board.source === 'teacher' && board.mode === 'flowchart'" size="small" class="edit" @click="editing = 'carry'">
          <template #icon><Icon icon="ph:code" /></template>
          用这几道题写代码
        </n-button>
      </div>

      <div class="spacer"></div>
      <n-button v-if="board?.className" :type="leaveStudents.length ? 'warning' : 'default'" :secondary="!!leaveStudents.length" @click="leaveDialog = true">
        {{ leaveStudents.length ? `请假 ${leaveStudents.length} 人` : '请假' }}
      </n-button>
      <!-- 布置过的每一节课：改错了班、隔天想起来补，去后台 -->
      <AdminLink v-if="isDesktop" :to="{ name: 'admin task list', query: className ? { className } : {} }">布置过的课</AdminLink>
      <!-- 任务页只管今天；以前几节课的、任意时间段的去统计（带上这个班） -->
      <n-button @click="router.push({ name: 'statistics', query: className ? { className } : {} })">回头看</n-button>
    </div>

    <n-empty v-if="board && !board.className" description="最近两小时没有哪个班在交题，先在上面选一个班" style="margin: 60px 0" />

    <template v-else-if="board">
      <!-- 刚上课还没有题：填题号的框是这页最大的东西 -->
      <section v-if="needLesson" class="start">
        <div class="start-title">这节课做哪几道题？</div>
        <LessonForm
          v-if="className"
          ref="startForm"
          :board="board"
          :class-name="className"
          :lesson-id="null"
          variant="start"
          class="start-row"
          @saved="lessonSaved"
        />
        <div v-if="staleLesson" class="earlier">
          <span>上一节 {{ board.assignedAt ? parseTime(board.assignedAt, 'HH:mm') : '' }} {{ board.assignedBy }} 布置</span>
          <span v-for="problem in board.problems" :key="problem.problemId" class="chip">{{ problem.problemDisplayId }}</span>
          <n-button size="small" class="edit" @click="staleLessonId = null">接着看这一节</n-button>
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
            <span v-if="stat.steps" class="card-steps">画对 {{ stat.steps.drawn }} · 写对 {{ stat.steps.coded }}</span>
            <span class="card-foot">
              <span :class="stat.wrong ? 'wrong' : 'muted'">{{ stat.wrongWord }} {{ stat.wrong }}</span>
              <span class="muted">没做 {{ stat.none }}</span>
              <span v-if="stat.challenged !== null" class="challenged"> 挑战成功 {{ stat.challenged }} </span>
            </span>
          </button>
        </div>

        <section v-if="selectedIndex >= 0" class="panel">
          <div class="panel-head">
            <a
              class="panel-title"
              :href="
                router.resolve({
                  name: 'problem',
                  params: { problemID: board.problems[selectedIndex]!.problemDisplayId },
                }).href
              "
              target="_blank"
            >
              <span class="muted">{{ board.problems[selectedIndex]!.problemDisplayId }}</span>
              {{ board.problems[selectedIndex]!.title }}
            </a>
            <span>
              {{ problemStats[selectedIndex]!.wrongWord }}的 <b class="wrong">{{ problemStats[selectedIndex]!.wrong }}</b> 人
            </span>
            <span class="muted">没做 {{ problemStats[selectedIndex]!.none }} 人</span>
            <div class="spacer"></div>
            <n-button quaternary size="small" class="panel-close" aria-label="收起" @click="selectedId = null">
              <template #icon><Icon icon="ph:x-bold" /></template>
            </n-button>
          </div>
          <div v-if="wrongGroups.length" class="groups">
            <div v-for="group in wrongGroups" :key="group.kind.key" class="err-group" :class="{ quiet: QUIET_KINDS.has(group.kind.key) }">
              <div class="err-title">
                {{ group.kind.label }}
                <span class="wrong">{{ group.people.length }} 人</span>
                <span v-if="group.line" class="muted"> · 第 {{ group.line }} 行</span>
              </div>
              <div class="err-people">
                <template v-for="person in group.people" :key="person.student.userId">
                  <button v-if="person.explain" type="button" class="who" @click="openExplain(selectedIndex, person.student.userId)">
                    <UserName :username="person.student.username" />
                    <span class="mini" :style="cellStyle(person.cell, selectedIndex)">{{ cellText(person.cell, selectedIndex) }}</span>
                  </button>
                  <!-- 没有今天的代码可讲：去提交列表看他交过的 -->
                  <a
                    v-else
                    class="who"
                    :href="
                      submissionsHref(
                        person.student,
                        board.problems[selectedIndex],
                        person.kind.key === 'flowchart' || person.kind.key.startsWith('draw'),
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

      <!-- 上一节的表先不摆：一整列都是上一节的题，和上面「这节课做哪几道题」对不上 -->
      <div v-if="!staleLesson" class="table-wrap">
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
                  <i :style="{ width: stat.total ? `${(stat.done / stat.total) * 100}%` : '0' }"></i>
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
                    <span v-if="groupOf(student) === 'done' && challengingCount" class="challenged"> 在挑战 {{ challengingCount }} </span>
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
                    :title="`看 ${displayName(student.username)} 今天交的全部`"
                  >
                    <UserName :username="student.username" />
                  </a>
                  <UserName v-else :username="student.username" />
                  <span v-if="helpOf(student)?.status === 'pending'" class="waited"> 举手 {{ waitedText(helpOf(student)!.createdAt) }} </span>
                </td>
                <!-- 在线：举手的「帮他」；别人在帮的写谁在帮；开着题目的点题号直接打开他正在写的
                     代码（他没举手也行，他那边会显示「xxx 在看你的代码」）；剩下的写在不在线、
                     多久前在、今天没上过线 -->
                <td class="where-col">
                  <n-button v-if="helpOf(student)?.status === 'pending'" type="primary" size="tiny" @click="help(student.userId)">
                    去帮 · {{ helpOf(student)!.problemId }}
                  </n-button>
                  <span v-else-if="helpOf(student)" class="helping"> {{ helpOf(student)!.teacherName }} 在帮 </span>
                  <button
                    v-else-if="student.editing"
                    type="button"
                    class="where"
                    :title="`打开 ${displayName(student.username)} 正在写的 ${student.editing}`"
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
                <td v-for="(cell, i) in student.cells" :key="i" :class="{ hl: i === selectedIndex }">
                  <button
                    v-if="explainable(cell, i)"
                    type="button"
                    class="cell"
                    :data-challenge="cell.challenge ?? undefined"
                    :style="cellStyle(cell, i)"
                    :title="cellTitle(cell, student, i)"
                    @click="openExplain(i, student.userId)"
                  >
                    {{ cellText(cell, i) }}
                  </button>
                  <n-popover
                    v-else-if="cell.trail.length"
                    :show="trailKey === `${student.userId}:${i}`"
                    trigger="manual"
                    placement="bottom-start"
                    :style="{ width: '620px', maxWidth: 'calc(100vw - 32px)' }"
                    @clickoutside="trailOutside"
                  >
                    <template #trigger>
                      <button
                        type="button"
                        class="cell"
                        :data-challenge="cell.challenge ?? undefined"
                        :class="{ picked: trailKey === `${student.userId}:${i}` }"
                        :style="cellStyle(cell, i)"
                        :title="cellTitle(cell, student, i)"
                        @click="toggleTrail(`${student.userId}:${i}`)"
                      >
                        {{ cellText(cell, i) }}
                      </button>
                    </template>
                    <TrailPanel
                      :username="student.username"
                      :problem="board.problems[i]!"
                      :cell="cell"
                      :summary="trailSummary(cell, board.day)"
                      :list-href="submissionsHref(student, board.problems[i], false)"
                      @close="trailKey = null"
                    />
                  </n-popover>
                  <a
                    v-else-if="cell.attempts"
                    class="cell"
                    :data-challenge="cell.challenge ?? undefined"
                    :style="cellStyle(cell, i)"
                    :href="submissionsHref(student, board.problems[i], !cell.codeAttempts)"
                    target="_blank"
                    :title="cellTitle(cell, student, i)"
                  >
                    {{ cellText(cell, i) }}
                  </a>
                  <span v-else class="cell" :data-challenge="cell.challenge ?? undefined" :style="cellStyle(cell, i)" :title="cellTitle(cell, student, i)">
                    {{ cellText(cell, i) }}
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

    <ExplainModal v-model:show="explainShow" v-model:index="explainIndex" :problem="explainProblem" :people="explainPeople" />

    <LeaveModal v-model:show="leaveDialog" :candidates="leaveCandidates" :current="leaveStudents.map((student) => student.username)" @save="saveLeave" />
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
  color: v-bind('theme.textColor3');
}

.wrong {
  color: v-bind('theme.errorColor');
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
  color: v-bind('theme.textColor3');
  white-space: nowrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  border-radius: 4px;
  background: v-bind('theme.actionColor');
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
  color: v-bind('theme.textColor3');
  white-space: nowrap;
}

.edit {
  margin-left: 4px;
}

/* ---------- 刚上课 ---------- */

.start {
  padding: 22px 24px;
  border-radius: 10px;
  border: 1px solid v-bind("tone('success').background");
  background: v-bind('theme.cardColor');
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

.earlier {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 14px;
  color: v-bind('theme.textColor3');
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
  border: 1px solid v-bind('theme.dividerColor');
  background: v-bind('theme.cardColor');
  color: v-bind('theme.textColor1');
  font: inherit;
  text-align: left;
  min-width: 0;
  cursor: pointer;
}

.card:hover {
  border-color: v-bind('theme.borderColor');
}

.card.on {
  border-color: v-bind('theme.successColor');
  box-shadow: inset 0 0 0 1px v-bind('theme.successColor');
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

.card-steps {
  font-size: 13px;
  color: v-bind('theme.textColor2');
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
  background: v-bind('theme.actionColor');
  overflow: hidden;
}

.bar i {
  display: block;
  height: 4px;
  background: v-bind('theme.successColor');
}

/* ---------- 点开一道题：错着的人按错法归堆 ---------- */

.panel {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid v-bind("tone('success').background");
  background: v-bind('theme.cardColor');
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
  font-weight: 600;
  color: v-bind('theme.primaryColor');
  text-decoration: none;
}

.panel-title:hover {
  text-decoration: underline;
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
  background: v-bind('theme.actionColor');
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
  border: 1px solid v-bind('theme.dividerColor');
  background: v-bind('theme.cardColor');
  color: v-bind('theme.textColor1');
  font: inherit;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}

a.who {
  text-decoration: none;
}

.who:hover {
  border-color: v-bind('theme.borderColor');
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
  border-bottom: 1px solid v-bind('theme.dividerColor');
  white-space: nowrap;
}

.grid td {
  height: 40px;
  padding: 0 4px;
  text-align: center;
  border-bottom: 1px solid v-bind('theme.dividerColor');
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
  color: v-bind('theme.textColor3');
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
  background: v-bind('theme.cardColor');
}

.grid th.col {
  min-width: 110px;
  cursor: pointer;
}

.grid th.narrow-col {
  width: 1%;
  padding: 8px 12px;
  font-size: 13px;
  color: v-bind('theme.textColor3');
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
  color: v-bind('theme.textColor3');
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
  background: v-bind('theme.actionColor');
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

/* 挑战：做到了贴一枚紫色筹码，在挑战加一圈紫边（设计稿 StkBoard） */
.cell[data-challenge='done'] {
  position: relative;
}

.cell[data-challenge='done']::after {
  content: '';
  position: absolute;
  right: -6px;
  top: -6px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-sizing: border-box;
  background: #5b34c4;
  border: 3px solid #b49cf5;
  box-shadow: 0 0 0 2px v-bind('theme.cardColor');
}

.cell[data-challenge='doing'] {
  box-shadow:
    0 0 0 2px v-bind('theme.cardColor'),
    0 0 0 4px #8f72e3;
}

.challenged {
  color: #6a45d6;
  font-weight: 600;
}

.cell.picked {
  box-shadow: 0 0 0 2px v-bind('theme.textColor1');
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
  color: v-bind('theme.textColor3');
}

.where::before,
.present::before {
  content: '';
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

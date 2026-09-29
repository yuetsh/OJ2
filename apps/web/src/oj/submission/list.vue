<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { useRouteQuery } from "@vueuse/router"
import { errorCode } from "utils/api"
import {
  adminRejudge,
  getClassLesson,
  getFlowchartSubmissions,
  getSubmissions,
  getTodaySubmissionCount,
  retryFlowchartSubmission,
} from "oj/api"
import { useContestStore } from "oj/store/contest"
import Pagination from "shared/components/Pagination.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { usePagination } from "shared/composables/pagination"
import { useConfigStore } from "shared/store/config"
import { useUserStore } from "shared/store/user"
import { SubmissionStatus } from "utils/constants"
import { parseTime } from "utils/functions"
import type {
  ClassLesson,
  FlowchartSubmissionListItem,
  LANGUAGE,
  SubmissionListItem,
} from "utils/types"
import { FlowchartSubmissionStatus } from "utils/types"
import FlowchartState from "./components/FlowchartState.vue"
import StatusPill from "./components/StatusPill.vue"
import UserName from "./components/UserName.vue"
import { useTone } from "./composables/tone"
import { classLabel, submissionClockText, submissionDayText } from "./utils"

/**
 * 提交列表（设计稿「提交列表重设计 · 定稿」）：左边列表、右边常驻选中那条的代码。
 *
 * 老师课上的三种用法 —— 一条条翻全班的代码、看某一个学生、看完成情况 —— 前两种在
 * 这一页里做完：↑ ↓ 换条，右边跟着换，不再「点开弹框 → 关掉 → 点下一行」。
 * 完成情况在课堂看板和「数据统计」里，这页不重复造一张表。
 */

// 右栏和今日统计弹框都不在关键路径上：右栏要等选中一条才有内容，弹框默认关着
const SubmissionPane = defineAsyncComponent(() => import("./components/SubmissionPane.vue"))
const FlowchartPane = defineAsyncComponent(() => import("./components/FlowchartPane.vue"))
const TodayStatistics = defineAsyncComponent(() => import("./components/TodayStatistics.vue"))

interface SubmissionQuery {
  username: string
  className: string
  result: string
  myself: "0" | "1"
  problem: string
  language: LANGUAGE | "" | "Flowchart"
  today: "0" | "1"
}

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const configStore = useConfigStore()
const contestStore = useContestStore()
const message = useMessage()
const theme = useThemeVars()
const tone = useTone()
const { isMobile, isDesktop } = useBreakpoints()

const inContest = computed(() => route.name === "contest submissions")
const teacher = computed(() => userStore.isTeacherOrAbove)

// 一节课一个班要交一百来条，每页 10 条得翻十几页；30 条配上右栏的方向键正好
const { query, clearQuery } = usePagination<SubmissionQuery>(
  {
    username: useRouteQuery("username", "").value,
    className: useRouteQuery("className", "").value,
    result: useRouteQuery("result", "").value,
    myself: useRouteQuery("myself", "0").value,
    problem: useRouteQuery("problem", "").value,
    language: useRouteQuery("language", "").value,
    // 原来写死成 "0"，从别处带着 today=1 进来也不认
    today: useRouteQuery("today", "0").value,
  },
  { defaultLimit: 30 },
)

const flowMode = computed(() => !inContest.value && query.language === "Flowchart")

/**
 * 用户名按整名匹配的那一个名字。默认是「包含」，而学号互相包含是常态（ks24a1 会混进
 * ks24a10–ks24a19）。两处会设它：协作条「看他交过什么」带进来的 `exactUsername=1`，
 * 和右栏的「只看他」。老师在输入框里改了名字就回到包含匹配
 */
const exactFor = ref(useRouteQuery<string>("exactUsername", "").value === "1" ? query.username : "")

const submissions = ref<SubmissionListItem[]>([])
const flowcharts = ref<FlowchartSubmissionListItem[]>([])
const total = ref(0)
const todayCount = ref(0)
/** 题号框里查不到的题号（打错了）。一次填好几道时打错的那道会被忽略，得告诉老师 */
const unknownProblems = ref<string[]>([])
const loading = ref(false)
const loaded = ref(false)

/** 转圈延迟 300ms 才出现：翻页、切筛选大多一百毫秒内回来，直接换数据比闪一下转圈稳 */
const showLoading = ref(false)
let loadingTimer: ReturnType<typeof setTimeout> | undefined
watch(loading, (value) => {
  clearTimeout(loadingTimer)
  if (!value) {
    showLoading.value = false
    return
  }
  loadingTimer = setTimeout(() => (showLoading.value = true), 300)
})
onUnmounted(() => clearTimeout(loadingTimer))

type Row = SubmissionListItem | FlowchartSubmissionListItem
const rows = computed<Row[]>(() => (flowMode.value ? flowcharts.value : submissions.value))

function fetchPage() {
  const offset = query.limit * (query.page - 1)
  if (flowMode.value) {
    return getFlowchartSubmissions({
      username: query.username,
      className: query.className,
      problemDisplayId: query.problem,
      myself: query.myself,
      offset,
      limit: query.limit,
      today: query.today,
      grade: query.result,
      ...(exactFor.value && query.username === exactFor.value
        ? { exactUsername: "1" as const }
        : {}),
    })
  }
  return getSubmissions({
    username: query.username,
    className: inContest.value ? undefined : query.className,
    result: query.result,
    myself: query.myself,
    offset,
    limit: query.limit,
    page: query.page,
    problemDisplayId: query.problem,
    contestId: inContest.value ? String(route.params.contestID) : "",
    language: inContest.value ? "" : (query.language as LANGUAGE | ""),
    today: inContest.value ? undefined : query.today,
    ...(exactFor.value && query.username === exactFor.value ? { exactUsername: "1" as const } : {}),
  })
}

// 并发的几次请求只认最后一次：连着切筛选时，先发的晚回来会把新结果盖掉
let requestSeq = 0

async function listSubmissions() {
  if (query.page < 1) query.page = 1
  const seq = ++requestSeq
  const mode = flowMode.value
  loading.value = true
  try {
    const res = await fetchPage()
    if (seq !== requestSeq) return
    if (mode) flowcharts.value = res.results as FlowchartSubmissionListItem[]
    else submissions.value = res.results as SubmissionListItem[]
    total.value = res.total
    unknownProblems.value = res.unknownProblems
    newCount.value = 0
    loaded.value = true
    // 翻了页、换了条件就回到列表顶上（往回翻到上一页末尾的，settleSelection 会滚到那一条）
    const scroller = document.querySelector(".rows")
    if (scroller) scroller.scrollTop = 0
    settleSelection()
  } catch {
    // 失败了别把「落地后停在哪一头」留给下一次不相干的加载
    if (seq === requestSeq) pendingJump = null
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

async function getTodayCount() {
  todayCount.value = await getTodaySubmissionCount(flowMode.value ? "Flowchart" : undefined)
}

onMounted(() => {
  listSubmissions()
  if (route.name === "submissions") getTodayCount()
})

watchDebounced(() => [query.username, query.problem], listSubmissions, {
  debounce: 500,
  maxWait: 1000,
})
watch(
  () => [
    query.page,
    query.limit,
    query.myself,
    query.result,
    query.language,
    query.today,
    query.className,
  ],
  listSubmissions,
)
// 代码和流程图的「结果」不是一套（判题状态 / 等级），切过去要清掉
watch(
  () => query.language,
  (value, old) => {
    if ((value === "Flowchart") !== (old === "Flowchart")) query.result = ""
    if (route.name === "submissions") getTodayCount()
  },
)
// 登录态一变，能看哪些代码就变了（showLink 是后端逐行算的）。掉了登录还停在流程图上的话
// 退回代码：流程图列表要登录才能看，而没登录时那个切换按钮不显示，会卡在一片报错里出不去
watch(
  () => userStore.isAuthed,
  (authed) => {
    if (!authed && query.language === "Flowchart") query.language = ""
    else listSubmissions()
  },
)

/**
 * 地址栏整个换掉时（顶栏「提交」「我的提交」、浏览器后退），地址里没写的筛选要回到默认值。
 * usePagination 只同步地址里**有**的键 —— 在 `?myself=1` 上点顶栏「提交」，地址已经变成
 * `/submission`，页面却还停在「我的」
 */
const QUERY_DEFAULTS: Record<string, string> = {
  username: "",
  className: "",
  result: "",
  myself: "0",
  problem: "",
  language: "",
  today: "0",
}
watch(
  () => route.query,
  (next) => {
    const writable = query as unknown as Record<string, string>
    for (const [key, value] of Object.entries(QUERY_DEFAULTS)) {
      if (next[key] === undefined && writable[key] !== value) writable[key] = value
    }
  },
)

// ==================== 选中与翻阅 ====================

const selectedId = ref("")
const selectedRow = computed(() => rows.value.find((row) => row.id === selectedId.value) ?? null)

/** 方向键只在能看的行之间走：跳到一条看不了的上面只会看到一把锁 */
const navigable = computed(() => rows.value.filter((row) => row.showLink))
const position = computed(() => {
  const index = navigable.value.findIndex((row) => row.id === selectedId.value)
  return index === -1 ? null : { index: index + 1, count: navigable.value.length }
})

// 翻页是异步的，先记下「落地后停在哪一头」，新一页回来再选
let pendingJump: "first" | "last" | null = null

function settleSelection() {
  const jump = pendingJump
  pendingJump = null
  const list = navigable.value
  if (jump) {
    const row = jump === "first" ? list[0] : list[list.length - 1]
    if (row) {
      select(row.id)
      return
    }
    message.info("这一页没有可以查看的代码")
  }
  if (rows.value.some((row) => row.id === selectedId.value)) return
  // 手机上没有右栏，不用预先选一条
  if (isMobile.value) {
    selectedId.value = ""
    return
  }
  selectedId.value = (list[0] ?? rows.value[0])?.id ?? ""
}

function select(id: string) {
  selectedId.value = id
  nextTick(() => {
    document
      .querySelector(`[data-row-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" })
  })
}

const maxPage = computed(() => Math.max(1, Math.ceil(total.value / query.limit)))

function move(step: 1 | -1) {
  // 这一页一条能看的都没有（学生看全站时常见）：不翻页，不然按一下翻一页停不下来
  if (!navigable.value.length) return
  // 上一次跨页还没回来：按住 ↓ 或者在页尾连按两下，不然会整页跳过
  if (loading.value || pendingJump) return
  const all = rows.value
  const start = all.findIndex((row) => row.id === selectedId.value)
  for (let i = start + step; i >= 0 && i < all.length; i += step) {
    if (all[i]!.showLink) {
      select(all[i]!.id)
      return
    }
  }
  const page = query.page + step
  if (page < 1 || page > maxPage.value) return
  pendingJump = step > 0 ? "first" : "last"
  query.page = page
}

const [todayPanel, toggleTodayPanel] = useToggle(false)

// ← → 和 ↑ ↓ 一样（9 月加方向键时就是四个键都能翻，老师已经用惯了）
onKeyStroke(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"], (e: KeyboardEvent) => {
  if (!isDesktop.value || todayPanel.value) return
  // 别的控件已经处理了这次按键（下拉框自己会开菜单、换选项）
  if (e.defaultPrevented) return
  const target = e.target as HTMLElement | null
  if (target) {
    // 「代码 / 流程图」「全部 / 我的」是单选框：点过之后焦点停在上面，浏览器默认会拿方向键
    // 切换选项 —— 老师想看下一条，结果模式被切了。单选框照常换条，下面的 preventDefault 挡掉切换
    const radio = target.tagName === "INPUT" && (target as HTMLInputElement).type === "radio"
    // 焦点在输入框、下拉框、弹框里时不抢方向键
    if (
      (!radio && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) ||
      target.isContentEditable ||
      target.closest(".n-base-selection, .n-base-select-menu, .n-dropdown-menu, .n-modal")
    ) {
      return
    }
  }
  if (!rows.value.length) return
  e.preventDefault()
  move(e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1)
})

// 手机上没有右栏：点一行从右边滑出整屏的详情
const mobilePane = ref(false)
function rowClicked(row: Row) {
  select(row.id)
  if (isMobile.value) mobilePane.value = true
}

// ==================== 实时更新 ====================

/**
 * 两件事，一个定时器：
 * - 本页有「正在评分」的，3 秒拉一次，把结果原地换上；
 * - 第一页每 15 秒看一眼有没有新交的。**新的不直接插进来** —— 老师正看着第 5 行，
 *   上面突然塞进 3 行，选中的那行就跑了。顶上给一条「有 N 条新提交」，点了才换。
 * 页面切到后台就停。
 */
const newCount = ref(0)
const newCountCapped = computed(() => newCount.value >= query.limit)
let lastPoll = Date.now()
const visibility = useDocumentVisibility()

function isPending(row: Row) {
  if ("result" in row) {
    return row.result === SubmissionStatus.pending || row.result === SubmissionStatus.judging
  }
  return (
    row.status === FlowchartSubmissionStatus.PENDING ||
    row.status === FlowchartSubmissionStatus.PROCESSING
  )
}

const hasPending = computed(() => rows.value.some(isPending))

useIntervalFn(async () => {
  if (visibility.value !== "visible" || loading.value || !loaded.value) return
  const interval = hasPending.value ? 3000 : 15000
  if (Date.now() - lastPoll < interval) return
  if (!hasPending.value && query.page !== 1) return
  lastPoll = Date.now()
  const seq = requestSeq
  const mode = flowMode.value
  let res
  try {
    res = await fetchPage()
  } catch {
    return
  }
  // 这期间筛选变了、翻页了，这份结果就作废
  if (seq !== requestSeq || mode !== flowMode.value) return
  const fresh = new Map<string, Row>(res.results.map((row) => [row.id, row]))
  if (mode) {
    flowcharts.value = flowcharts.value.map(
      (row) => (fresh.get(row.id) as FlowchartSubmissionListItem | undefined) ?? row,
    )
  } else {
    submissions.value = submissions.value.map(
      (row) => (fresh.get(row.id) as SubmissionListItem | undefined) ?? row,
    )
  }
  if (query.page === 1) {
    const current = new Set(rows.value.map((row) => row.id))
    const newest = rows.value[0]?.createTime ?? ""
    newCount.value = res.results.filter(
      (row) => !current.has(row.id) && row.createTime > newest,
    ).length
  }
}, 1000)

function showNew() {
  newCount.value = 0
  if (query.page !== 1) query.page = 1
  else listSubmissions()
}

// ==================== 筛选 ====================

const resultOptions = [
  { label: "全部结果", value: "" },
  { label: "答案正确", value: String(SubmissionStatus.accepted) },
  { label: "答案错误", value: String(SubmissionStatus.wrong_answer) },
  { label: "编译失败", value: String(SubmissionStatus.compile_error) },
  { label: "运行时错误", value: String(SubmissionStatus.runtime_error) },
  { label: "运行超时", value: String(SubmissionStatus.cpu_time_limit_exceeded) },
  { label: "内存超限", value: String(SubmissionStatus.memory_limit_exceeded) },
  { label: "语法未通过", value: String(SubmissionStatus.ast_check_failed) },
  { label: "正在评分", value: String(SubmissionStatus.judging) },
  { label: "系统错误", value: String(SubmissionStatus.system_error) },
]

const gradeOptions = [
  { label: "全部等级", value: "" },
  { label: "S 级", value: "S" },
  { label: "A 级", value: "A" },
  { label: "B 级", value: "B" },
  { label: "C 级", value: "C" },
]

// 原来没有 SQL：3 月以来有 91 条 SQL 提交、9 道题开了 SQL，想筛只能靠翻
const languageOptions = [
  { label: "全部语言", value: "" },
  { label: "Python", value: "Python" },
  { label: "C语言", value: "C" },
  { label: "C++", value: "C++" },
  { label: "SQL", value: "SQL" },
]

const classOptions = computed(() => {
  const list = configStore.config?.classList ?? []
  // 带进来的班级不在配置里（老班、手打的）也要显示得出来，不然框里是空的却在筛
  const all = query.className && !list.includes(query.className) ? [query.className, ...list] : list
  return all.map((item) => ({ label: classLabel(item), value: item }))
})

const contestProblemOptions = computed(() => [
  { label: "全部题目", value: "" },
  ...contestStore.problems.map((problem) => ({
    label: `${problem._id} ${problem.title}`,
    value: problem._id,
  })),
])

const mode = computed({
  get: () => (flowMode.value ? "flow" : "code"),
  set: (value: string) => (query.language = value === "flow" ? "Flowchart" : ""),
})

const mine = computed(() => query.myself === "1")
const scope = computed({
  get: () => (mine.value ? "mine" : "all"),
  set: (value: string) => {
    // 「这节课」是看全班用的，切到「我的」就把它带的题号和「今天」一起放掉
    if (value === "mine" && lessonActive.value) {
      query.problem = ""
      query.today = "0"
    }
    query.myself = value === "mine" ? "1" : "0"
  },
})

/** 1366 以下（机房 1280 的屏）老师那排放不下：「今日统计」只留图标和数字 */
const narrowBar = useMediaQuery("(max-width: 1365px)")

const today = computed({
  get: () => query.today === "1",
  set: (value: boolean) => (query.today = value ? "1" : "0"),
})

/** 「这节课」：一键筛到 班级 + 这节课的题 + 今天。班级和题的取法同课堂看板 */
const lesson = ref<ClassLesson | null>(null)
const lessonIds = computed(
  () => lesson.value?.problems.map((problem) => problem.problemDisplayId).join(",") ?? "",
)
const lessonActive = computed(
  () =>
    !!lesson.value?.className &&
    !!lesson.value.problems.length &&
    query.className === lesson.value.className &&
    query.problem === lessonIds.value &&
    query.today === "1",
)
const lessonLoading = ref(false)

async function toggleLesson() {
  if (lessonActive.value) {
    query.problem = ""
    query.today = "0"
    return
  }
  lessonLoading.value = true
  try {
    const res = await getClassLesson(query.className || undefined)
    if (!res.className) {
      message.info("猜不出是哪个班在上课，先在班级里选一个")
      return
    }
    query.className = res.className
    if (!res.problems.length) {
      message.info(`${classLabel(res.className)}今天还没有布置题，也还没人交。可以先去课堂看板布置`)
      return
    }
    lesson.value = res
    query.problem = lessonIds.value
    query.today = "1"
  } finally {
    lessonLoading.value = false
  }
}

const activeFilters = computed(
  () =>
    [query.username, query.className, query.result, query.problem].filter(Boolean).length +
    (query.today === "1" ? 1 : 0) +
    (query.language && query.language !== "Flowchart" ? 1 : 0),
)
const mobileFilters = ref(false)

function clear() {
  const keepMode = query.language === "Flowchart" ? "Flowchart" : ""
  exactFor.value = ""
  clearQuery()
  query.myself = "0"
  query.today = "0"
  query.language = keepMode
}

/** 现在是不是按整名只看一个人（输入框换成名字标签的时候） */
const exactPerson = computed(() => !!exactFor.value && query.username === exactFor.value)

function clearPerson() {
  exactFor.value = ""
  query.username = ""
}

function filterUser(username: string) {
  exactFor.value = username
  query.myself = "0"
  query.username = username
}

/**
 * 「数据统计」：新标签打开统计页，带上现在的班级 / 学生 / 题号 / 代码或流程图
 * （原来是这一页上的弹框）。「今天」带过去就是统计页的「今天」
 */
function openStatistics() {
  const href = router.resolve({
    name: "statistics",
    query: {
      ...(flowMode.value ? { tab: "flow" } : {}),
      ...(query.className ? { className: query.className } : {}),
      ...(query.username ? { username: query.username } : {}),
      ...(query.problem ? { problem: query.problem } : {}),
      ...(query.today === "1" ? { period: "today" } : {}),
    },
  }).href
  window.open(href, "_blank")
}

function filterProblem(displayId: string) {
  query.problem = displayId
}

// ==================== 行上的动作 ====================

function openProblem(row: Row) {
  if (inContest.value) {
    const path = router.resolve({
      name: "contest problem",
      params: { contestID: route.params.contestID, problemID: row.problemDisplayId },
    })
    window.open(path.href, "_blank")
  } else {
    window.open("/problem/" + row.problemDisplayId, "_blank")
  }
}

async function rejudge(id: string) {
  try {
    await adminRejudge(id)
  } catch {
    message.error("重新判题没成功")
    return
  }
  message.success("已重新判题，结果出来会自己更新")
  const row = submissions.value.find((item) => item.id === id)
  if (row) row.result = SubmissionStatus.pending
  lastPoll = 0
}

async function retryFlowchart(id: string) {
  // 按错误码分支而不是 match 文案（见 utils/api.ts 的约定）——后端文案是英文的
  const retryTips: Record<string, string> = {
    "retry-not-allowed": "这条还在评分中，等出了结果再重新评分",
    "too-many-submissions": "操作太频繁了，缓一下再试",
    "flowchart-not-found": "提交不存在，或者没有权限",
  }
  try {
    await retryFlowchartSubmission(id)
  } catch (err) {
    message.error(retryTips[errorCode(err) ?? ""] ?? "重新评分失败")
    return
  }
  message.success("已重新评分，结果出来会自己更新")
  const row = flowcharts.value.find((item) => item.id === id)
  if (row) row.status = FlowchartSubmissionStatus.PENDING
  lastPoll = 0
}

function caseText(row: SubmissionListItem) {
  const summary = row.caseSummary
  if (!summary) return null
  return { text: `${summary.passed}/${summary.total}`, full: summary.passed >= summary.total }
}

/** 学生看别人的那几行：名字淡一档、带一把锁（自己的看不了是题单那道闸，另说） */
function othersRow(row: SubmissionListItem) {
  return !row.showLink && row.userId !== userStore.user?.id
}

/**
 * 按天插一条分隔行，时间那一列只写钟点。原来每行都写「9月28日 23:59」，
 * 左栏 560 宽里题目名就只剩三个字。
 */
function dayKey(time: string) {
  return parseTime(time, "YYYY-MM-DD")
}

function dayBreak(index: number) {
  const list = rows.value
  const key = dayKey(list[index]!.createTime)
  if (index > 0 && dayKey(list[index - 1]!.createTime) === key) return ""
  return submissionDayText(list[index]!.createTime)
}
</script>

<template>
  <div class="page" :class="{ contest: inContest, mobile: isMobile }">
    <!-- 筛选栏 -->
    <div v-if="isDesktop" class="filters">
      <!-- 流程图列表要登录才能看（GET /flowcharts 是 requireAuth），没登录就不给这个切换 -->
      <template v-if="!inContest && userStore.isAuthed">
        <n-radio-group v-model:value="mode" size="small">
          <n-radio-button value="code">代码</n-radio-button>
          <n-radio-button value="flow">流程图</n-radio-button>
        </n-radio-group>
      </template>
      <!-- 老师也有：从个人菜单「我的提交」进来的，原来只能靠「清空」退出去 -->
      <n-radio-group v-if="userStore.isAuthed" v-model:value="scope" size="small">
        <n-radio-button value="all">全部</n-radio-button>
        <n-radio-button value="mine">我的</n-radio-button>
      </n-radio-group>
      <span v-if="userStore.isAuthed" class="vsep"></span>

      <!-- 「我的」时这节课 / 班级 / 学生都用不上：后端只看自己时本来就不认它们 -->
      <!-- 学生界面没有班级下拉：地址里带着班级（比如从统计页、看板跳过来）就摆一个能点掉的标签，
           不然一直被一个看不见的条件筛着 -->
      <button
        v-if="!teacher && query.className"
        class="chip on"
        title="点一下去掉班级筛选"
        @click="query.className = ''"
      >
        {{ classLabel(query.className) }}<Icon icon="ph:x-bold" :width="12" />
      </button>
      <template v-if="teacher && !inContest && !mine">
        <button
          class="lesson"
          :class="{ on: lessonActive }"
          :disabled="lessonLoading"
          title="筛到正在上课的班、这节课的题、今天"
          @click="toggleLesson"
        >
          <Icon v-if="lessonActive" icon="ph:check-bold" :width="12" />
          <b>这节课</b>
          <template v-if="lessonActive && lesson?.className">
            <span>
              {{ classLabel(lesson.className) }} · {{ lesson.problems.length }} 道题 · 今天
            </span>
            <Icon icon="ph:x-bold" :width="12" class="lesson-x" />
          </template>
        </button>
        <n-select
          v-if="!lessonActive"
          :value="query.className || null"
          class="w-class"
          size="small"
          :options="classOptions"
          placeholder="全部班级"
          clearable
          filterable
          @update:value="(v: string | null) => (query.className = v ?? '')"
        />
      </template>

      <!-- 按整名只看一个人（「只看他」、协作条、看板点进来）：用户名有八九个字，塞进 108px 的
           输入框只剩半截，还被清除按钮压着 —— 换成一个带名字的标签，点 × 取消 -->
      <button
        v-if="!mine && exactPerson"
        class="chip on person"
        :title="`只看 ${query.username}（点一下取消）`"
        @click="clearPerson"
      >
        <Icon icon="ph:user-bold" :width="12" />
        <UserName :username="query.username" class="person-name" />
        <Icon icon="ph:x-bold" :width="12" />
      </button>
      <n-input
        v-else-if="!mine"
        v-model:value="query.username"
        class="w-user"
        size="small"
        clearable
        :placeholder="teacher ? '学生' : '用户'"
      >
        <template #prefix><Icon icon="ph:magnifying-glass" /></template>
      </n-input>
      <n-select
        v-if="inContest"
        v-model:value="query.problem"
        class="w-problem-select"
        size="small"
        :options="contestProblemOptions"
      />
      <n-input
        v-else-if="!lessonActive"
        v-model:value="query.problem"
        class="w-problem"
        size="small"
        clearable
        placeholder="题号"
        :status="unknownProblems.length ? 'warning' : undefined"
      >
        <template #prefix><Icon icon="ph:hash" /></template>
      </n-input>
      <n-select
        v-model:value="query.result"
        class="w-result"
        size="small"
        :options="flowMode ? gradeOptions : resultOptions"
      />
      <n-select
        v-if="!inContest && !flowMode"
        v-model:value="query.language"
        class="w-lang"
        size="small"
        :options="languageOptions"
      />
      <button
        v-if="!inContest && !lessonActive"
        class="chip"
        :class="{ on: today }"
        @click="today = !today"
      >
        <Icon v-if="today" icon="ph:check-bold" :width="12" />今天
      </button>
      <n-button size="small" quaternary @click="clear">清空</n-button>

      <div class="spacer"></div>
      <n-button
        v-if="route.name === 'submissions' && !flowMode"
        size="small"
        quaternary
        :title="`今日统计：今天全站 ${todayCount} 条`"
        @click="toggleTodayPanel(true)"
      >
        <template #icon><Icon icon="ph:chart-bar" /></template>
        <template v-if="!(teacher && narrowBar)">今日统计</template>
        <span v-if="todayCount" class="count">{{ todayCount }}</span>
      </n-button>
      <n-button v-if="teacher && route.name === 'submissions'" size="small" @click="openStatistics">
        <template #icon><Icon icon="ph:chart-pie-slice" /></template>
        数据统计
      </n-button>
    </div>

    <!-- 手机：只留全部/我的，其余收进「筛选」 -->
    <div v-else class="filters mobile-filters">
      <n-radio-group v-if="userStore.isAuthed" v-model:value="scope" size="small">
        <n-radio-button value="all">全部</n-radio-button>
        <n-radio-button value="mine">我的</n-radio-button>
      </n-radio-group>
      <div class="spacer"></div>
      <n-button size="small" @click="mobileFilters = !mobileFilters">
        <template #icon><Icon icon="ph:funnel-simple" /></template>
        筛选<template v-if="activeFilters"> · {{ activeFilters }}</template>
      </n-button>
    </div>
    <div v-if="isMobile && mobileFilters" class="mobile-panel">
      <n-radio-group v-if="!inContest && userStore.isAuthed" v-model:value="mode" size="small">
        <n-radio-button value="code">代码</n-radio-button>
        <n-radio-button value="flow">流程图</n-radio-button>
      </n-radio-group>
      <n-input
        v-model:value="query.username"
        size="small"
        clearable
        :disabled="query.myself === '1'"
        placeholder="用户"
      />
      <n-input v-model:value="query.problem" size="small" clearable placeholder="题号" />
      <n-select
        v-model:value="query.result"
        size="small"
        :options="flowMode ? gradeOptions : resultOptions"
      />
      <n-select
        v-if="!inContest && !flowMode"
        v-model:value="query.language"
        size="small"
        :options="languageOptions"
      />
      <n-flex align="center">
        <button v-if="!inContest" class="chip" :class="{ on: today }" @click="today = !today">
          <Icon v-if="today" icon="ph:check-bold" :width="12" />今天
        </button>
        <n-button size="small" quaternary @click="clear">清空</n-button>
      </n-flex>
    </div>

    <div class="split">
      <!-- 左栏：列表 -->
      <section class="list">
        <div v-if="unknownProblems.length" class="unknown-bar">
          <Icon icon="ph:warning" :width="13" />
          题号 {{ unknownProblems.join("、") }} 没有这道题，下面只有其余题号的提交
        </div>
        <button v-if="newCount" class="new-bar" @click="showNew">
          <Icon icon="ph:arrow-up-bold" :width="13" />
          有 {{ newCount }}{{ newCountCapped ? "+" : "" }} 条新提交，点这里显示
        </button>
        <div class="rows" :class="{ dim: showLoading }">
          <template v-if="flowMode">
            <template v-for="(row, index) in flowcharts" :key="row.id">
              <div v-if="dayBreak(index)" class="day">{{ dayBreak(index) }}</div>
              <div
                class="row"
                :class="{ on: row.id === selectedId && !isMobile, mobile: isMobile }"
                :data-row-id="row.id"
                @click="rowClicked(row)"
              >
                <template v-if="isDesktop">
                  <span class="c-time">{{ submissionClockText(row.createTime) }}</span>
                  <span class="c-user"><UserName :username="row.username" /></span>
                  <span class="c-problem" :title="`${row.problemDisplayId} ${row.problemTitle}`">
                    <span class="pid">{{ row.problemDisplayId }}</span> {{ row.problemTitle }}
                  </span>
                  <span class="c-state">
                    <FlowchartState
                      :status="row.status"
                      :grade="row.aiGrade"
                      :score="row.aiScore"
                    />
                  </span>
                </template>
                <template v-else>
                  <div class="m-line">
                    <UserName :username="row.username" />
                    <div class="spacer"></div>
                    <FlowchartState
                      :status="row.status"
                      :grade="row.aiGrade"
                      :score="row.aiScore"
                    />
                  </div>
                  <div class="m-line sub">
                    <span>{{ submissionClockText(row.createTime) }}</span>
                    <span class="title">{{ row.problemDisplayId }} {{ row.problemTitle }}</span>
                  </div>
                </template>
              </div>
            </template>
          </template>
          <template v-else>
            <template v-for="(row, index) in submissions" :key="row.id">
              <div v-if="dayBreak(index)" class="day">{{ dayBreak(index) }}</div>
              <div
                class="row"
                :class="{ on: row.id === selectedId && !isMobile, mobile: isMobile }"
                :data-row-id="row.id"
                @click="rowClicked(row)"
              >
                <template v-if="isDesktop">
                  <span class="c-time">{{ submissionClockText(row.createTime) }}</span>
                  <span class="c-user">
                    <UserName :username="row.username" :muted="othersRow(row)" />
                  </span>
                  <span class="c-problem" :title="`${row.problemDisplayId} ${row.problemTitle}`">
                    <span class="title">
                      <span class="pid">{{ row.problemDisplayId }}</span> {{ row.problemTitle }}
                    </span>
                    <span
                      v-if="row.problemSet"
                      class="ps"
                      :title="'从题单「' + row.problemSet.title + '」交的'"
                    >
                      题单
                    </span>
                  </span>
                  <span class="c-case">
                    <span
                      v-if="caseText(row)"
                      :style="{
                        color: caseText(row)!.full ? theme.textColor3 : tone('error').color,
                      }"
                    >
                      {{ caseText(row)!.text }}
                    </span>
                  </span>
                  <span class="c-state"><StatusPill :result="row.result" /></span>
                  <span v-if="!teacher" class="c-lock">
                    <!-- title 放在外层 span：挂在 svg 上 Chrome 不出提示 -->
                    <span
                      v-if="!row.showLink"
                      class="lock-hint"
                      :title="othersRow(row) ? '别人的代码看不到' : '在题单里做完才能看'"
                    >
                      <Icon icon="ph:lock-simple" :width="13" />
                    </span>
                  </span>
                </template>
                <template v-else>
                  <div class="m-line">
                    <UserName :username="row.username" :muted="othersRow(row)" />
                    <div class="spacer"></div>
                    <StatusPill :result="row.result" />
                  </div>
                  <div class="m-line sub">
                    <span>{{ submissionClockText(row.createTime) }}</span>
                    <span class="title">{{ row.problemDisplayId }} {{ row.problemTitle }}</span>
                    <div class="spacer"></div>
                    <span v-if="caseText(row)">{{ caseText(row)!.text }}</span>
                  </div>
                </template>
              </div>
            </template>
          </template>
          <div v-if="loaded && !rows.length" class="empty">
            <span class="empty-title">
              {{
                lessonActive
                  ? "这节课的题还没有人交"
                  : mine && activeFilters === 0
                    ? "你还没有交过"
                    : "没有符合条件的提交"
              }}
            </span>
            <n-button v-if="activeFilters" size="small" @click="clear">清空筛选</n-button>
          </div>
          <div v-if="!loaded" class="empty"><n-spin size="small" /></div>
        </div>
        <div class="list-foot">
          <span v-if="total" class="total">共 {{ total }} 条</span>
          <div class="spacer"></div>
          <Pagination
            class="pager"
            :total="total"
            v-model:limit="query.limit"
            v-model:page="query.page"
          />
        </div>
      </section>

      <!-- 右栏：选中那一条 -->
      <template v-if="isDesktop && selectedRow">
        <FlowchartPane
          v-if="flowMode"
          :row="selectedRow as FlowchartSubmissionListItem"
          :teacher="teacher"
          :position="position"
          @filter-user="filterUser"
          @filter-problem="filterProblem"
          @open-problem="openProblem"
          @retry="retryFlowchart"
        />
        <SubmissionPane
          v-else
          :row="selectedRow as SubmissionListItem"
          :teacher="teacher"
          :contest="inContest"
          :position="position"
          @filter-user="filterUser"
          @filter-problem="filterProblem"
          @open-problem="openProblem"
          @rejudge="rejudge"
        />
      </template>
      <section v-else-if="isDesktop" class="pane-empty">
        <span v-if="loaded && rows.length">点左边一行看代码</span>
      </section>
    </div>
  </div>

  <n-drawer v-if="isMobile" v-model:show="mobilePane" width="100%" placement="right">
    <n-drawer-content
      closable
      title="提交详情"
      :body-content-style="{ padding: 0, height: '100%' }"
    >
      <div v-if="selectedRow" class="mobile-pane">
        <FlowchartPane
          v-if="flowMode"
          :row="selectedRow as FlowchartSubmissionListItem"
          :teacher="teacher"
          :position="null"
          narrow
          @filter-user="(name: string) => ((mobilePane = false), filterUser(name))"
          @filter-problem="(id: string) => ((mobilePane = false), filterProblem(id))"
          @open-problem="openProblem"
          @retry="retryFlowchart"
        />
        <SubmissionPane
          v-else
          :row="selectedRow as SubmissionListItem"
          :teacher="teacher"
          :contest="inContest"
          :position="null"
          narrow
          @filter-user="(name: string) => ((mobilePane = false), filterUser(name))"
          @filter-problem="(id: string) => ((mobilePane = false), filterProblem(id))"
          @open-problem="openProblem"
          @rejudge="rejudge"
        />
      </div>
      <!-- 手机没有方向键：上一条 / 下一条换成按钮，走的是同一个 move() -->
      <template #footer>
        <n-flex justify="space-between" style="width: 100%">
          <n-button
            :disabled="!position || (position.index <= 1 && query.page <= 1)"
            @click="move(-1)"
          >
            上一条
          </n-button>
          <span class="mobile-pos">{{
            position ? `${position.index} / ${position.count}` : ""
          }}</span>
          <n-button
            :disabled="!position || (position.index >= position.count && query.page >= maxPage)"
            @click="move(1)"
          >
            下一条
          </n-button>
        </n-flex>
      </template>
    </n-drawer-content>
  </n-drawer>

  <n-modal
    v-model:show="todayPanel"
    preset="card"
    :style="{ maxWidth: isDesktop && '700px', maxHeight: '80vh' }"
    :content-style="{ overflow: 'auto' }"
    title="今日提交统计"
  >
    <TodayStatistics @open-problem="(id: string) => openProblem({ problemDisplayId: id } as Row)" />
  </n-modal>
</template>

<style scoped>
/* 铺满顶栏以下：和题目页一样用负边距吃掉外层 16px 的内边距（顶栏 56） */
.page {
  margin: -16px;
  height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  background: v-bind("theme.cardColor");
}

/* 比赛里套在比赛页头下面，不铺满，给个框 */
.page.contest {
  margin: 0;
  height: calc(100vh - 150px);
  min-height: 480px;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 6px;
  overflow: hidden;
}

/* 手机上整页自然滚动，不锁高度 */
.page.mobile {
  height: auto;
}

.mobile .split {
  flex: none;
}

.filters {
  height: 52px;
  flex: none;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.mobile-filters {
  padding: 0 14px;
}

.mobile-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.vsep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: v-bind("theme.dividerColor");
}

.w-class {
  width: 132px;
}
.w-user {
  width: 120px;
}
.w-problem {
  width: 100px;
}
.w-problem-select {
  width: 160px;
}
.w-result {
  width: 112px;
}
.w-lang {
  width: 104px;
}

/* 机房 1280 的屏上老师那排只剩几像素：学生、语言两个框各收一点，别让班级框被挤扁 */
@media (max-width: 1365px) {
  .w-user {
    width: 108px;
  }
  .w-lang {
    width: 96px;
  }
}

.spacer {
  flex: 1 1 0;
}

.count {
  margin-left: 4px;
  color: v-bind("theme.textColor3");
}

.chip,
.lesson {
  height: 28px;
  padding: 0 12px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 14px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  flex: none;
}

.chip.on,
.lesson.on {
  border-color: v-bind("theme.primaryColor");
  background: v-bind("tone('success').background");
  color: v-bind("tone('success').color");
}

.chip.on {
  font-weight: 600;
}

.chip.person {
  max-width: 180px;
  padding: 0 10px;
}

.chip.person .person-name {
  font-size: 13px;
}

.lesson b {
  font-weight: 600;
}

.lesson-x {
  margin-left: 2px;
  opacity: 0.7;
}

.split {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
}

/* 列表占多一点：学生的代码大多十来行、一行几十个字，右边给多了是一片空白（用户看过定的）。
   大屏上列表最宽 1000，再宽一行里全是空隙 */
.list {
  flex: 0 0 56%;
  max-width: 1000px;
  box-sizing: border-box;
  border-right: 1px solid v-bind("theme.dividerColor");
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mobile .list {
  flex: 1 1 auto;
  max-width: none;
  width: 100%;
  border-right: 0;
}

.new-bar {
  height: 32px;
  flex: none;
  border: 0;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  background: v-bind("tone('success').background");
  font: inherit;
  font-size: 13px;
  color: v-bind("tone('success').color");
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
}

.unknown-bar {
  height: 32px;
  flex: none;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: v-bind("tone('warning').color");
  background: v-bind("tone('warning').background");
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.rows {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  transition: opacity 0.15s;
}

/* 手机上整页滚：列表按内容撑高（flex: 1 1 0 在不定高的容器里会算成 0） */
.mobile .rows {
  flex: none;
  overflow: visible;
}

.rows.dim {
  opacity: 0.55;
}

.row {
  height: 40px;
  box-sizing: border-box;
  padding: 0 16px 0 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  cursor: pointer;
  font-size: 14px;
}

/* 往上翻时选中那一行别被吸顶的日期行挡住 */
.row {
  scroll-margin-top: 28px;
}

.row:hover {
  background: v-bind("theme.hoverColor");
}

.row.on {
  background: v-bind("tone('success').background");
}

.row.mobile {
  height: 60px;
  padding: 0 14px;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 4px;
}

.m-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.m-line.sub {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.m-line .title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c-time {
  width: 44px;
  flex: none;
  font-size: 13px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 按天的分隔行：吸在顶上，往下翻时一直知道在看哪天 */
.day {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 26px;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.c-user {
  width: 116px;
  flex: none;
  display: flex;
  overflow: hidden;
}

.c-problem {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  color: v-bind("theme.textColor2");
}

.c-problem .title {
  overflow: hidden;
  text-overflow: ellipsis;
}

.pid {
  color: v-bind("theme.textColor3");
}

.ps {
  flex: none;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  color: v-bind("tone('info').color");
  background: v-bind("tone('info').background");
}

.c-case {
  width: 34px;
  flex: none;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.c-state {
  width: 104px;
  flex: none;
  display: flex;
  justify-content: flex-end;
}

.lock-hint {
  display: flex;
}

.c-lock {
  width: 14px;
  flex: none;
  display: flex;
  color: v-bind("theme.textColor3");
  opacity: 0.6;
}

.empty {
  padding: 48px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: v-bind("theme.textColor3");
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: v-bind("theme.textColor2");
}

.list-foot {
  height: 44px;
  flex: none;
  box-sizing: border-box;
  padding: 0 16px 0 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.total {
  font-size: 13px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}

/* Pagination 组件自带上下 20px 外边距和整行宽，放进这条细栏里要收掉 */
.list-foot :deep(.pager) {
  margin: 0;
  width: auto;
}

.pane-empty {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.bodyColor");
}

.mobile-pane {
  height: 100%;
  display: flex;
}

.mobile-pos {
  align-self: center;
  color: v-bind("theme.textColor3");
}
</style>

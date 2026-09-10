import {
  type FormatCodeResponse,
  type ClassComparisonResponse,
  type ClassRankItem,
  type ClassUserRank,
  type CreateSubmissionResponse,
  type ProblemAuthor,
  type CreateFlowchartResponse,
  problemDetailSchema,
  problemListSchema,
  problemListItemSchema,
  submissionDetailSchema,
  submissionListSchema,
  submissionStatisticsSchema,
  submissionStatisticsItemsSchema,
  onlineCountSchema,
  websiteConfigSchema,
  contestListSchema,
  contestSchema,
  contestAccessSchema,
  contestRankSchema,
  announcementListSchema,
  announcementSchema,
  problemSetListSchema,
  problemSetSchema,
  problemSetBadgeSchema,
  userBadgeSchema,
  tutorialSchema,
  metricsSchema,
  activityRankItemSchema,
  problemRankSchema,
  userRankSchema,
  flowchartListSchema,
  flowchartDetailSchema,
  flowchartCurrentSchema,
  flowchartStatisticsSchema,
  flowchartSubmissionSchema,
  exerciseSchema,
  exerciseDataByType,
  problemSetProgressListSchema,
  problemSetProblemSchema,
  tutorialSummarySchema,
  tutorialProgressSchema,
  messageListSchema,
  yearlyAcSchema,
  aiDetailSchema,
  solvedListSchema,
  durationDataSchema,
  heatmapItemSchema,
  loginSummarySchema,
  aiAnalysisRecordSchema,
} from "@oj2/contract"
import api from "utils/api"
import { contract } from "utils/contract"
import { filterResult } from "oj/transforms"
import type {
  Profile,
  Exercise,
  Problem,
  ReactionKey,
  ReactionState,
  SubmissionListPayload,
  SubmitCodePayload,
} from "utils/types"

/**
 * 题目详情。走契约的 zod 解析，形状即契约 —— 之前这里手抄了一份 camel→snake 的
 * 键名映射，抄漏一个字段就是静默 undefined。
 *
 * 走 `contract()` 而不是裸 `parse()`：这里原来是
 * `problemDetailSchema.parse(value) as Problem` —— `as` 把校验结果又断言回本地
 * 类型，等于校验白做。契约现在把 `languages` / `template` 都收进了联合，
 * `Problem` 不再需要额外窄化，`as` 也就没有存在的理由了。
 */
function detailProblem(value: unknown): Problem {
  return contract("GET /problems/:id", problemDetailSchema, value)
}

export async function getWebsiteConfig() {
  const endpoint = "site"
  return contract(
    "GET /site",
    websiteConfigSchema,
    await api.get<unknown>(endpoint),
  )
}

/** 当前在线人数。只有聚合数字，「谁在线」在榜单接口里、且只对老师下发 */
export async function getOnlineCount() {
  const endpoint = "site/online"
  return contract(
    "GET /site/online",
    onlineCountSchema,
    await api.get<unknown>(endpoint),
  )
}

export async function getProblemList(
  offset = 0,
  limit = 10,
  searchParams: Record<string, unknown> = {},
) {
  const endpoint = "problems"
  const res = contract(
    "GET /problems",
    problemListSchema,
    await api.get<unknown>(endpoint, {
      params: { paging: true, offset, limit, ...searchParams },
    }),
  )
  return {
    results: res.results.map(filterResult),
    total: res.total,
  }
}

export function getAuthors(all = false) {
  return api.get<ProblemAuthor[]>("problem-authors", {
    params: { all: all ? "1" : "0" },
  })
}

export async function getProblem(problemID: string, contestID: string) {
  const endpoint = contestID
    ? `contests/${encodeURIComponent(contestID)}/problems/${encodeURIComponent(problemID)}`
    : `problems/${encodeURIComponent(problemID)}`
  return detailProblem(await api.get<unknown>(endpoint))
}

// 未登录返回 "0"，登录后返回百分比字符串
export function getProblemBeatRate(problemID: number) {
  return api.get<string>(`problems/${problemID}/beat-count`)
}

export async function getSubmission(id: string) {
  const endpoint = `submissions/${encodeURIComponent(id)}`
  return contract(
    "GET /submissions/:id",
    submissionDetailSchema,
    await api.get<unknown>(endpoint),
  )
}

export function submitCode(data: SubmitCodePayload) {
  return api.post<CreateSubmissionResponse>("submissions", data)
}

export function formatCode(data: { code: string; language: string }) {
  const languages: Record<string, string> = {
    Python3: "python",
    C: "c",
    "C++": "cpp",
    SQL: "sql",
  }
  return api.post<FormatCodeResponse>("code/format", {
    code: data.code,
    language: languages[data.language] ?? data.language.toLowerCase(),
  })
}

export function getSubmissions(params: Partial<SubmissionListPayload>) {
  const endpoint = params.contestId
    ? `contests/${encodeURIComponent(params.contestId)}/submissions`
    : "submissions"
  return getSubmissionPage(endpoint, params)
}

/**
 * 提交列表。后端在 `submissionListItemSchema.parse` 上真的会抛 —— 它逐个列表项
 * 过 schema，所以这条链路上的分歧**后端自己就拦住了**，前端这层校验是第二道保险：
 * 主要防「后端加了字段但契约没跟上、前端类型声称有实际是 undefined」这类
 * 只在展示端出问题的偏差。
 */
async function getSubmissionPage(
  endpoint: string,
  params: Partial<SubmissionListPayload>,
) {
  return contract(
    `GET /${endpoint}`,
    submissionListSchema,
    await api.get<unknown>(endpoint, {
      // contestId 走的是路径，page 只有前端分页器用
      params: { ...params, contestId: undefined, page: undefined },
    }),
  )
}

export async function getRankOfProblem(problemId: string) {
  const endpoint = `problems/${encodeURIComponent(problemId)}/rank`
  return contract(
    "GET /problems/:id/rank",
    problemRankSchema,
    await api.get<unknown>(endpoint),
  )
}

export function getTodaySubmissionCount(language?: string) {
  return api.get<number>("submissions/today-count", { params: { language } })
}

export function adminRejudge(id: string) {
  return api.post<{ ok: boolean }>(
    `submissions/${encodeURIComponent(id)}/rejudge`,
  )
}

/**
 * 统计面板展开一行时拉这个人的明细。username 这里要**精确**到人，
 * 和上面那个按班级模糊匹配的不是一回事。
 */
export async function getSubmissionStatisticsItems(
  duration: { start?: string; end: string },
  username: string,
  problemID?: string,
) {
  const endpoint = "submissions/statistics/items"
  return contract(
    "GET /submissions/statistics/items",
    submissionStatisticsItemsSchema,
    await api.get<unknown>(endpoint, {
      params: { ...duration, problemId: problemID, username },
    }),
  )
}

export async function getSubmissionStatistics(
  duration: { start?: string; end: string },
  problemID?: string,
  username?: string,
) {
  const endpoint = "submissions/statistics"
  return contract(
    "GET /submissions/statistics",
    submissionStatisticsSchema,
    await api.get<unknown>(endpoint, {
      params: { ...duration, problemId: problemID, username },
    }),
  )
}

/**
 * 全服榜单。上限（100 名）由服务端定，调用方只管翻页 ——
 * 「全服 Top10」就是这个榜的第一页，取 limit=10 即可，不需要另一个上限参数。
 */
export async function getRank(offset: number, limit: number) {
  const endpoint = "rankings/users"
  return contract(
    "GET /rankings/users",
    userRankSchema,
    await api.get<unknown>(endpoint, { params: { offset, limit } }),
  )
}

export async function getActivityRank(start: string) {
  const endpoint = "rankings/activity"
  return contract(
    "GET /rankings/activity",
    activityRankItemSchema.array(),
    await api.get<unknown>(endpoint, { params: { start } }),
  )
}

export function getClassRank(grade?: number | null) {
  return api.get<ClassRankItem[]>("rankings/classes", { params: { grade } })
}

export function getUserClassRank(
  scope?: "all" | "window",
  offset?: number,
  limit?: number,
) {
  return api.get<ClassUserRank>("me/class-rank", {
    params: { scope, offset, limit },
  })
}

export function getClassPK(
  classNames: string[],
  startTime?: string,
  endTime?: string,
) {
  return api.post<ClassComparisonResponse>("classes/comparison", {
    classNames,
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
  })
}

export async function getContestList(query: {
  offset: number
  limit: number
  keyword: string
  status: string
  tag: string
}) {
  const endpoint = "contests"
  return contract(
    "GET /contests",
    contestListSchema,
    await api.get<unknown>(endpoint, { params: query }),
  )
}

export async function getContest(id: string) {
  const endpoint = `contests/${encodeURIComponent(id)}`
  return contract(
    "GET /contests/:id",
    contestSchema,
    await api.get<unknown>(endpoint),
  )
}

export async function getContestAccess(id: string) {
  const endpoint = `contests/${encodeURIComponent(id)}/access`
  return contract(
    "GET /contests/:id/access",
    contestAccessSchema,
    await api.get<unknown>(endpoint),
  )
}

// 注意和 GET /access 不一样：这个返回裸 true，密码错是 403 走 catch
export function checkContestPassword(contestID: string, password: string) {
  return api.post<boolean>(
    `contests/${encodeURIComponent(contestID)}/access`,
    {
      password,
    },
  )
}

export async function getContestProblems(contestID: string) {
  const endpoint = `contests/${encodeURIComponent(contestID)}/problems`
  // 用 problemListItemSchema.array()，不是契约的 contestProblemsSchema ——
  // 后者是 `array(union([列表项, 详情]))`，联合类型会让 filterResult 的类型收窄
  // 落到详情分支上，而且学生侧这条接口只下发列表项。
  const res = contract(
    "GET /contests/:id/problems",
    problemListItemSchema.array(),
    await api.get<unknown>(endpoint),
  )
  return res.map(filterResult)
}

export async function getContestRank(
  contestID: string,
  query: { limit: number; offset: number },
) {
  // submissionInfo 在契约里是 Record<string, unknown>（JSONB 原文），
  // 前端在这里收窄成 SubmissionInfo，见 utils/types 的 ContestRank
  const endpoint = `contests/${encodeURIComponent(contestID)}/rank`
  return contract(
    "GET /contests/:id/rank",
    contestRankSchema,
    await api.get<unknown>(endpoint, { params: query }),
  )
}

export function uploadAvatar(file: File) {
  const form = new window.FormData()
  form.append("image", file)
  return api.post("me/avatar", form, {
    headers: { "content-type": "multipart/form-data" },
  })
}

export function updateProfile(data: { realName: string; mood: string }) {
  return api.put<Profile>("me/profile", data)
}

export async function getAnnouncementList(offset = 0, limit = 10) {
  const endpoint = "announcements"
  return contract(
    "GET /announcements",
    announcementListSchema,
    await api.get<unknown>(endpoint, { params: { limit, offset } }),
  )
}

export async function getAnnouncement(id: number) {
  const endpoint = `announcements/${id}`
  return contract(
    "GET /announcements/:id",
    announcementSchema,
    await api.get<unknown>(endpoint),
  )
}

export async function getMessageList(offset = 0, limit = 10) {
  const endpoint = "messages"
  return contract(
    "GET /messages",
    messageListSchema,
    await api.get<unknown>(endpoint, { params: { limit, offset } }),
  )
}

export function getReaction(problemID: number) {
  return api.get<ReactionState>(`problems/${problemID}/reaction`)
}

export function setReaction(problemID: number, type: ReactionKey) {
  return api.post<ReactionState>(`problems/${problemID}/reaction`, { type })
}

export async function getMetrics(userid: number) {
  const endpoint = `users/${userid}/metrics`
  return contract(
    "GET /users/:id/metrics",
    metricsSchema,
    await api.get<unknown>(endpoint),
  )
}

export async function getTutorial(id: number) {
  const endpoint = `tutorials/${id}`
  return contract(
    "GET /tutorials/:id",
    tutorialSchema,
    await api.get<unknown>(endpoint),
  )
}

export async function getTutorials(type: "python" | "c") {
  const endpoint = "tutorials"
  return contract(
    "GET /tutorials",
    tutorialSummarySchema.array(),
    await api.get<unknown>(endpoint, { params: { type } }),
  )
}

export async function getAIDetailData(
  start: string,
  end: string,
  username?: string,
) {
  const endpoint = "ai/detail"
  return contract(
    "GET /ai/detail",
    aiDetailSchema,
    await api.get<unknown>(endpoint, { params: { start, end, username } }),
  )
}

export async function getAISolved(
  start: string,
  end: string,
  offset: number,
  limit: number,
  username?: string,
) {
  const endpoint = "ai/solved"
  return contract(
    "GET /ai/solved",
    solvedListSchema,
    await api.get<unknown>(endpoint, {
      params: { start, end, offset, limit, username },
    }),
  )
}

export async function getAIDurationData(
  end: string,
  duration: string,
  username?: string,
) {
  const endpoint = "ai/duration"
  return contract(
    "GET /ai/duration",
    durationDataSchema.array(),
    await api.get<unknown>(endpoint, { params: { end, duration, username } }),
  )
}

export async function getAIHeatmapData(username?: string) {
  const endpoint = "ai/heatmap"
  return contract(
    "GET /ai/heatmap",
    heatmapItemSchema.array(),
    await api.get<unknown>(endpoint, {
      params: username ? { username } : {},
    }),
  )
}

export async function getAILoginSummary() {
  const endpoint = "ai/login-summary"
  return contract(
    "GET /ai/login-summary",
    loginSummarySchema,
    await api.get<unknown>(endpoint),
  )
}

export async function getAIPinnedReport() {
  const endpoint = "ai/pinned"
  return contract(
    "GET /ai/pinned",
    aiAnalysisRecordSchema.nullable(),
    await api.get<unknown>(endpoint),
  )
}

// ==================== 相似题目推荐 ====================

export async function getSimilarProblems(problemId: string) {
  const endpoint = `problems/${encodeURIComponent(problemId)}/similar`
  const res = contract(
    "GET /problems/:id/similar",
    problemListItemSchema.array(),
    await api.get<unknown>(endpoint),
  )
  return res.map(filterResult)
}

export type { YearlyAc as YearlyACData } from "@oj2/contract"

export async function getProblemYearlyAC(problemId: string) {
  const endpoint = `problems/${encodeURIComponent(problemId)}/yearly-ac`
  return contract(
    "GET /problems/:id/yearly-ac",
    yearlyAcSchema.array(),
    await api.get<unknown>(endpoint),
  )
}

// ==================== 流程图相关API ====================

export function submitFlowchart(data: {
  problemId: number
  mermaidCode: string
  flowchartData: Record<string, unknown> // 压缩之后的，元数据太长了
}) {
  return api.post<CreateFlowchartResponse>("flowcharts", data)
}

export async function getFlowchartSubmission(id: string) {
  const endpoint = `flowcharts/${encodeURIComponent(id)}`
  return contract(
    "GET /flowcharts/:id",
    flowchartSubmissionSchema,
    await api.get<unknown>(endpoint),
  )
}

export async function getFlowchartSubmissions(params: {
  username?: string
  problemId?: string
  myself?: string
  offset?: number
  limit?: number
  today?: string
  grade?: string
}) {
  const endpoint = "flowcharts"
  return contract(
    "GET /flowcharts",
    flowchartListSchema,
    await api.get<unknown>(endpoint, { params }),
  )
}

export async function getFlowchartStatistics(
  duration: { start?: string; end: string },
  problemID?: string,
  username?: string,
) {
  const endpoint = "flowcharts/statistics"
  return contract(
    "GET /flowcharts/statistics",
    flowchartStatisticsSchema,
    await api.get<unknown>(endpoint, {
      params: { ...duration, problemId: problemID, username },
    }),
  )
}

export function retryFlowchartSubmission(submissionId: string) {
  return api.post<{ status: string }>(
    `flowcharts/${encodeURIComponent(submissionId)}/retry`,
  )
}

export async function getCurrentProblemFlowchartSubmission(problemId: number) {
  const endpoint = `problems/${problemId}/flowchart/current`
  return contract(
    "GET /problems/:id/flowchart/current",
    flowchartCurrentSchema,
    await api.get<unknown>(endpoint),
  )
}

export async function getFlowchartSubmissionDetail(problemId: number, page = 0) {
  const endpoint = `problems/${problemId}/flowchart/history`
  return contract(
    "GET /problems/:id/flowchart/history",
    flowchartDetailSchema,
    await api.get<unknown>(endpoint, { params: { page } }),
  )
}

// ==================== 题单相关API ====================

export async function getProblemSetList(
  offset = 0,
  limit = 10,
  keyword = "",
  difficulty = "",
  status = "",
) {
  const endpoint = "problem-sets"
  return contract(
    "GET /problem-sets",
    problemSetListSchema,
    await api.get<unknown>(endpoint, {
      params: { offset, limit, keyword, difficulty, status },
    }),
  )
}

export async function getProblemSetDetail(id: number) {
  const endpoint = `problem-sets/${id}`
  return contract(
    "GET /problem-sets/:id",
    problemSetSchema,
    await api.get<unknown>(endpoint),
  )
}

export async function getProblemSetProblems(problemSetId: number) {
  const endpoint = `problem-sets/${problemSetId}/problems`
  return contract(
    "GET /problem-sets/:id/problems",
    problemSetProblemSchema.array(),
    await api.get<unknown>(endpoint),
  )
}

export function joinProblemSet(problemSetId: number) {
  return api.post("problem-set-progress", { problemSetId })
}

export function updateProblemSetProgress(
  problemSetId: number,
  problemId: number,
  submissionId: string,
) {
  return api.put("problem-set-progress", {
    problemSetId,
    problemId,
    submissionId,
  })
}

export async function getUserBadges(username?: string) {
  const endpoint = `users/${encodeURIComponent(username ?? "me")}/badges`
  return contract(
    "GET /users/:username/badges",
    userBadgeSchema.array(),
    await api.get<unknown>(endpoint),
  )
}

export async function getProblemSetBadges(problemSetId: number) {
  const endpoint = `problem-sets/${problemSetId}/badges`
  return contract(
    "GET /problem-sets/:id/badges",
    problemSetBadgeSchema.array(),
    await api.get<unknown>(endpoint),
  )
}

export async function getProblemSetUserProgress(
  problemSetId: number,
  params?: {
    limit?: number
    offset?: number
    className?: string
    completionStatus?: "" | "completed" | "in_progress" | "not_started"
  },
) {
  const endpoint = `problem-sets/${problemSetId}/user-progress`
  return contract(
    "GET /problem-sets/:id/user-progress",
    problemSetProgressListSchema,
    await api.get<unknown>(endpoint, { params }),
  )
}

export async function getExercises(
  tutorialId: number,
): Promise<Exercise[]> {
  const endpoint = `tutorials/${tutorialId}/exercises`
  // 外层走 exerciseSchema，内层 data 在这里按题型逐支校验：
  // `z.infer` 只能把 data 还原成 Record<string, unknown>（superRefine 无法把
  // 校验结果反映到推断类型上），所以那 7 个 Exercise*.vue 直接读
  // data.question / data.options 时本没有任何运行时保护。
  // 生产库 151 道练习题已确认七种题型的键集全部吻合。
  const rows = contract(
    "GET /tutorials/:id/exercises",
    exerciseSchema.array(),
    await api.get<unknown>(endpoint),
  )
  for (const row of rows) {
    const shape = exerciseDataByType[row.type]
    if (!shape) continue
    // 故意用同一个 contract()：形状不符时它负责记日志并放行，不抛错
    contract(
      `GET /tutorials/:id/exercises（type=${row.type} 的 data）`,
      shape,
      row.data,
    )
  }
  // 类型上仍要收窄一次：契约推断出的 data 是宽松 record，组件要的是判别联合，
  // 两者不重叠，所以只能经过 unknown。**这个断言是有意的，不是假校验** ——
  // 上面那个循环已经在运行时按题型逐支验过；它只是把「运行时已确认」告诉 TS。
  return rows as unknown as Exercise[]
}

/**
 * 上报一次练一练的作答。`answer` 是给老师看的一句人话（「选了 A、C」），
 * 只在做错时才有意义，做对了不用带。
 *
 * 截到 200 字符再发：后端契约卡的就是 200，填空题填了一整段的话，
 * 不截就是一个 400，而学生这边什么都看不见 —— 留痕失败得静悄悄的。
 */
export function reportExerciseAttempt(
  exerciseId: number,
  payload: { correct: boolean; answer?: string },
) {
  return fetch(`/api/exercises/${exerciseId}/attempts`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      correct: payload.correct,
      answer: payload.answer?.slice(0, 200),
    }),
  }).catch(() => undefined)
}

export async function getLearnProgress(type: "python" | "c") {
  const endpoint = "learn/progress"
  return contract(
    "GET /learn/progress",
    tutorialProgressSchema.array(),
    await api.get<unknown>(endpoint, { params: { type } }),
  )
}

/**
 * 上报自学留痕。`opened` 为真表示刚进这一课，否则只是补停留时长。
 *
 * 走裸 fetch 而不是 axios，是为了 `keepalive`：离开页面那一下的最后一次上报，
 * axios 发出去也会随页面卸载被浏览器掐掉，学生每节课的最后一段时长就永远丢了。
 * 失败一律吞掉 —— 留痕是旁路，不该让学生看到任何报错。
 */
export function reportLearnProgress(
  tutorialId: number,
  payload: { seconds: number; opened: boolean },
) {
  return fetch(`/api/tutorials/${tutorialId}/progress`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined)
}

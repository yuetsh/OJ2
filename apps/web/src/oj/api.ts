import {
  type AiAnalysisRecord,
  type Contest as OjContest,
  type ContestAccess,
  type ContestList,
  type ActivityRankItem,
  type FormatCodeResponse,
  type Metrics,
  type TutorialSummary,
  type ClassComparisonResponse,
  type ClassRankItem,
  type ClassUserRank,
  type UserRank,
  type ProblemRank,
  type CreateSubmissionResponse,
  type ProblemAuthor,
  type ProblemListItem,
  type YearlyAc,
  type ProblemList,
  type CreateFlowchartResponse,
  type FlowchartCurrent,
  type FlowchartDetail,
  type FlowchartList,
  type FlowchartSubmission,
  type AiDetail,
  type DurationData,
  type HeatmapItem,
  type LoginSummary,
  type SolvedList,
  type ProblemSet,
  type ProblemSetBadge,
  type ProblemSetList,
  type ProblemSetProblem,
  type ProblemSetProgressList,
  type UserBadge,
  problemDetailSchema,
  submissionDetailSchema,
  type FlowchartStatistics,
  type SubmissionStatistics,
} from "@oj2/contract"
import api from "utils/api"
import { filterResult } from "oj/transforms"
import type {
  Announcement,
  AnnouncementListItem,
  ContestRank,
  Profile,
  Message,
  SubmissionListItem,
  Exercise,
  Problem,
  ReactionKey,
  ReactionState,
  Submission,
  SubmissionListPayload,
  SubmitCodePayload,
  WebsiteConfig,
  Tutorial,
  TutorialProgress,
} from "utils/types"

/**
 * 题目详情。走契约的 zod 解析，形状即契约 —— 之前这里手抄了一份 camel→snake 的
 * 键名映射，抄漏一个字段就是静默 undefined。
 */
function detailProblem(value: unknown): Problem {
  return problemDetailSchema.parse(value) as Problem
}

export function getWebsiteConfig() {
  return api.get<WebsiteConfig>("site")
}

export async function getProblemList(
  offset = 0,
  limit = 10,
  searchParams: Record<string, unknown> = {},
) {
  const res = await api.get<ProblemList>("problems", {
    params: { paging: true, offset, limit, ...searchParams },
  })
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
  const response = await api.get<unknown>(
    `submissions/${encodeURIComponent(id)}`,
  )
  return submissionDetailSchema.parse(response) as Submission
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
  // 契约里 language 是 z.string()（语言是配置项，随时可能加，收紧成枚举会让
  // 新加的语言在后端 parse 时直接抛），前端在这一处收窄成 LANGUAGE
  return api.get<{ results: SubmissionListItem[]; total: number }>(endpoint, {
    // contestId 走的是路径，page 只有前端分页器用
    params: { ...params, contestId: undefined, page: undefined },
  })
}

export function getRankOfProblem(problemId: string) {
  return api.get<ProblemRank>(`problems/${encodeURIComponent(problemId)}/rank`)
}

export function getTodaySubmissionCount(language?: string) {
  return api.get<number>("submissions/today-count", { params: { language } })
}

export function adminRejudge(id: string) {
  return api.post<{ ok: boolean }>(
    `submissions/${encodeURIComponent(id)}/rejudge`,
  )
}

export function getSubmissionStatistics(
  duration: { start?: string; end: string },
  problemID?: string,
  username?: string,
) {
  return api.get<SubmissionStatistics>("submissions/statistics", {
    params: { ...duration, problemId: problemID, username },
  })
}

/**
 * 全服榜单。上限（100 名）由服务端定，调用方只管翻页 ——
 * 「全服 Top10」就是这个榜的第一页，取 limit=10 即可，不需要另一个上限参数。
 */
export function getRank(offset: number, limit: number) {
  return api.get<UserRank>("rankings/users", { params: { offset, limit } })
}

export function getActivityRank(start: string) {
  return api.get<ActivityRankItem[]>("rankings/activity", {
    params: { start },
  })
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

export function getContestList(query: {
  offset: number
  limit: number
  keyword: string
  status: string
  tag: string
}) {
  return api.get<ContestList>("contests", { params: query })
}

export function getContest(id: string) {
  return api.get<OjContest>(`contests/${encodeURIComponent(id)}`)
}

export function getContestAccess(id: string) {
  return api.get<ContestAccess>(`contests/${encodeURIComponent(id)}/access`)
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
  const res = await api.get<ProblemListItem[]>(
    `contests/${encodeURIComponent(contestID)}/problems`,
  )
  return res.map(filterResult)
}

export function getContestRank(
  contestID: string,
  query: { limit: number; offset: number },
) {
  // submissionInfo 在契约里是 Record<string, unknown>（JSONB 原文），
  // 前端在这里收窄成 SubmissionInfo，见 utils/types 的 ContestRank
  return api.get<{ results: ContestRank[]; total: number }>(
    `contests/${encodeURIComponent(contestID)}/rank`,
    { params: query },
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

export function getAnnouncementList(offset = 0, limit = 10) {
  return api.get<{ results: AnnouncementListItem[]; total: number }>("announcements", {
    params: { limit, offset },
  })
}

export function getAnnouncement(id: number) {
  return api.get<Announcement>(`announcements/${id}`)
}

export function getMessageList(offset = 0, limit = 10) {
  // language 的收窄同 getSubmissions，见那里的说明
  return api.get<{ results: Message[]; total: number }>("messages", {
    params: { limit, offset },
  })
}

export function getReaction(problemID: number) {
  return api.get<ReactionState>(`problems/${problemID}/reaction`)
}

export function setReaction(problemID: number, type: ReactionKey) {
  return api.post<ReactionState>(`problems/${problemID}/reaction`, { type })
}

export function getMetrics(userid: number) {
  return api.get<Metrics>(`users/${userid}/metrics`)
}

export function getTutorial(id: number) {
  return api.get<Tutorial>(`tutorials/${id}`)
}

export function getTutorials(type: "python" | "c") {
  return api.get<TutorialSummary[]>("tutorials", { params: { type } })
}

export function getAIDetailData(start: string, end: string, username?: string) {
  return api.get<AiDetail>("ai/detail", { params: { start, end, username } })
}

export function getAISolved(
  start: string,
  end: string,
  offset: number,
  limit: number,
  username?: string,
) {
  return api.get<SolvedList>("ai/solved", {
    params: { start, end, offset, limit, username },
  })
}

export function getAIDurationData(
  end: string,
  duration: string,
  username?: string,
) {
  return api.get<DurationData[]>("ai/duration", {
    params: { end, duration, username },
  })
}

export function getAIHeatmapData(username?: string) {
  return api.get<HeatmapItem[]>("ai/heatmap", {
    params: username ? { username } : {},
  })
}

export function getAILoginSummary() {
  return api.get<LoginSummary>("ai/login-summary")
}

export function getAIPinnedReport() {
  return api.get<AiAnalysisRecord | null>("ai/pinned")
}

// ==================== 相似题目推荐 ====================

export function getSimilarProblems(problemId: string) {
  return api
    .get<ProblemListItem[]>(`problems/${encodeURIComponent(problemId)}/similar`)
    .then((response) => response.map(filterResult))
}

export type { YearlyAc as YearlyACData } from "@oj2/contract"

export function getProblemYearlyAC(problemId: string) {
  return api.get<YearlyAc[]>(
    `problems/${encodeURIComponent(problemId)}/yearly-ac`,
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

export function getFlowchartSubmission(id: string) {
  return api.get<FlowchartSubmission>(`flowcharts/${encodeURIComponent(id)}`)
}

export function getFlowchartSubmissions(params: {
  username?: string
  problemId?: string
  myself?: string
  offset?: number
  limit?: number
  today?: string
  grade?: string
}) {
  return api.get<FlowchartList>("flowcharts", { params })
}

export function getFlowchartStatistics(
  duration: { start?: string; end: string },
  problemID?: string,
  username?: string,
) {
  return api.get<FlowchartStatistics>("flowcharts/statistics", {
    params: { ...duration, problemId: problemID, username },
  })
}

export function retryFlowchartSubmission(submissionId: string) {
  return api.post<{ status: string }>(
    `flowcharts/${encodeURIComponent(submissionId)}/retry`,
  )
}

export function getCurrentProblemFlowchartSubmission(problemId: number) {
  return api.get<FlowchartCurrent>(`problems/${problemId}/flowchart/current`)
}

export function getFlowchartSubmissionDetail(problemId: number, page = 0) {
  return api.get<FlowchartDetail>(`problems/${problemId}/flowchart/history`, {
    params: { page },
  })
}

// ==================== 题单相关API ====================

export function getProblemSetList(
  offset = 0,
  limit = 10,
  keyword = "",
  difficulty = "",
  status = "",
) {
  return api.get<ProblemSetList>("problem-sets", {
    params: { offset, limit, keyword, difficulty, status },
  })
}

export function getProblemSetDetail(id: number) {
  return api.get<ProblemSet>(`problem-sets/${id}`)
}

export function getProblemSetProblems(problemSetId: number) {
  return api.get<ProblemSetProblem[]>(`problem-sets/${problemSetId}/problems`)
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

export function getUserBadges(username?: string) {
  return api.get<UserBadge[]>(
    `users/${encodeURIComponent(username ?? "me")}/badges`,
  )
}

export function getProblemSetBadges(problemSetId: number) {
  return api.get<ProblemSetBadge[]>(`problem-sets/${problemSetId}/badges`)
}

export function getProblemSetUserProgress(
  problemSetId: number,
  params?: {
    limit?: number
    offset?: number
    className?: string
    completionStatus?: "" | "completed" | "in_progress" | "not_started"
  },
) {
  return api.get<ProblemSetProgressList>(
    `problem-sets/${problemSetId}/user-progress`,
    { params },
  )
}

export function getExercises(tutorialId: number): Promise<Exercise[]> {
  return api.get<Exercise[]>(`tutorials/${tutorialId}/exercises`)
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

export function getLearnProgress(type: "python" | "c") {
  return api.get<TutorialProgress[]>("learn/progress", { params: { type } })
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

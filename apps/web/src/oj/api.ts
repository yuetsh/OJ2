import {
  type AiAnalysisRecord,
  type Contest as OjContest,
  type ContestList,
  type ActivityRankItem,
  type ClassComparisonResponse,
  type ClassRankItem,
  type ClassUserRank,
  type ContestRank,
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
import api2 from "utils/api2"
import { filterResult } from "oj/transforms"
import type {
  Announcement,
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
} from "utils/types"

/**
 * 题目详情。走契约的 zod 解析，形状即契约 —— 之前这里手抄了一份 camel→snake 的
 * 键名映射，抄漏一个字段就是静默 undefined。
 */
function detailProblem(value: unknown): Problem {
  return problemDetailSchema.parse(value) as Problem
}

export function getWebsiteConfig() {
  return api2.get<WebsiteConfig>("site")
}

export async function getProblemList(
  offset = 0,
  limit = 10,
  searchParams: Record<string, unknown> = {},
) {
  const res = await api2.get<ProblemList>("problems", {
    params: { paging: true, offset, limit, ...searchParams },
  })
  return {
    results: res.data.results.map(filterResult),
    total: res.data.total,
  }
}

export function getAuthors(all = false) {
  return api2.get<ProblemAuthor[]>("problem-authors", {
    params: { all: all ? "1" : "0" },
  })
}

export function getRandomProblemID() {
  return api2.get("problems/random")
}

export async function getProblem(problemID: string, contestID: string) {
  const endpoint = contestID
    ? `contests/${encodeURIComponent(contestID)}/problems/${encodeURIComponent(problemID)}`
    : `problems/${encodeURIComponent(problemID)}`
  const response = await api2.get<unknown>(endpoint)
  return { error: null, data: detailProblem(response.data) }
}

export function getProblemBeatRate(problemID: number) {
  return api2.get(`problems/${problemID}/beat-count`)
}

export async function getSubmission(id: string) {
  const response = await api2.get<unknown>(
    `submissions/${encodeURIComponent(id)}`,
  )
  return {
    error: null,
    data: submissionDetailSchema.parse(response.data) as Submission,
  }
}

export function submitCode(data: SubmitCodePayload) {
  return api2.post<CreateSubmissionResponse>("submissions", data)
}

export function formatCode(data: { code: string; language: string }) {
  const languages: Record<string, string> = {
    Python3: "python",
    C: "c",
    "C++": "cpp",
    SQL: "sql",
  }
  return api2.post("code/format", {
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
  return api2.get<{ results: SubmissionListItem[]; total: number }>(endpoint, {
    // contestId 走的是路径，page 只有前端分页器用
    params: { ...params, contestId: undefined, page: undefined },
  })
}

export function getRankOfProblem(problemId: string) {
  return api2.get<ProblemRank>(`problems/${encodeURIComponent(problemId)}/rank`)
}

export function getTodaySubmissionCount(language?: string) {
  return api2.get<number>("submissions/today-count", { params: { language } })
}

export function adminRejudge(id: string) {
  return api2.post(`submissions/${encodeURIComponent(id)}/rejudge`)
}

export function getSubmissionStatistics(
  duration: { start?: string; end: string },
  problemID?: string,
  username?: string,
) {
  return api2.get<SubmissionStatistics>("submissions/statistics", {
    params: { ...duration, problemId: problemID, username },
  })
}

export function getRank(
  offset: number,
  limit: number,
  n: number,
  username?: string,
) {
  return api2.get<UserRank>("rankings/users", {
    params: { offset, limit, username, top: n },
  })
}

export function getActivityRank(start: string) {
  return api2.get<ActivityRankItem[]>("rankings/activity", {
    params: { start },
  })
}

export function getClassRank(grade?: number | null) {
  return api2.get<ClassRankItem[]>("rankings/classes", { params: { grade } })
}

export function getUserClassRank(
  scope?: "all" | "window",
  offset?: number,
  limit?: number,
) {
  return api2.get<ClassUserRank>("me/class-rank", {
    params: { scope, offset, limit },
  })
}

export function getClassPK(
  classNames: string[],
  startTime?: string,
  endTime?: string,
) {
  return api2.post<ClassComparisonResponse>("classes/comparison", {
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
  return api2.get<ContestList>("contests", { params: query })
}

export function getContest(id: string) {
  return api2.get<OjContest>(`contests/${encodeURIComponent(id)}`)
}

export function getContestAccess(id: string) {
  return api2.get(`contests/${encodeURIComponent(id)}/access`)
}

export function checkContestPassword(contestID: string, password: string) {
  return api2.post(`contests/${encodeURIComponent(contestID)}/access`, {
    password,
  })
}

export async function getContestProblems(contestID: string) {
  const res = await api2.get<ProblemListItem[]>(
    `contests/${encodeURIComponent(contestID)}/problems`,
  )
  return res.data.map(filterResult)
}

export function getContestRank(
  contestID: string,
  query: { limit: number; offset: number },
) {
  return api2.get<ContestRank>(
    `contests/${encodeURIComponent(contestID)}/rank`,
    { params: query },
  )
}

export function uploadAvatar(file: File) {
  const form = new window.FormData()
  form.append("image", file)
  return api2.post("me/avatar", form, {
    headers: { "content-type": "multipart/form-data" },
  })
}

export function updateProfile(data: { realName: string; mood: string }) {
  return api2.put<Profile>("me/profile", data)
}

export function getAnnouncementList(offset = 0, limit = 10) {
  return api2.get<{ results: Announcement[]; total: number }>("announcements", {
    params: { limit, offset },
  })
}

export function getAnnouncement(id: number) {
  return api2.get<Announcement>(`announcements/${id}`)
}

export function createMessage(data: {
  recipient: number
  message: string
  submission: string
}) {
  return api2.post("messages", {
    recipientId: data.recipient,
    message: data.message,
    submissionId: data.submission,
  })
}

export function getMessageList(offset = 0, limit = 10) {
  // language 的收窄同 getSubmissions，见那里的说明
  return api2.get<{ results: Message[]; total: number }>("messages", {
    params: { limit, offset },
  })
}

export function getReaction(problemID: number) {
  return api2.get<ReactionState>(`problems/${problemID}/reaction`)
}

export function setReaction(problemID: number, type: ReactionKey) {
  return api2.post<ReactionState>(`problems/${problemID}/reaction`, { type })
}

// TODO: 这个API有问题
export function refreshUserProblemDisplayIds() {
  return api2.post("me/problem-display-ids/refresh")
}

export function getMetrics(userid: number) {
  return api2.get(`users/${userid}/metrics`)
}

export function getTutorial(id: number) {
  return api2.get<Tutorial>(`tutorials/${id}`)
}

export function getTutorials(type: "python" | "c") {
  return api2.get("tutorials", { params: { type } })
}

export function getAIDetailData(start: string, end: string, username?: string) {
  return api2.get<AiDetail>("ai/detail", { params: { start, end, username } })
}

export function getAIDurationData(
  end: string,
  duration: string,
  username?: string,
) {
  return api2.get<DurationData[]>("ai/duration", {
    params: { end, duration, username },
  })
}

export function getAIHeatmapData(username?: string) {
  return api2.get<HeatmapItem[]>("ai/heatmap", {
    params: username ? { username } : {},
  })
}

export function getAILoginSummary() {
  return api2.get<LoginSummary>("ai/login-summary")
}

export function getAIPinnedReport() {
  return api2.get<AiAnalysisRecord | null>("ai/pinned")
}

// ==================== 相似题目推荐 ====================

export function getSimilarProblems(problemId: string) {
  return api2
    .get<ProblemListItem[]>(`problems/${encodeURIComponent(problemId)}/similar`)
    .then((response) => ({
      ...response,
      data: response.data.map(filterResult),
    }))
}

export type { YearlyAc as YearlyACData } from "@oj2/contract"

export function getProblemYearlyAC(problemId: string) {
  return api2.get<YearlyAc[]>(
    `problems/${encodeURIComponent(problemId)}/yearly-ac`,
  )
}

// ==================== 流程图相关API ====================

export function submitFlowchart(data: {
  problemId: number
  mermaidCode: string
  flowchartData: Record<string, unknown> // 压缩之后的，元数据太长了
}) {
  return api2.post<CreateFlowchartResponse>("flowcharts", data)
}

export function getFlowchartSubmission(id: string) {
  return api2.get<FlowchartSubmission>(`flowcharts/${encodeURIComponent(id)}`)
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
  return api2.get<FlowchartList>("flowcharts", { params })
}

export function getFlowchartStatistics(
  duration: { start?: string; end: string },
  problemID?: string,
  username?: string,
) {
  return api2.get<FlowchartStatistics>("flowcharts/statistics", {
    params: { ...duration, problemId: problemID, username },
  })
}

export function retryFlowchartSubmission(submissionId: string) {
  return api2.post<{ status: string }>(
    `flowcharts/${encodeURIComponent(submissionId)}/retry`,
  )
}

export function getCurrentProblemFlowchartSubmission(problemId: number) {
  return api2.get<FlowchartCurrent>(`problems/${problemId}/flowchart/current`)
}

export function getFlowchartSubmissionDetail(problemId: number, page = 0) {
  return api2.get<FlowchartDetail>(`problems/${problemId}/flowchart/history`, {
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
  return api2.get<ProblemSetList>("problem-sets", {
    params: { offset, limit, keyword, difficulty, status },
  })
}

export function getProblemSetDetail(id: number) {
  return api2.get<ProblemSet>(`problem-sets/${id}`)
}

export function getProblemSetProblems(problemSetId: number) {
  return api2.get<ProblemSetProblem[]>(`problem-sets/${problemSetId}/problems`)
}

export function joinProblemSet(problemSetId: number) {
  return api2.post("problem-set-progress", { problemSetId })
}

export function updateProblemSetProgress(
  problemSetId: number,
  problemId: number,
  submissionId: string,
) {
  return api2.put("problem-set-progress", {
    problemSetId,
    problemId,
    submissionId,
  })
}

export function getUserBadges(username?: string) {
  return api2.get<UserBadge[]>(
    `users/${encodeURIComponent(username ?? "me")}/badges`,
  )
}

export function getProblemSetBadges(problemSetId: number) {
  return api2.get<ProblemSetBadge[]>(`problem-sets/${problemSetId}/badges`)
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
  return api2.get<ProblemSetProgressList>(
    `problem-sets/${problemSetId}/user-progress`,
    { params },
  )
}

export async function getExercises(tutorialId: number): Promise<Exercise[]> {
  const res = await api2.get<Exercise[]>(`tutorials/${tutorialId}/exercises`)
  return res.data
}

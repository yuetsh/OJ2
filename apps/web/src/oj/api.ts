import {
  createSubmissionResponseSchema,
  problemDetailSchema,
  submissionDetailSchema,
  type FlowchartStatistics,
  type SubmissionStatistics,
} from "@oj2/contract"
import api2 from "utils/api2"
import { legacyResponse, toLegacy } from "utils/legacy"
import type { ApiResponse } from "utils/http"
import { filterResult } from "oj/transforms"
import type {
  Exercise,
  Problem,
  ReactionKey,
  ReactionState,
  Submission,
  SubmissionListPayload,
  SubmitCodePayload,
  WebsiteConfig,
} from "utils/types"

function listProblem(value: any): Problem {
  return {
    id: value.id,
    _id: value._id,
    title: value.title,
    difficulty: value.difficulty,
    submission_number: value.submissionNumber,
    accepted_number: value.acceptedNumber,
    created_by: toLegacy(value.createdBy),
    tags: value.tags,
    contest: value.contestId,
    allow_flowchart: value.allowFlowchart,
    show_flowchart: value.showFlowchart,
    has_ast_rules: value.hasAstRules,
    my_status: value.myStatus,
  } as Problem
}

function detailProblem(value: unknown): Problem {
  const problem = problemDetailSchema.parse(value)
  return {
    id: problem.id,
    _id: problem._id,
    title: problem.title,
    description: problem.description,
    input_description: problem.inputDescription,
    output_description: problem.outputDescription,
    samples: problem.samples,
    hint: problem.hint ?? "",
    languages: problem.languages,
    template: problem.template,
    create_time: problem.createTime,
    last_update_time: problem.lastUpdateTime,
    time_limit: problem.timeLimit,
    memory_limit: problem.memoryLimit,
    difficulty: problem.difficulty,
    source: problem.source ?? "",
    prompt: problem.prompt ?? "",
    answers: [],
    submission_number: problem.submissionNumber,
    accepted_number: problem.acceptedNumber,
    statistic_info: problem.statisticInfo,
    share_submission: problem.shareSubmission,
    contest: problem.contestId,
    tags: problem.tags,
    created_by: {
      id: problem.createdBy.id,
      username: problem.createdBy.username,
      real_name: problem.createdBy.realName,
    },
    my_status: problem.myStatus,
    my_failed_count: problem.myFailedCount,
    visible: true,
    allow_flowchart: problem.allowFlowchart,
    show_flowchart: problem.showFlowchart,
    mermaid_code: problem.mermaidCode ?? undefined,
    flowchart_data: problem.flowchartData ?? undefined,
    flowchart_hint: problem.flowchartHint ?? undefined,
    sql_config: problem.sqlConfig as Problem["sql_config"],
    sql_display: problem.sqlDisplay as Problem["sql_display"],
  } as Problem
}

export function getWebsiteConfig() {
  return legacyResponse<WebsiteConfig>(api2.get("site"))
}

export async function getProblemList(
  offset = 0,
  limit = 10,
  searchParams: any = {},
) {
  const res = await api2.get<{ results: any[]; total: number }>("problems", {
    params: { paging: true, offset, limit, ...searchParams },
  })
  return {
    results: res.data.results.map(listProblem).map(filterResult),
    total: res.data.total,
  }
}

export function getAuthors(all = false) {
  return legacyResponse(
    api2.get("problem-authors", {
      params: {
        all: all ? "1" : "0",
      },
    }),
  )
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
  const submission = submissionDetailSchema.parse(response.data)
  return {
    error: null,
    data: {
      id: submission.id,
      create_time: submission.createTime,
      user_id: submission.userId,
      username: submission.username,
      code: submission.code,
      result: submission.result,
      info: submission.info,
      language: submission.language,
      shared: submission.shared,
      show_link: submission.showLink,
      statistic_info: submission.statisticInfo,
      ip: submission.ip,
      contest: submission.contestId,
      problem: submission.problemId,
      can_unshare: submission.canUnshare,
    } as Submission,
  }
}

export async function submitCode(data: SubmitCodePayload) {
  const response = await api2.post<unknown>("submissions", {
    problemId: data.problem_id,
    language: data.language,
    code: data.code,
    contestId: data.contest_id,
  })
  const created = createSubmissionResponseSchema.parse(response.data)
  return {
    error: null,
    data: { submission_id: created.submissionId },
  }
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
  const endpoint = params.contest_id
    ? `contests/${encodeURIComponent(params.contest_id)}/submissions`
    : "submissions"
  return legacyResponse(
    api2.get(endpoint, {
      params: {
        ...params,
        problemId: params.problem_id,
        contest_id: undefined,
        problem_id: undefined,
        page: undefined,
      },
    }),
  )
}

export function getRankOfProblem(problem_id: string) {
  return legacyResponse(
    api2.get(`problems/${encodeURIComponent(problem_id)}/rank`),
  )
}

export function getTodaySubmissionCount(language?: string) {
  return api2.get("submissions/today-count", { params: { language } })
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
  return legacyResponse(
    api2.get("rankings/users", {
      params: { offset, limit, username, top: n },
    }),
  )
}

export function getActivityRank(start: string) {
  return api2.get("rankings/activity", {
    params: { start },
  })
}

export function getClassRank(grade?: number | null) {
  return legacyResponse(
    api2.get("rankings/classes", {
      params: { grade },
    }),
  )
}

export function getUserClassRank(
  scope?: "all" | "window",
  offset?: number,
  limit?: number,
) {
  return legacyResponse(
    api2.get("me/class-rank", { params: { scope, offset, limit } }),
  )
}

export function getClassPK(
  classNames: string[],
  startTime?: string,
  endTime?: string,
) {
  const payload: any = {
    classNames,
  }
  if (startTime) {
    payload.startTime = startTime
  }
  if (endTime) {
    payload.endTime = endTime
  }
  return legacyResponse(api2.post("classes/comparison", payload))
}

export function getContestList(query: {
  offset: number
  limit: number
  keyword: string
  status: string
  tag: string
}) {
  return legacyResponse(api2.get("contests", { params: query }))
}

export function getContest(id: string) {
  return legacyResponse(api2.get(`contests/${encodeURIComponent(id)}`))
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
  const res = await api2.get<any[]>(
    `contests/${encodeURIComponent(contestID)}/problems`,
  )
  return res.data.map(listProblem).map(filterResult)
}

export function getContestRank(
  contestID: string,
  query: { limit: number; offset: number },
) {
  return legacyResponse<any>(
    api2.get(`contests/${encodeURIComponent(contestID)}/rank`, {
      params: query,
    }),
  ).then((response) => ({
    ...response,
    data: {
      ...response.data,
      results: response.data.results.map((item: any) => ({
        ...item,
        contest: item.contest_id,
      })),
    },
  }))
}

export function uploadAvatar(file: File) {
  const form = new window.FormData()
  form.append("image", file)
  return api2.post("me/avatar", form, {
    headers: { "content-type": "multipart/form-data" },
  })
}

export function updateProfile(data: { real_name: string; mood: string }) {
  return legacyResponse(
    api2.put("me/profile", {
      realName: data.real_name,
      mood: data.mood,
    }),
  )
}

export function getAnnouncementList(offset = 0, limit = 10) {
  return legacyResponse(
    api2.get("announcements", { params: { limit, offset } }),
  )
}

export function getAnnouncement(id: number) {
  return legacyResponse(api2.get(`announcements/${id}`))
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
  return legacyResponse(api2.get("messages", { params: { limit, offset } }))
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
  return legacyResponse(api2.get(`tutorials/${id}`))
}

export function getTutorials(type: "python" | "c") {
  return api2.get("tutorials", { params: { type } })
}

export function getAIDetailData(start: string, end: string, username?: string) {
  return legacyResponse<any>(
    api2.get("ai/detail", { params: { start, end, username } }),
  ).then((response) => ({
    ...response,
    data: {
      ...response.data,
      flowcharts:
        response.data.flowcharts?.map((item: any) => ({
          ...item,
          problem__id: item.problem_id,
        })) ?? [],
    },
  }))
}

export function getAIDurationData(
  end: string,
  duration: string,
  username?: string,
) {
  return legacyResponse(
    api2.get("ai/duration", { params: { end, duration, username } }),
  )
}

export function getAIHeatmapData(username?: string) {
  return api2.get("ai/heatmap", { params: username ? { username } : {} })
}

export function getAILoginSummary() {
  return legacyResponse(api2.get("ai/login-summary"))
}

export function getAIPinnedReport() {
  return legacyResponse(api2.get("ai/pinned"))
}

// ==================== 相似题目推荐 ====================

export function getSimilarProblems(problemId: string) {
  return api2
    .get<any[]>(`problems/${encodeURIComponent(problemId)}/similar`)
    .then((response) => ({
      ...response,
      data: response.data.map(listProblem).map(filterResult),
    }))
}

export interface YearlyACData {
  year: number
  total: number
  accepted: number
  ac_rate: number
}

export function getProblemYearlyAC(problemId: string) {
  return legacyResponse<YearlyACData[]>(
    api2.get(`problems/${encodeURIComponent(problemId)}/yearly-ac`),
  )
}

// ==================== 流程图相关API ====================

export function submitFlowchart(data: {
  problem_id: number
  mermaid_code: string
  flowchart_data: any // 这个是压缩之后的，元数据太长了
}) {
  return legacyResponse(
    api2.post("flowcharts", {
      problemId: data.problem_id,
      mermaidCode: data.mermaid_code,
      flowchartData: data.flowchart_data,
    }),
  )
}

function legacyFlowchart(value: unknown) {
  const item = toLegacy<any>(value)
  return {
    ...item,
    user: item.user_id ?? 0,
    problem: item.problem_id,
  }
}

export async function getFlowchartSubmission(id: string) {
  const response = await api2.get(`flowcharts/${encodeURIComponent(id)}`)
  return { ...response, data: legacyFlowchart(response.data) }
}

export function getFlowchartSubmissions(params: {
  username?: string
  problem_id?: string
  myself?: string
  offset?: number
  limit?: number
  today?: string
  grade?: string
}) {
  return legacyResponse<any>(
    api2.get("flowcharts", {
      params: {
        ...params,
        problemId: params.problem_id,
        problem_id: undefined,
      },
    }),
  )
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
  return legacyResponse(
    api2.post(`flowcharts/${encodeURIComponent(submissionId)}/retry`),
  )
}

export function getCurrentProblemFlowchartSubmission(problemId: number) {
  return api2.get(`problems/${problemId}/flowchart/current`)
}

export async function getFlowchartSubmissionDetail(
  problemId: number,
  page = 0,
) {
  const response = await api2.get<any>(
    `problems/${problemId}/flowchart/history`,
    { params: { page } },
  )
  return {
    ...response,
    data: {
      ...response.data,
      submission: response.data.submission
        ? legacyFlowchart(response.data.submission)
        : null,
    },
  }
}

// ==================== 题单相关API ====================

export function getProblemSetList(
  offset = 0,
  limit = 10,
  keyword = "",
  difficulty = "",
  status = "",
) {
  return legacyResponse<any>(
    api2.get("problem-sets", {
      params: {
        offset,
        limit,
        keyword,
        difficulty,
        status,
      },
    }),
  ).then(mapProblemSetResponse)
}

export function getProblemSetDetail(id: number) {
  return legacyResponse<any>(api2.get(`problem-sets/${id}`)).then(
    (response) => ({
      ...response,
      data: legacyProblemSet(response.data),
    }),
  )
}

function legacyBadge(value: any) {
  return { ...value, problemset: value.problemset_id }
}

function legacyProblemSet(value: any) {
  return {
    ...value,
    badges: value.badges?.map(legacyBadge),
  }
}

function mapProblemSetResponse(response: ApiResponse<any>) {
  return {
    ...response,
    data: {
      ...response.data,
      results: response.data.results.map(legacyProblemSet),
    },
  }
}

export async function getProblemSetProblems(problemSetId: number) {
  const response = await legacyResponse<any[]>(
    api2.get(`problem-sets/${problemSetId}/problems`),
  )
  return {
    ...response,
    data: response.data.map((item) => ({
      ...item,
      problemset: item.problemset_id,
      problem: {
        ...item.problem,
        contest: item.problem.contest_id,
      },
    })),
  }
}

export function joinProblemSet(problemSetId: number) {
  return api2.post("problem-set-progress", { problemSetId })
}

export function updateProblemSetProgress(
  problemSetId: number,
  problemId: number,
  submissionId: string,
) {
  return legacyResponse(
    api2.put("problem-set-progress", {
      problemSetId,
      problemId,
      submissionId,
    }),
  )
}

// 获取用户徽章列表
export async function getUserBadges(username?: string) {
  const response = await legacyResponse<any[]>(
    api2.get(`users/${encodeURIComponent(username ?? "me")}/badges`),
  )
  return {
    ...response,
    data: response.data.map((item) => ({
      ...item,
      user: item.user_id,
      badge: legacyBadge(item.badge),
    })),
  }
}

// 获取题单徽章列表
export async function getProblemSetBadges(problemSetId: number) {
  const response = await legacyResponse<any[]>(
    api2.get(`problem-sets/${problemSetId}/badges`),
  )
  return { ...response, data: response.data.map(legacyBadge) }
}

// 获取题单用户进度列表
export function getProblemSetUserProgress(
  problemSetId: number,
  params?: {
    limit?: number
    offset?: number
    class_name?: string
    completion_status?: "" | "completed" | "in_progress" | "not_started"
  },
) {
  return legacyResponse(
    api2.get(`problem-sets/${problemSetId}/user-progress`, {
      params: {
        limit: params?.limit,
        offset: params?.offset,
        className: params?.class_name,
        completionStatus: params?.completion_status,
      },
    }),
  )
}

export async function getExercises(tutorialId: number): Promise<Exercise[]> {
  const res = await api2.get<Exercise[]>(`tutorials/${tutorialId}/exercises`)
  return res.data
}

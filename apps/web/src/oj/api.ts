import {
  type AiAnalysisRecord,
  type AiHintFeedbackRequest,
  type Contest,
  type ContestAccess,
  type ContestList,
  type ContestClassView,
  type ContestScoreboard,
  type FormatCodeResponse,
  type Metrics,
  type TutorialSummary,
  type ClassActivity,
  type LastVisit,
  type ClassBoard,
  type ClassLesson,
  type KnowledgeMap,
  type ClassComparisonResponse,
  type ClassBattleItem,
  type RankBoard,
  type RankPeriod,
  type RankScope,
  type WeeklyChampion,
  type WeeklyRank,
  type ProblemRank,
  type CreateSubmissionResponse,
  type ProblemAuthor,
  type ProblemListItem,
  type ProblemStats,
  type ProblemList,
  type ProblemProgress,
  type CreateFlowchartResponse,
  type FlowchartScores,
  type FlowchartList,
  type FlowchartSubmission,
  type AiDetail,
  type DurationData,
  type HeatmapItem,
  type SolvedList,
  type ProblemSet,
  type ProblemSetClassView,
  type ProblemSetList,
  type ProblemSetLock,
  type ProblemSetProblem,
  type UserBadge,
  type FlowchartStatistics,
  type SubmissionStatistics,
  type SubmissionLessons,
  type LessonLanguage,
  type SubmissionStatisticsGrid,
  type TodaySubmissionStatistics,
} from "@oj2/contract"
import api from "utils/api"
import { contract } from "utils/contract"
import { toProblemRow } from "oj/transforms"
import type {
  Announcement,
  AnnouncementListItem,
  Profile,
  Message,
  SubmissionListItem,
  Exercise,
  ProblemDetail,
  ReactionKey,
  ReactionState,
  Submission,
  SubmissionListPayload,
  SubmitCodePayload,
  Tutorial,
  TutorialProgress,
} from "utils/types"

/**
 * 题目详情 / 提交详情的 schema 按需加载，和请求并行发出。静态 import 会把 zod
 * 运行时带进首页 —— 题目列表的 getProblemList 也在这个文件里。
 * 闸门本身仍是同步的（等 schema 到了再返回），submissionDetailSchema 有 `.catch()`，
 * 放行原文和解析结果不等价，所以不能像 /me 那样改成 contractDeferred。
 */
const loadDetailSchemas = () => import("./detailSchemas")

export async function getProblemList(
  offset = 0,
  limit = 10,
  searchParams: Record<string, unknown> = {},
) {
  const res = await api.get<ProblemList>("problems", {
    params: { paging: true, offset, limit, ...searchParams },
  })
  return {
    results: res.results.map(toProblemRow),
    total: res.total,
  }
}

/** 题目列表顶上那行和左栏的进度；没登录是 null */
export function getProblemProgress() {
  return api.get<ProblemProgress | null>("problems/progress")
}

/**
 * 「随便来一道」：当前知识点和类型里，先挑能用 language 做的、自己没做对的简单 / 中等题，
 * 返回题号。空串的参数拦截器会去掉
 */
export function getRandomProblem(params: { tag: string; type: string; language: string }) {
  return api.get<string>("problems/random", { params })
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
  const [{ problemDetailSchema }, response] = await Promise.all([
    loadDetailSchemas(),
    api.get<unknown>(endpoint),
  ])
  // 形状即契约 —— 之前这里手抄了一份 camel→snake 的键名映射，抄漏一个字段就是
  // 静默 undefined。走 `contract()` 而不是裸 `parse()`：原来是
  // `problemDetailSchema.parse(v) as ProblemDetail`，`as` 把校验结果又断言回去、
  // 等于没校验，而 `parse` 抛错会让整个题目页白屏。现在形状不符时记一条控制台
  // 分歧再放行原始数据。
  const problem: ProblemDetail = contract("GET /problems/:id", problemDetailSchema, response)
  return problem
}

/** 题目页「统计」页签。problemID 是内部题号（problem.id），比赛题也能查 */
export function getProblemStats(problemID: number) {
  return api.get<ProblemStats>(`problems/${problemID}/stats`)
}

export async function getSubmission(id: string): Promise<Submission> {
  const [{ submissionDetailSchema }, response] = await Promise.all([
    loadDetailSchemas(),
    api.get<unknown>(`submissions/${encodeURIComponent(id)}`),
  ])
  return contract("GET /submissions/:id", submissionDetailSchema, response)
}

export function submitCode(data: SubmitCodePayload) {
  return api.post<CreateSubmissionResponse>("submissions", data)
}

export function formatCode(data: { code: string; language: string; problemId: number }) {
  const languages: Record<string, string> = {
    Python: "python",
    C: "c",
    "C++": "cpp",
    SQL: "sql",
  }
  return api.post<FormatCodeResponse>("code/format", {
    code: data.code,
    language: languages[data.language] ?? data.language.toLowerCase(),
    problemId: data.problemId,
  })
}

export function getSubmissions(params: Partial<SubmissionListPayload>) {
  const endpoint = params.contestId
    ? `contests/${encodeURIComponent(params.contestId)}/submissions`
    : "submissions"
  // 契约里 language 是 z.string()（语言是配置项，随时可能加，收紧成枚举会让
  // 新加的语言在后端 parse 时直接抛），前端在这一处收窄成 LANGUAGE
  return api.get<{ results: SubmissionListItem[]; total: number; unknownProblems: string[] }>(
    endpoint,
    {
      // contestId 走的是路径，page 只有前端分页器用
      params: { ...params, contestId: undefined, page: undefined },
    },
  )
}

export function getRankOfProblem(problemId: string) {
  return api.get<ProblemRank>(`problems/${encodeURIComponent(problemId)}/rank`)
}

export function getTodaySubmissionCount(language?: string) {
  return api.get<number>("submissions/today-count", { params: { language } })
}

/** 「今日提交数」标签点开的统计。公开接口，口径同那颗标签：今天 + 非比赛提交 */
export function getTodaySubmissionStatistics() {
  return api.get<TodaySubmissionStatistics>("submissions/today-statistics")
}

export function adminRejudge(id: string) {
  return api.post<{ ok: boolean }>(`submissions/${encodeURIComponent(id)}/rejudge`)
}

export function getSubmissionStatistics(
  duration: { start?: string; end: string },
  problemDisplayId?: string,
  username?: string,
  /** 班级（user.class_name）精确匹配。别再拼 `ks231` 塞进 username —— 会连带 2311、2312 班 */
  className?: string,
) {
  return api.get<SubmissionStatistics>("submissions/statistics", {
    params: { ...duration, problemDisplayId, username, className },
  })
}

/** 统计「一行一节课」的总览（没选班、没填学生和题号时）。limit 是列几节课，「再往前看」加它 */
export function getSubmissionLessons(duration: { start?: string; end: string }, limit?: number) {
  return api.get<SubmissionLessons>("submissions/statistics/lessons", {
    params: { ...duration, limit },
  })
}

/** 统计页的方块串：范围内每个学生的每一次提交（口径见契约 submissionStatisticsGridSchema） */
export function getSubmissionStatisticsGrid(
  duration: { start?: string; end: string },
  problemDisplayId?: string,
  username?: string,
  className?: string,
) {
  return api.get<SubmissionStatisticsGrid>("submissions/statistics/grid", {
    params: { ...duration, problemDisplayId, username, className },
  })
}

/**
 * 排名页的榜：本班 / 本年级 / 全服 × 这周 / 这学期 / 全部。学生看自己的班和年级，
 * 老师用 `className` 选班（不给就是最近上课的班）。`full` 把本年级 / 全服中间折起来的那段也要回来
 */
export function getRankBoard(
  scope: RankScope,
  period: RankPeriod,
  options: { className?: string; full?: boolean } = {},
) {
  return api.get<RankBoard>("rankings/board", {
    params: {
      scope,
      period,
      className: options.className || undefined,
      full: options.full ? 1 : undefined,
    },
  })
}

/** 班级对抗：全服各班这学期人均做对，外加这周人均涨了多少 */
export function getClassBattle() {
  return api.get<ClassBattleItem[]>("rankings/classes")
}

/** 本班最近几周的每周冠军 */
export function getWeeklyChampions(className?: string) {
  return api.get<WeeklyChampion[]>("rankings/champions", {
    params: { className: className || undefined },
  })
}

/** 老师把学生设成不计入排名 / 恢复 */
export function setRankHidden(userId: number, hidden: boolean) {
  return api.put<null>(`rankings/hidden/${userId}`, { hidden })
}

/**
 * 本周进步榜。`scope` 只有两个取值，服务端认不出的一律当 global ——
 * 班级榜要求调用者有班级，教师/超管拿到的是 400，所以别在没班级时切过去。
 */
export function getWeeklyRank(scope: "global" | "class") {
  return api.get<WeeklyRank>("rankings/weekly", { params: { scope } })
}

/** 课堂看板（老师）。不给班级时后端猜最近两小时在交题的那个班 */
export function getClassBoard(className?: string) {
  return api.get<ClassBoard>("classroom/board", { params: { className } })
}

/** 这个班「这节课」的题（提交列表那颗按钮用）。不传班级就猜正在上课的班，和看板一样 */
export function getClassLesson(className?: string) {
  return api.get<ClassLesson>("classroom/lesson", { params: { className } })
}

/** 给这个班布置今天的题，空数组 = 清掉 */
export function setClassLesson(
  className: string,
  problemDisplayIds: string[],
  language: LessonLanguage | null,
) {
  return api.put<null>("classroom/lesson", { className, problemDisplayIds, language })
}

/** 我的知识点地图（只有自己的，不能查别人） */
export function getKnowledgeMap() {
  return api.get<KnowledgeMap>("me/knowledge")
}

export function getClassActivity() {
  return api.get<ClassActivity>("me/class-activity")
}

/** 首页「上次来」卡：上次登录到这次登录之间交过什么、哪道还没做对 */
export function getLastVisit() {
  return api.get<LastVisit>("me/last-visit")
}

export function getClassPK(classNames: string[], startTime?: string, endTime?: string) {
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
  /** 练习 / 期中 / 期末，或「考试」= 期中和期末 */
  tag: string
  /** 只看我交过题的 */
  joined?: boolean
}) {
  return api.get<ContestList>("contests", {
    params: { ...query, joined: query.joined ? "1" : undefined },
  })
}

export function getContest(id: string) {
  return api.get<Contest>(`contests/${encodeURIComponent(id)}`)
}

export function getContestAccess(id: string) {
  return api.get<ContestAccess>(`contests/${encodeURIComponent(id)}/access`)
}

// 注意和 GET /access 不一样：这个返回裸 true，密码错是 403 走 catch
export function checkContestPassword(contestID: string, password: string) {
  return api.post<boolean>(`contests/${encodeURIComponent(contestID)}/access`, {
    password,
  })
}

export async function getContestProblems(contestID: string) {
  const res = await api.get<ProblemListItem[]>(`contests/${encodeURIComponent(contestID)}/problems`)
  return res.map(toProblemRow)
}

export function getContestScoreboard(contestID: string) {
  return api.get<ContestScoreboard>(`contests/${encodeURIComponent(contestID)}/scoreboard`)
}

export function getContestClassView(contestID: string) {
  return api.get<ContestClassView>(`contests/${encodeURIComponent(contestID)}/class-view`)
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

export function getAIDurationData(end: string, duration: string, username?: string) {
  return api.get<DurationData[]>("ai/duration", {
    params: { end, duration, username },
  })
}

export function getAIHeatmapData(username?: string) {
  return api.get<HeatmapItem[]>("ai/heatmap", {
    params: username ? { username } : {},
  })
}

export function getAIPinnedReport() {
  return api.get<AiAnalysisRecord | null>("ai/pinned")
}

/** 学生评价一条 AI 提示。id 来自 /ai/hint 流的 done 事件，可以改票 */
export function submitHintFeedback(hintId: number, helpful: boolean) {
  return api.post<null>(`ai/hint/${hintId}/feedback`, {
    helpful,
  } satisfies AiHintFeedbackRequest)
}

// ==================== 相似题目推荐 ====================

export function getSimilarProblems(problemId: string) {
  return api
    .get<ProblemListItem[]>(`problems/${encodeURIComponent(problemId)}/similar`)
    .then((response) => response.map(toProblemRow))
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
  /** "1" = username 整名匹配，同代码提交列表 */
  exactUsername?: "1"
  className?: string
  problemDisplayId?: string
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
  problemDisplayId?: string,
  username?: string,
  className?: string,
) {
  return api.get<FlowchartStatistics>("flowcharts/statistics", {
    params: { ...duration, problemDisplayId, username, className },
  })
}

export function retryFlowchartSubmission(submissionId: string) {
  return api.post<{ status: string }>(`flowcharts/${encodeURIComponent(submissionId)}/retry`)
}

/** 自己在这道题上评完的每一次（早的在前），题单布置期内藏着的已经滤掉 */
export function getFlowchartScores(problemId: number) {
  return api.get<FlowchartScores>(`problems/${problemId}/flowchart/scores`)
}

// ==================== 题单相关API ====================

export function getProblemSetList(offset = 0, limit = 10, keyword = "") {
  return api.get<ProblemSetList>("problem-sets", { params: { offset, limit, keyword } })
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

export function getUserBadges(username?: string) {
  return api.get<UserBadge[]>(`users/${encodeURIComponent(username ?? "me")}/badges`)
}

/** 老师看某个班在题单里的情况；不传班级就看服务端推断的那个班 */
export function getProblemSetClassView(problemSetId: number, className = "") {
  return api.get<ProblemSetClassView>(`problem-sets/${problemSetId}/class-view`, {
    params: className ? { className } : {},
  })
}

/** 这道题以前的代码为什么藏着：落在哪些正在布置的题单里。传主键或题号都行 */
export function getProblemSetLocks(problem: { id: number } | { displayId: string }) {
  return api.get<ProblemSetLock[]>("problem-sets/locks", {
    params: "id" in problem ? { problemId: problem.id } : { problemDisplayId: problem.displayId },
  })
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

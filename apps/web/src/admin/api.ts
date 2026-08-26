import api from "utils/api"
import { toProblemListItem } from "admin/transforms"
import type {
  AcTrend,
  AdminProblemSetProgress,
  BatchProblemTagResponse,
  GenerateSqlTestCaseResponse,
  RenameTagResponse,
  SqlTestCaseScript,
  AcmHelperItem,
  SubmissionInfo,
  AdminAiReport,
  AdminAiReportList,
  StuckProblem,
  AdminContestList,
  AdminUser,
  AdminUserList,
  DashboardInfo,
  JudgeServerList,
  OrphanTestCase,
  AdminProblem,
  AdminProblemList,
  AdminTag,
  AdminAnnouncement,
  AnnouncementEdit,
  AdminAnnouncementListItem,
  BlankContest,
  BlankProblem,
  Contest,
  Exercise,
  ExerciseType,
  SqlDisplay,
  UploadTestCaseResponse,
  Tutorial,
  User,
  WebsiteConfig,
  ProblemSet,
  ProblemSetBadge,
  ProblemSetList,
  ProblemSetProblem,
  TutorialListItem,
} from "utils/types"

export function getBaseInfo() {
  return api.get<DashboardInfo>("admin/dashboard")
}

export function randomUser10(classroom: string) {
  return api.get<string[]>("admin/random-usernames", {
    params: { classroom },
  })
}

export async function getProblemList(
  offset = 0,
  limit = 10,
  keyword: string,
  author?: string,
  contestID?: string,
  tagId?: number,
) {
  const endpoint = contestID
    ? `admin/contests/${contestID}/problems`
    : "admin/problems"
  const res = await api.get<AdminProblemList>(endpoint, {
    params: { offset, limit, keyword, author, tagId },
  })
  return {
    results: res.results.map(toProblemListItem),
    total: res.total,
  }
}

export function deleteProblem(id: number) {
  return api.delete(`admin/problems/${id}`)
}

// 比赛题与公开题共用一条删除路由，比赛由后端从题目推导
export function deleteContestProblem(id: number) {
  return api.delete(`admin/problems/${id}`)
}

export function editProblem(problem: AdminProblem | BlankProblem) {
  return api.put<AdminProblem>(
    `admin/problems/${(problem as AdminProblem).id}`,
    toProblemBody(problem),
  )
}

export function toggleProblemVisible(problemID: number) {
  return api.put<{ visible: boolean }>(
    `admin/problems/${problemID}/visibility`,
  )
}

export function generateFlowchartFromPythonCode(python: string) {
  return api.post<{ flowchart: string }>("admin/problems/flowchart", {
    python,
  })
}

export function editContestProblem(problem: AdminProblem | BlankProblem) {
  return api.put<AdminProblem>(
    `admin/problems/${(problem as AdminProblem).id}`,
    toProblemBody(problem),
  )
}

export function getProblem(id: string | number) {
  return api.get<AdminProblem>(`admin/problems/${id}`)
}

// 标签管理
export function getTagAdminList(keyword = "") {
  return api.get<AdminTag[]>("admin/problem-tags", { params: { keyword } })
}

export function renameTag(id: number, name: string) {
  return api.put<RenameTagResponse>(`admin/problem-tags/${id}`, { name })
}

export function deleteTag(id: number) {
  return api.delete(`admin/problem-tags/${id}`)
}

export function batchTagProblems(
  problemIds: number[],
  tagNames: string[],
  action: "add" | "remove",
) {
  return api.post<BatchProblemTagResponse>("admin/problems/batch-tag", {
    problemIds,
    tagNames,
    action,
  })
}

// 用户排名（后台版，无 100 名上限；公开榜单是 oj/api.ts 的 getRank）
export function getAdminUserRank(offset: number, limit: number, keyword: string) {
  return api.get<AdminUserRank>("admin/rankings/users", {
    params: { offset, limit, keyword },
  })
}

// 用户列表
export function getUserList(
  offset = 0,
  limit = 10,
  type = "",
  keyword: string,
  orderBy = "",
) {
  return api.get<AdminUserList>("admin/users", {
    // 旧接口的 order_by 只有 "-last_login" 一个取值
    params: {
      offset,
      limit,
      keyword,
      type,
      orderBy: orderBy === "-last_login" ? "-lastLogin" : orderBy,
    },
  })
}

// 编辑用户
export function editUser(user: User) {
  return api.put<AdminUser>(`admin/users/${user.id}`, {
    username: user.username,
    email: user.email,
    adminType: user.adminType,
    problemPermission: user.problemPermission,
    realName: user.realName ?? null,
    isDisabled: user.isDisabled,
    openApi: user.openApi,
    password: user.password ?? "",
  })
}

// 重置用户密码，返回新密码
export async function resetPassword(userID: number) {
  const res = await api.post<{ password: string }>(
    `admin/users/${userID}/reset-password`,
  )
  return res.password
}

// 导入用户
export function importUsers(users: string[][]) {
  return api.post("admin/users", { users })
}

// 批量删除用户
export function deleteUsers(userIDs: number[]) {
  return api.delete("admin/users", { data: { ids: userIDs } })
}

export function getContestList(offset = 0, limit = 10, keyword: string) {
  return api.get<AdminContestList>("admin/contests", {
    params: { offset, limit, keyword },
  })
}

// 上传图片
export async function uploadImage(file: File): Promise<string> {
  const form = new window.FormData()
  form.append("image", file)
  const res = await api.post<{
    success: boolean
    filePath: string
    msg: string
  }>("admin/upload-image", form, {
    headers: { "content-type": "multipart/form-data" },
  })
  return res.success ? res.filePath : ""
}

// 上传测试用例；SQL 题的压缩包是 1.sql..N.sql（每个文件一个测试点的建表+数据脚本）
export function uploadTestcases(file: File, options: { sql?: boolean } = {}) {
  const form = new window.FormData()
  form.append("file", file)
  if (options.sql) {
    form.append("sql", "1")
  }
  return api.post<UploadTestCaseResponse>("admin/test-cases", form, {
    headers: { "content-type": "multipart/form-data" },
  })
}

// SQL 题测试点预览：后端跑一遍初始化脚本+标准答案，返回数据表和期望结果展示数据
export function previewSQLTestcase(data: {
  initSql: string
  refSql: string
  mode: "query" | "modify"
}) {
  return api.post<SqlDisplay>("admin/sql-test-cases/preview", data)
}

// 回显已上传的 SQL 测试点脚本内容（按 1.sql, 2.sql... 排序）
export function getSQLTestcaseScripts(problemId: number) {
  return api.get<SqlTestCaseScript[]>(
    `admin/problems/${problemId}/sql-scripts`,
  )
}

// AI 根据标准答案生成一个 SQL 测试点初始化脚本
export function generateSQLTestcase(data: {
  refSql: string
  mode: "query" | "modify"
}) {
  return api.post<GenerateSqlTestCaseResponse>(
    "admin/sql-test-cases/generate",
    data,
  )
}

/** 出站补默认值。字段名两边已经一致，不再做键名转换 */
function toProblemBody(problem: AdminProblem | BlankProblem) {
  const p = problem as Partial<AdminProblem>
  return {
    _id: p._id,
    title: p.title,
    description: p.description,
    inputDescription: p.inputDescription ?? "",
    outputDescription: p.outputDescription ?? "",
    samples: p.samples ?? [],
    testCaseId: p.testCaseId,
    testCaseScore: p.testCaseScore ?? [],
    timeLimit: p.timeLimit,
    memoryLimit: p.memoryLimit,
    languages: p.languages ?? [],
    template: p.template ?? {},
    visible: p.visible,
    difficulty: p.difficulty,
    tags: p.tags ?? [],
    hint: p.hint ?? null,
    source: p.source ?? null,
    prompt: p.prompt ?? null,
    answers: p.answers ?? [],
    shareSubmission: p.shareSubmission ?? false,
    allowFlowchart: p.allowFlowchart ?? false,
    showFlowchart: p.showFlowchart ?? false,
    mermaidCode: p.mermaidCode ?? null,
    flowchartHint: p.flowchartHint ?? null,
    astRules: p.astRules ?? null,
    sqlConfig: p.sqlConfig ?? null,
  }
}

export function createProblem(problem: BlankProblem) {
  return api.post<AdminProblem>("admin/problems", toProblemBody(problem))
}

export function createContestProblem(problem: BlankProblem) {
  // contestId 由 detail.vue 在提交前写进 problem 对象
  return api.post<AdminProblem>(
    `admin/contests/${problem.contestId}/problems`,
    toProblemBody(problem),
  )
}

/** 组件里的比赛对象是 snake_case，出站转成新后端要的 camelCase */
function toContestBody(contest: Contest | BlankContest) {
  return {
    title: contest.title,
    description: contest.description,
    tag: contest.tag,
    startTime: contest.startTime,
    endTime: contest.endTime,
    password: contest.password || null,
    visible: contest.visible,
    allowedIpRanges: contest.allowedIpRanges ?? [],
  }
}

export function createContest(contest: BlankContest) {
  return api.post<Contest>("admin/contests", toContestBody(contest))
}

export function editContest(contest: Contest | BlankContest) {
  return api.put<Contest>(
    `admin/contests/${(contest as Contest).id}`,
    toContestBody(contest),
  )
}

export function cloneContest(contestId: number) {
  return api.post<Contest>(`admin/contests/${contestId}/clone`)
}

export function getContest(id: string) {
  return api.get<Contest>(`admin/contests/${id}`)
}

export function addProblemForContest(
  contestID: string,
  problemID: number,
  displayID: string,
) {
  return api.post<AdminProblem>(
    `admin/contests/${contestID}/problems/from-public`,
    { problemId: problemID, displayId: displayID },
  )
}

export function getWebsite() {
  return api.get<WebsiteConfig>("admin/website")
}

export function editWebsite(data: WebsiteConfig) {
  return api.post<WebsiteConfig>("admin/website", data)
}

export function listInvalidTestcases() {
  return api.get<OrphanTestCase[]>("admin/orphan-test-cases")
}

export function pruneInvalidTestcases(id?: string) {
  return api.delete("admin/orphan-test-cases", { params: { id } })
}

export function getJudgeServer() {
  return api.get<JudgeServerList>("admin/judge-servers")
}

export function deleteJudgeServer(hostname: string) {
  return api.delete(`admin/judge-servers/${encodeURIComponent(hostname)}`)
}

export function getAnnouncementList(offset = 0, limit = 10) {
  return api.get<{ results: AdminAnnouncementListItem[]; total: number }>(
    "admin/announcements",
    { params: { offset, limit } },
  )
}

export function getAnnouncement(id: number) {
  return api.get<AdminAnnouncement>(`admin/announcements/${id}`)
}

export function deleteAnnouncement(id: number) {
  return api.delete(`admin/announcements/${id}`)
}

export function editAnnouncement(announcement: AnnouncementEdit) {
  const { id, ...body } = announcement
  return api.put<AdminAnnouncement>(`admin/announcements/${id}`, body)
}

export function createAnnouncement(announcement: AnnouncementEdit) {
  const { id: _id, ...body } = announcement
  return api.post<AdminAnnouncement>("admin/announcements", body)
}

export function getTutorialList() {
  return api.get<{ [key: string]: TutorialListItem[] }>("admin/tutorials")
}

export function getTutorial(id: number) {
  return api.get<Tutorial>(`admin/tutorials/${id}`)
}

function toTutorialBody(data: Partial<Tutorial>) {
  return {
    title: data.title,
    content: data.content,
    code: data.code ?? null,
    isPublic: data.isPublic ?? false,
    order: data.order ?? 0,
    type: data.type,
  }
}

export function createTutorial(data: Partial<Tutorial>) {
  return api.post<Tutorial>("admin/tutorials", toTutorialBody(data))
}

export function updateTutorial(data: Partial<Tutorial>) {
  return api.put<Tutorial>(
    `admin/tutorials/${data.id}`,
    toTutorialBody(data),
  )
}

export function deleteTutorial(id: number) {
  return api.delete(`admin/tutorials/${id}`)
}

export function setTutorialVisibility(id: number, isPublic: boolean) {
  return api.put<Tutorial>(`admin/tutorials/${id}/visibility`, { isPublic })
}

export function getAdminExercises(tutorialId: number) {
  return api.get<Exercise[]>(`admin/tutorials/${tutorialId}/exercises`)
}

export async function createExercise(data: {
  tutorialId: number
  type: ExerciseType
  data: object
  order: number
}) {
  return api.post<Exercise>("admin/exercises", data)
}

export async function updateExercise(data: {
  id: number
  type: ExerciseType
  data: object
  order: number
}) {
  return api.put<Exercise>(`admin/exercises/${data.id}`, {
    type: data.type,
    data: data.data,
    order: data.order,
  })
}

export function deleteExercise(id: number) {
  return api.delete(`admin/exercises/${id}`)
}

// 将竞赛题目转为公开题目
export function makeProblemPublic(id: number, displayId: string) {
  return api.post<AdminProblem>(`admin/problems/${id}/make-public`, {
    displayId,
  })
}

// 比赛辅助检查
export function getACMHelperList(contestId: number) {
  // acInfo 在契约里是 Record<string, unknown>（acm_contest_rank 的 JSONB 原文），
  // 组件侧按 SubmissionInfo 读，收窄放在这里
  return api.get<
    Array<Omit<AcmHelperItem, "acInfo"> & { acInfo: SubmissionInfo }>
  >(`admin/contests/${contestId}/acm-helper`)
}

export function updateACMHelperChecked(
  contest_id: number,
  rank_id: number,
  problem_id: string,
  checked: boolean,
) {
  return api.put(`admin/contests/${contest_id}/acm-helper`, {
    rankId: rank_id,
    problemId: problem_id,
    checked,
  })
}

// 题单管理 API
export function getProblemSetList(
  offset = 0,
  limit = 10,
  keyword = "",
  difficulty = "",
  status = "",
) {
  return api.get<ProblemSetList>("admin/problem-sets", {
    params: { offset, limit, keyword, difficulty, status },
  })
}

export function getProblemSetDetail(id: number) {
  return api.get<ProblemSet>(`admin/problem-sets/${id}`)
}

interface ProblemSetBody {
  title?: string
  description?: string
  difficulty?: ProblemSet["difficulty"]
  status?: ProblemSet["status"]
  // 表单里是 Date，出站要 ISO 串
  endTime?: Date | null
  visible?: boolean
}

function toProblemSetBody(data: ProblemSetBody) {
  return {
    title: data.title,
    description: data.description ?? "",
    difficulty: data.difficulty ?? "Easy",
    status: data.status ?? "active",
    endTime: data.endTime ? new Date(data.endTime).toISOString() : null,
    visible: data.visible ?? true,
  }
}

export function createProblemSet(data: ProblemSetBody) {
  return api.post<ProblemSet>("admin/problem-sets", toProblemSetBody(data))
}

export function editProblemSet(data: ProblemSetBody & { id: number }) {
  return api.put<ProblemSet>(
    `admin/problem-sets/${data.id}`,
    toProblemSetBody(data),
  )
}

export function deleteProblemSet(id: number) {
  return api.delete(`admin/problem-sets/${id}`)
}

export function toggleProblemSetVisible(id: number) {
  return api.put<ProblemSet>(`admin/problem-sets/${id}/visibility`)
}

export function updateProblemSetStatus(id: number, status: string) {
  return api.put<ProblemSet>(`admin/problem-sets/${id}/status`, { status })
}

// 题单题目管理 API
export function getProblemSetProblems(problemSetId: number) {
  return api.get<ProblemSetProblem[]>(
    `admin/problem-sets/${problemSetId}/problems`,
  )
}

export function addProblemToSet(
  problemSetId: number,
  data: {
    problemId: string
    order?: number
    isRequired?: boolean
    score?: number
    hint?: string
  },
) {
  return api.post(`admin/problem-sets/${problemSetId}/problems`, {
    problemId: data.problemId,
    order: data.order ?? 0,
    isRequired: data.isRequired ?? true,
    score: data.score ?? 0,
    hint: data.hint ?? "",
  })
}

export function editProblemInSet(
  problemSetId: number,
  problemSetProblemId: number,
  data: {
    order?: number
    isRequired?: boolean
    score?: number
    hint?: string
  },
) {
  return api.put(
    `admin/problem-sets/${problemSetId}/problems/${problemSetProblemId}`,
    data,
  )
}

export function removeProblemFromSet(
  problemSetId: number,
  problemSetProblemId: number,
) {
  return api.delete(
    `admin/problem-sets/${problemSetId}/problems/${problemSetProblemId}`,
  )
}

// 题单奖章管理 API
export function getProblemSetBadges(problemSetId: number) {
  return api.get<ProblemSetBadge[]>(
    `admin/problem-sets/${problemSetId}/badges`,
  )
}

interface BadgeBody {
  name?: string
  description?: string
  icon?: string
  conditionType?: ProblemSetBadge["conditionType"]
  conditionValue?: number
}

function toBadgeBody(data: BadgeBody) {
  return {
    name: data.name,
    description: data.description ?? "",
    icon: data.icon ?? "",
    conditionType: data.conditionType,
    conditionValue: data.conditionValue ?? 0,
  }
}

export function createProblemSetBadge(problemSetId: number, data: BadgeBody) {
  return api.post<ProblemSetBadge>(
    `admin/problem-sets/${problemSetId}/badges`,
    toBadgeBody(data),
  )
}

export function editProblemSetBadge(
  problemSetId: number,
  badgeId: number,
  data: BadgeBody,
) {
  return api.put<ProblemSetBadge>(
    `admin/problem-sets/${problemSetId}/badges/${badgeId}`,
    toBadgeBody(data),
  )
}

export function deleteProblemSetBadge(problemSetId: number, badgeId: number) {
  return api.delete(`admin/problem-sets/${problemSetId}/badges/${badgeId}`)
}

// 题单进度管理 API
// 注意：返回的是裸数组，不是分页信封 —— 和 oj 侧的 /user-progress 不同
export function getProblemSetProgress(problemSetId: number) {
  return api.get<AdminProblemSetProgress[]>(
    `admin/problem-sets/${problemSetId}/progress`,
  )
}

export function removeUserFromProblemSet(problemSetId: number, userId: number) {
  return api.delete(`admin/problem-sets/${problemSetId}/progress/${userId}`)
}

// 学生卡点分析
export function getStuckProblems() {
  return api.get<StuckProblem[]>("admin/problem-analytics/stuck")
}

export function getTopACTrend(params: {
  sinceYear: number
  untilYear: number
  minPerYear: number
}) {
  return api.get<AcTrend[]>("admin/problem-analytics/ac-trend", { params })
}

// AI 学习分析报告
export function getAIReportList(offset = 0, limit = 10, username = "") {
  return api.get<AdminAiReportList>("admin/ai/reports", {
    params: { offset, limit, username: username || undefined },
  })
}

export function getAIReportDetail(id: number) {
  return api.get<AdminAiReport>(`admin/ai/reports/${id}`)
}

export function pinAIReport(id: number) {
  return api.post<{ isPinned: boolean }>(`admin/ai/reports/${id}/pin`)
}

export function getPinnedAIReports() {
  return api.get<AdminAiReportList>("admin/ai/reports", {
    params: { pinnedOnly: "true" },
  })
}

// ==================== 成就 ====================

import type {
  AdminAchievement,
  AchievementMetric as MetricOption,
  AdminUserRank,
} from "@oj2/contract"
export type { AdminAchievement, MetricOption }

function toAchievementBody(data: Partial<AdminAchievement>) {
  return {
    name: data.name,
    description: data.description,
    icon: data.icon,
    rarity: data.rarity,
    hidden: data.hidden ?? false,
    metric: data.metric,
    operator: data.operator,
    threshold: data.threshold,
    visible: data.visible ?? true,
    order: data.order ?? 0,
  }
}

export function getAdminAchievements() {
  return api.get<AdminAchievement[]>("admin/achievements")
}

export function getMetricOptions() {
  return api.get<MetricOption[]>("admin/achievement-metrics")
}

export function createAchievement(data: Partial<AdminAchievement>) {
  return api.post<AdminAchievement>(
    "admin/achievements",
    toAchievementBody(data),
  )
}

export function updateAchievement(data: Partial<AdminAchievement>) {
  return api.put<AdminAchievement>(
    `admin/achievements/${data.id}`,
    toAchievementBody(data),
  )
}

export function deleteAchievement(id: number) {
  return api.delete(`admin/achievements/${id}`)
}

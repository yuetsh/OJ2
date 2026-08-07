import http from "utils/http"
import api2 from "utils/api2"
import { legacyResponse } from "utils/legacy"
import { toProblemListItem } from "admin/transforms"
import type {
  AdminProblem,
  AdminTag,
  Announcement,
  AnnouncementEdit,
  BlankContest,
  BlankProblem,
  Contest,
  Exercise,
  ExerciseType,
  Server,
  SQLDisplay,
  TestcaseUploadedReturns,
  Tutorial,
  User,
  WebsiteConfig,
} from "utils/types"

export function getBaseInfo() {
  return legacyResponse(api2.get("admin/dashboard"))
}

export function randomUser10(classroom: string) {
  return legacyResponse(
    api2.get("admin/random-usernames", { params: { classroom } }),
  )
}

export async function getProblemList(
  offset = 0,
  limit = 10,
  keyword: string,
  author?: string,
  contestID?: string,
  tagId?: number,
) {
  const endpoint = !!contestID ? "admin/contest/problem" : "admin/problem"
  const res = await http.get<{ results: AdminProblem[]; total: number }>(
    endpoint,
    {
      params: {
        paging: true,
        offset,
        limit,
        keyword,
        author,
        contest_id: contestID,
        tag_id: tagId,
      },
    },
  )
  return {
    results: res.data.results.map(toProblemListItem),
    total: res.data.total,
  }
}

export function deleteProblem(id: number) {
  return http.delete("admin/problem", { params: { id } })
}

export function deleteContestProblem(id: number) {
  return http.delete("admin/contest/problem", { params: { id } })
}

export function editProblem(problem: AdminProblem | BlankProblem) {
  return http.put("admin/problem", problem)
}

export function toggleProblemVisible(problemID: number) {
  return http.put("admin/problem/visible", { id: problemID })
}

export function generateFlowchartFromPythonCode(python: string) {
  return http.post("admin/problem/flowchart", { python })
}

export function editContestProblem(problem: AdminProblem | BlankProblem) {
  return http.put("admin/contest/problem", problem)
}

export function getProblem(id: string | number) {
  return http.get<AdminProblem>("admin/problem", { params: { id } })
}

export function getContestProblem(id: number) {
  return http.get("admin/contest/problem", { params: { id } })
}

// 标签管理
export function getTagAdminList(keyword = "") {
  return http.get<AdminTag[]>("admin/problem/tag", { params: { keyword } })
}

export function renameTag(id: number, name: string) {
  return http.put<{
    merged: boolean
    id: number
    name: string
    affected_count: number
  }>("admin/problem/tag", { id, name })
}

export function deleteTag(id: number) {
  return http.delete("admin/problem/tag", { params: { id } })
}

export function batchTagProblems(
  problemIds: number[],
  tagNames: string[],
  action: "add" | "remove",
) {
  return http.post<{ problem_count: number; tag_count: number }>(
    "admin/problem/batch_tag",
    { problem_ids: problemIds, tag_names: tagNames, action },
  )
}

// 用户列表
export function getUserList(
  offset = 0,
  limit = 10,
  type = "",
  keyword: string,
  orderBy = "",
) {
  return legacyResponse(
    api2.get("admin/users", {
      // 旧接口的 order_by 只有 "-last_login" 一个取值
      params: {
        offset,
        limit,
        keyword,
        type,
        orderBy: orderBy === "-last_login" ? "-lastLogin" : orderBy,
      },
    }),
  )
}

// 编辑用户
export function editUser(user: User) {
  return legacyResponse(
    api2.put(`admin/users/${user.id}`, {
      username: user.username,
      email: user.email,
      adminType: user.admin_type,
      problemPermission: user.problem_permission,
      realName: user.real_name ?? null,
      isDisabled: user.is_disabled,
      openApi: user.open_api,
      password: user.password ?? "",
    }),
  )
}

// 重置用户密码。调用方直接用 res.data 当密码字符串（旧后端返回的就是裸字符串），
// 新后端返回 { password }，在这里解包，组件不动
export async function resetPassword(userID: number) {
  const res = await api2.post<{ password: string }>(
    `admin/users/${userID}/reset-password`,
  )
  return { error: res.error, data: res.data.password }
}

// 导入用户
export function importUsers(users: string[][]) {
  return api2.post("admin/users", { users })
}

// 批量删除用户
export function deleteUsers(userIDs: number[]) {
  return api2.delete("admin/users", { data: { ids: userIDs } })
}

export function getContestList(offset = 0, limit = 10, keyword: string) {
  return http.get("admin/contest", {
    params: { paging: true, offset, limit, keyword },
  })
}

// 上传图片
export async function uploadImage(file: File): Promise<string> {
  const form = new window.FormData()
  form.append("image", file)
  const res = await api2.post<{
    success: boolean
    filePath: string
    msg: string
  }>("admin/upload-image", form, {
    headers: { "content-type": "multipart/form-data" },
  })
  return res.data.success ? res.data.filePath : ""
}

// 上传测试用例；SQL 题的压缩包是 1.sql..N.sql（每个文件一个测试点的建表+数据脚本）
export function uploadTestcases(file: File, options: { sql?: boolean } = {}) {
  const form = new window.FormData()
  form.append("file", file)
  if (options.sql) {
    form.append("sql", "1")
  }
  return http.post<TestcaseUploadedReturns>("admin/test_case", form, {
    headers: { "content-type": "multipart/form-data" },
  })
}

// SQL 题测试点预览：后端跑一遍初始化脚本+标准答案，返回数据表和期望结果展示数据
export function previewSQLTestcase(data: {
  init_sql: string
  ref_sql: string
  mode: "query" | "modify"
}) {
  return http.post<SQLDisplay>("admin/sql_test_case_preview", data)
}

// 回显已上传的 SQL 测试点脚本内容（按 1.sql, 2.sql... 排序）
export function getSQLTestcaseScripts(problemId: number) {
  return http.get<{ name: string; content: string }[]>(
    "admin/sql_test_case_scripts",
    { params: { problem_id: problemId } },
  )
}

// AI 根据标准答案生成一个 SQL 测试点初始化脚本
export function generateSQLTestcase(data: {
  ref_sql: string
  mode: "query" | "modify"
}) {
  return http.post<{ sql: string }>("admin/sql_test_case_ai_gen", data)
}

export function createProblem(problem: BlankProblem) {
  return http.post("admin/problem", problem)
}

export function createContestProblem(problem: BlankProblem) {
  return http.post("admin/contest/problem", problem)
}

export function createContest(contest: BlankContest) {
  return http.post("admin/contest", contest)
}

export function editContest(contest: Contest | BlankContest) {
  return http.put("admin/contest", contest)
}

export function cloneContest(contest_id: number) {
  return http.post("admin/contest/clone", { contest_id })
}

export function getContest(id: string) {
  return http.get<Contest & { password: string }>("admin/contest", {
    params: { id },
  })
}

export function addProblemForContest(
  contestID: string,
  problemID: number,
  displayID: string,
) {
  return http.post("admin/contest/add_problem_from_public", {
    contest_id: contestID,
    problem_id: problemID,
    display_id: displayID,
  })
}

export function getWebsite() {
  return legacyResponse<WebsiteConfig>(api2.get("admin/website"))
}

export function editWebsite(data: WebsiteConfig) {
  return api2.post("admin/website", {
    websiteBaseUrl: data.website_base_url,
    websiteName: data.website_name,
    websiteNameShortcut: data.website_name_shortcut,
    websiteFooter: data.website_footer,
    allowRegister: data.allow_register,
    submissionListShowAll: data.submission_list_show_all,
    classList: data.class_list,
    enableMaxkb: data.enable_maxkb,
  })
}

export function listInvalidTestcases() {
  return legacyResponse(api2.get("admin/orphan-test-cases"))
}

export function pruneInvalidTestcases(id?: string) {
  return api2.delete("admin/orphan-test-cases", { params: { id } })
}

export function getJudgeServer() {
  return legacyResponse<{ token: string; servers: Server[] }>(
    api2.get("admin/judge-servers"),
  )
}

export function deleteJudgeServer(hostname: string) {
  return api2.delete(`admin/judge-servers/${encodeURIComponent(hostname)}`)
}

export function getAnnouncementList(offset = 0, limit = 10) {
  return legacyResponse(
    api2.get("admin/announcements", {
      params: { offset, limit },
    }),
  )
}

export function getAnnouncement(id: number) {
  return legacyResponse<Announcement>(api2.get(`admin/announcements/${id}`))
}

export function deleteAnnouncement(id: number) {
  return api2.delete(`admin/announcements/${id}`)
}

export function editAnnouncement(announcement: AnnouncementEdit) {
  const { id, ...body } = announcement
  return legacyResponse(api2.put(`admin/announcements/${id}`, body))
}

export function createAnnouncement(announcement: AnnouncementEdit) {
  const { id: _id, ...body } = announcement
  return legacyResponse(api2.post("admin/announcements", body))
}

/** 组件里的 Tutorial 仍是 snake_case，出站时转成新后端要的 camelCase */
function toTutorialBody(data: Partial<Tutorial>) {
  return {
    title: data.title,
    content: data.content,
    code: data.code ?? null,
    isPublic: data.is_public ?? false,
    order: data.order ?? 0,
    type: data.type,
  }
}

export async function getTutorialList() {
  const res = await legacyResponse<{ [key: string]: Tutorial[] }>(
    api2.get("admin/tutorials"),
  )
  return res.data
}

export async function getTutorial(id: number) {
  const res = await legacyResponse<Tutorial>(api2.get(`admin/tutorials/${id}`))
  return res.data
}

export async function createTutorial(data: Partial<Tutorial>) {
  const res = await legacyResponse<Tutorial>(
    api2.post("admin/tutorials", toTutorialBody(data)),
  )
  return res.data
}

export async function updateTutorial(data: Partial<Tutorial>) {
  const res = await legacyResponse<Tutorial>(
    api2.put(`admin/tutorials/${data.id}`, toTutorialBody(data)),
  )
  return res.data
}

export function deleteTutorial(id: number) {
  return api2.delete(`admin/tutorials/${id}`)
}

export function setTutorialVisibility(id: number, is_public: boolean) {
  return legacyResponse(
    api2.put(`admin/tutorials/${id}/visibility`, { isPublic: is_public }),
  )
}

export async function getAdminExercises(tutorialId: number) {
  const res = await legacyResponse<Exercise[]>(
    api2.get(`admin/tutorials/${tutorialId}/exercises`),
  )
  return res.data
}

export async function createExercise(data: {
  tutorial_id: number
  type: ExerciseType
  data: object
  order: number
}) {
  const res = await legacyResponse<Exercise>(
    api2.post("admin/exercises", {
      tutorialId: data.tutorial_id,
      type: data.type,
      data: data.data,
      order: data.order,
    }),
  )
  return res.data
}

export async function updateExercise(data: {
  id: number
  type: ExerciseType
  data: object
  order: number
}) {
  const res = await legacyResponse<Exercise>(
    api2.put(`admin/exercises/${data.id}`, {
      type: data.type,
      data: data.data,
      order: data.order,
    }),
  )
  return res.data
}

export function deleteExercise(id: number) {
  return api2.delete(`admin/exercises/${id}`)
}

// 将竞赛题目转为公开题目
export function makeProblemPublic(id: number, display_id: string) {
  return http.post("admin/contest_problem/make_public", {
    id,
    display_id,
  })
}

// 比赛辅助检查
export function getACMHelperList(contest_id: number) {
  return http.get("admin/contest/acm_helper", {
    params: { contest_id },
  })
}

export function updateACMHelperChecked(
  contest_id: number,
  rank_id: number,
  problem_id: string,
  checked: boolean,
) {
  return http.put("admin/contest/acm_helper", {
    contest_id,
    rank_id,
    problem_id,
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
  return http.get("admin/problemset", {
    params: {
      offset,
      limit,
      keyword,
      difficulty,
      status,
    },
  })
}

export function getProblemSetDetail(id: number) {
  return http.get(`admin/problemset/${id}`)
}

export function createProblemSet(data: {
  title: string
  description: string
  difficulty: string
  status: string
  end_time?: Date | null
}) {
  return http.post("admin/problemset", data)
}

export function editProblemSet(data: {
  id: number
  title?: string
  description?: string
  difficulty?: string
  status?: string
  end_time?: Date | null
  visible?: boolean
}) {
  return http.put("admin/problemset", data)
}

export function deleteProblemSet(id: number) {
  return http.delete("admin/problemset", { params: { id } })
}

export function toggleProblemSetVisible(id: number) {
  return http.put("admin/problemset/visible", { id })
}

export function updateProblemSetStatus(id: number, status: string) {
  return http.put("admin/problemset/status", { id, status })
}

// 题单题目管理 API
export function getProblemSetProblems(problemSetId: number) {
  return http.get(`admin/problemset/${problemSetId}/problems`)
}

export function addProblemToSet(
  problemSetId: number,
  data: {
    problem_id: string
    order?: number
    is_required?: boolean
    score?: number
    hint?: string
  },
) {
  return http.post(`admin/problemset/${problemSetId}/problems`, data)
}

export function editProblemInSet(
  problemSetId: number,
  problemSetProblemId: number,
  data: {
    order?: number
    is_required?: boolean
    score?: number
    hint?: string
  },
) {
  return http.put(
    `admin/problemset/${problemSetId}/problems/${problemSetProblemId}`,
    data,
  )
}

export function removeProblemFromSet(
  problemSetId: number,
  problemSetProblemId: number,
) {
  return http.delete(
    `admin/problemset/${problemSetId}/problems/${problemSetProblemId}`,
  )
}

// 题单奖章管理 API
export function getProblemSetBadges(problemSetId: number) {
  return http.get(`admin/problemset/${problemSetId}/badges`)
}

export function createProblemSetBadge(
  problemSetId: number,
  data: {
    name: string
    description: string
    icon: string
    condition_type: string
    condition_value: number
    level?: number
  },
) {
  return http.post(`admin/problemset/${problemSetId}/badges`, data)
}

export function editProblemSetBadge(
  problemSetId: number,
  badgeId: number,
  data: {
    name?: string
    description?: string
    icon?: string
    condition_type?: string
    condition_value?: number
    level?: number
  },
) {
  return http.put(`admin/problemset/${problemSetId}/badges/${badgeId}`, data)
}

export function deleteProblemSetBadge(problemSetId: number, badgeId: number) {
  return http.delete(`admin/problemset/${problemSetId}/badges/${badgeId}`)
}

// 题单进度管理 API
export function getProblemSetProgress(problemSetId: number) {
  return http.get(`admin/problemset/${problemSetId}/progress`)
}

export function removeUserFromProblemSet(problemSetId: number, userId: number) {
  return http.delete(`admin/problemset/${problemSetId}/progress/${userId}`)
}

// 学生卡点分析
export function getStuckProblems() {
  return http.get("admin/problem/stuck")
}

export function getTopACTrend(params: {
  since_year: number
  until_year: number
  min_per_year: number
}) {
  return http.get("admin/problem/top_ac_trend", { params })
}

// AI 学习分析报告
export function getAIReportList(offset = 0, limit = 10, username = "") {
  return legacyResponse(
    api2.get("admin/ai/reports", {
      params: { offset, limit, username: username || undefined },
    }),
  )
}

export function getAIReportDetail(id: number) {
  return legacyResponse(api2.get(`admin/ai/reports/${id}`))
}

export function pinAIReport(id: number) {
  return legacyResponse(api2.post(`admin/ai/reports/${id}/pin`))
}

export function getPinnedAIReports() {
  return legacyResponse(
    api2.get("admin/ai/reports", { params: { pinnedOnly: "true" } }),
  )
}

// ==================== 成就 ====================

export interface AdminAchievement {
  id: number
  name: string
  description: string
  icon: string
  rarity: string
  hidden: boolean
  metric: string
  metric_name: string
  operator: "gte" | "lte"
  threshold: number
  visible: boolean
  unlock_count: number
  order: number
  create_time: string
}

export interface MetricOption {
  key: string
  name: string
  help_text: string
}

/** 组件里的成就对象是 snake_case，出站转成新后端要的 camelCase */
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
  return legacyResponse<AdminAchievement[]>(api2.get("admin/achievements"))
}

export function getMetricOptions() {
  return legacyResponse<MetricOption[]>(api2.get("admin/achievement-metrics"))
}

export function createAchievement(data: Partial<AdminAchievement>) {
  return legacyResponse<AdminAchievement>(
    api2.post("admin/achievements", toAchievementBody(data)),
  )
}

export function updateAchievement(data: Partial<AdminAchievement>) {
  return legacyResponse<AdminAchievement>(
    api2.put(`admin/achievements/${data.id}`, toAchievementBody(data)),
  )
}

export function deleteAchievement(id: number) {
  return api2.delete(`admin/achievements/${id}`)
}

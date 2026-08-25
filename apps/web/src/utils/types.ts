import { LANGUAGE_SHOW_VALUE } from "./constants"
import type {
  AdminProblem as ContractAdminProblem,
  SubmissionDetail,
  SubmissionListItem as ContractSubmissionListItem,
  AdminContest,
  AdminUser,
  RankProfile,
  SessionUser,
  UserProfile,
  EmbeddedSubmission as ContractEmbeddedSubmission,
  Grade,
  ProblemDetail,
  ProblemDifficulty,
} from "@oj2/contract"

/**
 * 个人主页数据。`acmProblemsStatus` 的**内容**保持 snake_case ——
 * 它是 user_profile.acm_problems_status 的 JSONB 原文，回滚时旧后端还要读。
 */
export type Profile = Omit<UserProfile, "user" | "acmProblemsStatus"> & {
  user: SessionUser
  acmProblemsStatus: AcmProblemsStatus
}

export interface AcmProblemsStatus {
  problems?: {
    [key: string]: { _id: string; status: number }
  }
  contest_problems?: {
    [key: string]: { [key: string]: { _id: string; status: number } }
  }
}

export type UserAdminType =
  "Regular User" | "Student Admin" | "Teacher Admin" | "Super Admin"

/**
 * 后台用户管理里的用户。`rawPassword` 是明文密码，只有超管专属接口下发 ——
 * 老师要能查学生密码，见契约 adminUserSchema 的注释。
 */
export type User = AdminUser & {
  // 编辑表单里临时填的新密码，不在响应里
  password?: string
}

export type LANGUAGE =
  | "C"
  | "C++"
  | "Python2"
  | "Python3"
  | "Java"
  | "JavaScript"
  | "Golang"
  | "Flowchart"
  | "SQL"

export interface SQLConfig {
  mode: "query" | "modify"
  order_sensitive: boolean
}

export interface SQLDisplayColumn {
  name: string
  type?: string
}

export interface SQLDisplayTable {
  name: string
  columns: SQLDisplayColumn[]
  rows: (string | number | null)[][]
  total_rows: number
  truncated: boolean
  dropped?: boolean
}

export interface SQLDisplay {
  tables: SQLDisplayTable[]
  expected:
    | {
        columns: SQLDisplayColumn[]
        rows: (string | number | null)[][]
        total_rows: number
        truncated: boolean
      }
    | { changed_tables: SQLDisplayTable[] }
}

export type LANGUAGE_SHOW_LABEL =
  (typeof LANGUAGE_SHOW_VALUE)[keyof typeof LANGUAGE_SHOW_VALUE]

export type SUBMISSION_RESULT =
  -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export type ProblemStatus = "passed" | "failed" | "not_test"

interface SampleUser {
  id: number
  username: string
  realName: string | null
}

export interface Tag {
  id: number
  name: string
}

export type {
  AdminTag,
  RenameTagResponse,
  BatchProblemTagResponse,
  SqlTestCaseScript,
  GenerateSqlTestCaseResponse,
} from "@oj2/contract"

export interface TestcaseUploadedReturns {
  id: string
  info: Testcase[]
}

export interface Testcase {
  input_name: string
  output_name: string
  score: string
}

/**
 * 题目详情。以契约的 ProblemDetail 为准，只在这里补两处前端自己的窄化：
 * - `languages` / `template` 的键窄化成 LANGUAGE，组件按语言查模板要靠它
 * - `astRules` / `sqlConfig` / `sqlDisplay` 契约里是 Record<string, unknown>，
 *   这里给出组件实际读的形状
 */
export type Problem = Omit<
  ProblemDetail,
  "languages" | "template" | "sqlConfig" | "sqlDisplay"
> & {
  languages: LANGUAGE[]
  template: { [key in LANGUAGE]?: string }
  sqlConfig?: SQLConfig | null
  sqlDisplay?: SQLDisplay | null
  astRules?: AstRules | null
  hasAstRules?: boolean
  visible?: boolean
  answers?: { language: LANGUAGE; code: string }[]
}

export type AstRules = {
  [key: string]: {
    engine: string
    target?: string
    min?: number
    max?: number
    message: string
  }[]
}

export type {
  ProblemDetail,
  ProblemListItem,
  AdminProblemListItem,
  AdminProblemList,
} from "@oj2/contract"

/** 后台题目详情：比 oj 侧多 answers / testCase* / astRules */
export type AdminProblem = Omit<
  ContractAdminProblem,
  | "languages"
  | "template"
  | "testCaseScore"
  | "sqlConfig"
  | "sqlDisplay"
  | "samples"
  | "answers"
  | "astRules"
> & {
  languages: LANGUAGE[]
  template: { [key in LANGUAGE]?: string }
  // 测试点条目的键名由判题沙箱定，保持 snake_case
  testCaseScore: Testcase[]
  samples: { input: string; output: string }[]
  answers: { language: LANGUAGE; code: string }[]
  sqlConfig?: SQLConfig | null
  sqlDisplay?: SQLDisplay | null
  astRules?: AstRules | null
}

type ExcludeKeys =
  | "id"
  | "createdBy"
  | "createTime"
  | "lastUpdateTime"
  | "statisticInfo"
  | "acceptedNumber"
  | "submissionNumber"
  | "isPublic"
  | "contestId"

export type BlankProblem = Omit<
  AdminProblem,
  ExcludeKeys | "hint" | "mermaidCode"
> & {
  id?: number
  // 新建比赛题时由 detail.vue 在提交前写进来
  contestId?: number | null
  // 表单里恒为字符串：初值 ""，从服务器载入时归一化。
  // v-model 要的是 lvalue，模板里没法 ?? 兜底，所以在类型上就收掉 null
  hint: string
  mermaidCode: string
}

export interface ProblemFiltered {
  _id: string
  id: number
  title: string
  difficulty: "简单" | "中等" | "困难"
  tags: string[]
  submission: number
  rate: string
  status: "not_test" | "passed" | "failed"
  author: string
  allowFlowchart: boolean
  showFlowchart: boolean
  hasAstRules: boolean
}

export interface AdminProblemFiltered {
  _id: string
  id: number
  title: string
  visible: boolean
  username: string
  createTime: string
  difficulty: ProblemDifficulty
  tags: string[]
  hasAstRules: boolean
  allowFlowchart: boolean
  showFlowchart: boolean
  // 比赛题目列表接口不返回这个字段
  topReaction?: { type: ReactionKey; count: number } | null
}

// 题单相关类型
export type {
  ProblemSet,
  ProblemSetList,
  ProblemSetBadge,
  ProblemSetProblem,
  ProblemSetProgress,
  ProblemSetProgressList,
  UserBadge,
} from "@oj2/contract"

export type { CompletedProblem } from "@oj2/contract"

export interface CreateProblemSetData {
  title: string
  description: string
  difficulty: "Easy" | "Medium" | "Hard"
  status: "active" | "archived" | "draft"
  endTime?: Date | null
}

export interface EditProblemSetData {
  id: number
  title?: string
  description?: string
  difficulty?: "Easy" | "Medium" | "Hard"
  status?: "active" | "archived" | "draft"
  endTime?: Date | null
  visible?: boolean
}

export interface Code {
  language: LANGUAGE
  value: string
}

export interface SubmitCodePayload {
  problemId: number
  language: LANGUAGE
  code: string
  contestId?: number
}

// ==================== 流程图相关类型 ====================

export const FlowchartSubmissionStatus = {
  PENDING: 0, // 等待AI评分
  PROCESSING: 1, // AI评分中
  COMPLETED: 2, // 评分完成
  FAILED: 3, // 评分失败
} as const

export type {
  FlowchartSubmission,
  FlowchartListItem as FlowchartSubmissionListItem,
} from "@oj2/contract"

export type { CreateFlowchartRequest as SubmitFlowchartPayload } from "@oj2/contract"

/**
 * 判题机原始输出。契约里是 `info: z.unknown()` —— 后端不校验沙箱产物，
 * 这些键名是沙箱定的，**保持 snake_case**，不要跟着响应字段一起改名。
 */
interface Info {
  err: string | null
  data: {
    error: number
    memory: number
    output: null
    result: SUBMISSION_RESULT
    signal: number
    cpu_time: number
    exit_code: number
    real_time: number
    test_case: string
    output_md5: string
  }[]
}

/**
 * 判题产出的统计。**键名保持 snake_case** —— 这是 submission.statistic_info
 * JSONB 的原文，判题机写进去、回滚时旧后端还要读，不能跟着响应字段一起改名。
 */
export interface StatisticInfo {
  score?: number
  err_info?: string
  time_cost?: number
  memory_cost?: number
  ast_results?: Array<{ description: string; passed: boolean }>
}

/**
 * 提交详情。以契约的 SubmissionDetail 为准，只窄化两处 unknown：
 * `info` 是判题沙箱原始输出，`statisticInfo` 是判题写的 JSONB —— 两者内部都是 snake。
 */
export type Submission = Omit<
  SubmissionDetail,
  "info" | "statisticInfo" | "language" | "result"
> & {
  info: Info
  statisticInfo: StatisticInfo
  language: LANGUAGE
  // 比契约多一个 9：点了提交、还没拿到结果时前端本地先填这个伪状态，
  // 见 constants.ts 的 SubmissionStatus.submitting
  result: SUBMISSION_RESULT
}

/** 站内信里嵌的提交：problem 是展示题号而非数字 id，且不含 info / ip / contestId */
export type EmbeddedSubmission = Omit<
  ContractEmbeddedSubmission,
  "statisticInfo" | "language"
> & {
  statisticInfo: StatisticInfo
  language: LANGUAGE
}

export type SubmissionListItem = Omit<
  ContractSubmissionListItem,
  "statisticInfo" | "language"
> & {
  statisticInfo: StatisticInfo
  language: LANGUAGE
}

export interface SubmissionListPayload {
  myself?: "1" | "0"
  result?: string
  username?: string
  contestId?: string
  problemId?: string
  language: LANGUAGE | ""
  today?: "1" | "0"
  page: number
  limit: number
  offset: number
}

export type { SessionUser } from "@oj2/contract"

export type Rank = RankProfile

export type {
  ClassComparison,
  ClassRankItem,
  ClassUserRank,
} from "@oj2/contract"

/** 后台比赛。oj 侧的 contestSchema 永远不含 password，后台要能看到（告诉学生） */
export type Contest = AdminContest

/** 学生侧的比赛：不含 password / visible / allowedIpRanges */
export type { Contest as OjContest } from "@oj2/contract"

export type BlankContest = Omit<
  AdminContest,
  | "id"
  | "createdBy"
  | "createTime"
  | "lastUpdateTime"
  | "status"
  | "contestType"
>

/**
 * acm_contest_rank.submission_info 的 JSONB 内容。**键名保持 snake_case** ——
 * 判题写进去、回滚时旧后端还要读，不能跟着响应字段一起改名。
 */
export interface SubmissionInfo {
  is_ac: boolean
  ac_time: number
  is_first_ac: boolean
  error_number: number
  checked?: boolean
}

/**
 * 榜单行。`submissionInfo` 的**内容**仍是 snake_case —— 它是 acm_contest_rank
 * 表的 JSONB 原文，回滚时旧后端还要读，见 SubmissionInfo。
 */
export type ContestRank = Omit<
  import("@oj2/contract").ContestRankItem,
  "submissionInfo"
> & {
  submissionInfo: { [key: string]: SubmissionInfo }
}

export type { WebsiteConfig } from "@oj2/contract"

export type {
  JudgeServer as Server,
  JudgeServerList,
  DashboardInfo,
  OrphanTestCase,
  AdminUser,
  AdminUserList,
  AcmHelperItem,
  AdminContestList,
  AdminProblemSetProgress,
  AdminAiReport,
  AdminAiReportListItem,
  AdminAiReportList,
  StuckProblem,
  AcTrend,
} from "@oj2/contract"

export interface AnnouncementEdit {
  id: number
  title: string
  tag: string
  content: string
  visible: boolean
  top: boolean
}

export interface Announcement extends AnnouncementEdit {
  createdBy: SampleUser
  createTime: string
  lastUpdateTime: string
}

/** 列表不下发正文：公告是 8MB 上限的富文本，列表页只显示标题 */
export type AnnouncementListItem = Omit<Announcement, "content">

export interface Message {
  id: number
  sender: SampleUser
  createTime: string
  message: string
  submission: EmbeddedSubmission
}

export interface CreateMessage {
  sender: string
  recipient: string
  submission: string
  message: string
}

export type ReactionKey =
  | "too_easy"
  | "too_hard"
  | "confusing"
  | "buggy"
  | "learned"
  | "interesting"
  | "want_explain"

export type ReactionCounts = Record<ReactionKey, number>

export interface ReactionState {
  mine: ReactionKey | null
  counts: ReactionCounts | null
}

export interface Tutorial {
  id: number
  title: string
  content: string
  code: string
  isPublic: boolean
  order: number
  type: "python" | "c"
  createdBy?: User
  updatedAt?: string
  createdAt?: string
}

/** 后台教程列表不下发正文：教程正文是整篇 markdown，列表只排序和切换可见性 */
export type TutorialListItem = Omit<Tutorial, "content">

export interface ExerciseMcqData {
  question: string
  options: string[]
  answer: number[]
}

export interface ExerciseSortData {
  question: string
  lines: string[]
}

export interface ExerciseFillData {
  question: string
  code: string
}

export interface ExerciseMatchData {
  question: string
  left: string[]
  right: string[]
  answer: number[]
}

export interface ExercisePredictData {
  question: string
  code: string
  answer: string[]
}

export interface ExerciseDebugData {
  question: string
  lines: string[]
  answer: number[]
  explanation?: string
}

export interface ExerciseGroupData {
  question: string
  buckets: string[]
  items: string[]
  answer: number[]
}

export type ExerciseType =
  "mcq" | "sort" | "fill" | "match" | "predict" | "debug" | "group"

export interface Exercise {
  id: number
  type: ExerciseType
  data:
    | ExerciseMcqData
    | ExerciseSortData
    | ExerciseFillData
    | ExerciseMatchData
    | ExercisePredictData
    | ExerciseDebugData
    | ExerciseGroupData
  order: number
}

export type {
  DurationData,
  FlowchartSummary,
  SolvedProblem,
  AiDetail as DetailsData,
} from "@oj2/contract"

// 评级。空串是「无评级」，后端在没有可用数据时真会下发，见契约 gradeSchema
export type { Grade, ProblemDifficulty }

// ==================== 成就相关类型 ====================

import type { AchievementNotification, PendingAchievement } from "@oj2/contract"

export type {
  Achievement,
  AchievementList,
  AchievementRarity,
  AchievementRarityStat,
  AchievementSummary,
  AchievementNotification,
  PendingAchievement,
} from "@oj2/contract"

/**
 * 弹窗队列里的条目。`/achievements/pending` 拉来的没有 kind，
 * WebSocket 推来的有 —— 两个来源会汇进同一个队列。
 */
export type QueuedAchievement = PendingAchievement &
  Partial<Pick<AchievementNotification, "kind">>

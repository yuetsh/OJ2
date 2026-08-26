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
  Message as ContractMessage,
  Grade,
  ProblemDetail,
  ProblemDifficulty,
  JudgeStatus,
  CreateAnnouncementRequest,
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

/**
 * SQL 题的配置与展示数据。形状在契约里 —— 原来这里手抄了一份，
 * 而契约那边是 `Record<string, unknown>`，等于渲染表格的那段代码全靠手抄件兜底。
 * 键名的 snake_case 是 JSONB 原文，见契约 sqlDisplaySchema 的注释。
 */
export type {
  SqlConfig,
  SqlDisplay,
  SqlDisplayTable,
  SqlDisplayColumn,
} from "@oj2/contract"

/**
 * 判题状态码 + 前端本地的「正在提交」(9)。
 *
 * 后端那 11 个码**从契约派生**，不再手抄 —— judgeStatusSchema 加一个码，
 * constants.ts 的 JUDGE_STATUS 会因为缺映射当场编译不过，这正是
 * CLAUDE.md 说的「三处同步」想要的效果。9 是后端永远不会下发的伪状态，
 * 见 constants.ts 的 SubmissionStatus.submitting。
 */
export type SUBMISSION_RESULT = JudgeStatus | 9

export type ProblemStatus = "passed" | "failed" | "not_test"


/**
 * 题目标签。用契约的 —— 它比手抄那份多一个 `problemCount`，
 * shared/api.ts 原来还得用 `Tag & { problemCount: number }` 把它补回来。
 */
export type { Tag } from "@oj2/contract"

export type {
  AdminTag,
  RenameTagResponse,
  BatchProblemTagResponse,
  SqlTestCaseScript,
  GenerateSqlTestCaseResponse,
} from "@oj2/contract"

/**
 * 上传测试点的返回。取契约 —— 手抄那份少了三个字段
 * （stripped_output_md5 / input_size / output_size）。这套键名保持 snake_case
 * 是因为它会原样落进 problem.test_case_score 和判题沙箱读的 info 文件。
 */
export type { UploadTestCaseResponse } from "@oj2/contract"

/**
 * 题目表单里的测试点。落库的只有 {input_name, output_name, score} 三个键 ——
 * 上传响应里多出来的 stripped_output_md5 / input_size / output_size 在保存时
 * 被剥掉（旧后端的 serializer 也是这么干的，见契约 problemTestCaseScoreSchema）。
 * score 不在上传响应里，是上传完成后按测试点数量平分补上去的。
 */
export type { ProblemTestCaseScore as Testcase } from "@oj2/contract"

/**
 * 题目详情。以契约的 ProblemDetail 为准，只在这里补两处前端自己的窄化：
 * - `languages` / `template` 的键窄化成 LANGUAGE，组件按语言查模板要靠它
 * - `astRules` 契约里是 unknown，这里给出组件实际读的形状
 */
export type Problem = Omit<ProblemDetail, "languages" | "template"> & {
  languages: LANGUAGE[]
  template: { [key in LANGUAGE]?: string }
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
  "languages" | "template" | "answers" | "astRules"
> & {
  languages: LANGUAGE[]
  template: { [key in LANGUAGE]?: string }
  // 契约里 answers[].language 是 string，这里收窄成 LANGUAGE
  answers: { language: LANGUAGE; code: string }[]
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
  // 比赛题目列表恒为 null —— 只有公开题列表下发最高票评价
  topReaction: { type: ReactionKey; count: number } | null
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

/** 提交代码的请求体。取契约的形状，只把 language 收窄成前端的 LANGUAGE 联合 */
export type SubmitCodePayload = Omit<CreateSubmissionRequest, "language"> & {
  language: LANGUAGE
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

/** 榜单里「我」的位置：比 Rank 多一个全服名次 */
export type { MyRank } from "@oj2/contract"

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

/**
 * 公告。两侧形状**不同**，原来这里只手抄了后台那份、oj 侧也拿它当类型用：
 * oj 的 `/announcements` 列表既不下发 `content` 也不下发 `visible`
 * （见 apps/api/src/routes/content.ts），于是类型声称有、实际是 undefined。
 * 现在各取各的契约类型。
 */
export type {
  Announcement,
  AnnouncementListItem,
  AdminAnnouncement,
  AdminAnnouncementListItem,
} from "@oj2/contract"

/** 后台编辑表单：请求体 + id（新建时填 0，提交前由 api 层剥掉） */
export type AnnouncementEdit = CreateAnnouncementRequest & { id: number }

/**
 * 站内信。取契约的形状，只把 `submission` 换成前端窄化过的那个
 * （statisticInfo / language 在契约里是 unknown，见 EmbeddedSubmission）。
 */
export type Message = Omit<ContractMessage, "submission"> & {
  submission: EmbeddedSubmission
}

/**
 * 题目表情。三个类型都直接取自契约 —— 语义 key 必须与后端 reaction/models.py
 * 的 ReactionType 一致（见根 CLAUDE.md），手抄一份迟早对不上。
 *
 * 注意 `ReactionCounts` 是 Partial 的：后端只下发有票的类型，没人投的键不出现。
 */
export type {
  ReactionKey,
  ReactionCounts,
  ReactionState,
} from "@oj2/contract"
import type { ReactionKey } from "@oj2/contract"

/**
 * 教程。直接取契约 —— 手抄的那份把 `createdBy` 写成了可选的 `User`（后端下发的是
 * SampleUser），`createdAt` / `updatedAt` 也写成了可选，列表页因此被迫写
 * `row.createdBy?.username` 和 `row.createdAt!`。
 *
 * 列表项也用契约的：它比 `Omit<Tutorial, "content">` **还少一个 code** ——
 * 后端列表接口连 code 一起省了，手抄那份声称它在。
 */
export type {
  AdminTutorial as Tutorial,
  AdminTutorialListItem as TutorialListItem,
} from "@oj2/contract"
import type {
  AdminExercise,
  AdminTutorial,
  CreateSubmissionRequest,
} from "@oj2/contract"

/**
 * 教程编辑表单。只留可编辑字段 —— createdBy / createdAt / updatedAt 由后端产出，
 * 新建时压根不存在（对齐 BlankProblem / BlankContest 的写法）。
 *
 * `code` 收窄成 string：读回来时统一 `?? ""`，代码编辑器的 v-model 不接受 null。
 */
export type TutorialEdit = Omit<
  AdminTutorial,
  "createdBy" | "createdAt" | "updatedAt" | "code"
> & { code: string }

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

export type { ExerciseType } from "@oj2/contract"

/**
 * 练习题。契约里 `data` 是 Record<string, unknown>（各题型结构不同，后端不校验），
 * 前端按题型收窄成判别联合 —— 组件靠它区分七种题型的字段。
 */
export type Exercise = Omit<AdminExercise, "data"> & {
  data:
    | ExerciseMcqData
    | ExerciseSortData
    | ExerciseFillData
    | ExerciseMatchData
    | ExercisePredictData
    | ExerciseDebugData
    | ExerciseGroupData
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

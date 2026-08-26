import { z } from "zod"

import { achievementRaritySchema } from "./achievement"
import { rankProfileSchema } from "./account"
import { paginatedSchema, sampleUserSchema } from "./common"
import { reactionKeySchema } from "./content"
import { problemDifficultySchema, sqlConfigSchema, sqlDisplaySchema } from "./problem"

/**
 * 后台侧的契约。与 oj 侧分开放：同一张表在两侧下发的字段集通常不同
 * （后台要 `visible` 这类管理字段，oj 侧连键都不该出现），
 * 混在一个 schema 里迟早会有人为了省事在 oj 侧复用后台那个。
 */

export const adminAnnouncementSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  tag: z.string(),
  content: z.string(),
  visible: z.boolean(),
  top: z.boolean(),
  createdBy: sampleUserSchema,
  createTime: z.string(),
  lastUpdateTime: z.string(),
})

export const adminAnnouncementListSchema = paginatedSchema(
  // 列表不带 content：公告正文是 8MB 上限的富文本，列表页只显示标题
  adminAnnouncementSchema.omit({ content: true }),
)

export const createAnnouncementRequestSchema = z.object({
  title: z.string().trim().min(1).max(64),
  tag: z.string().max(64),
  content: z.string().max(1024 * 1024 * 8),
  visible: z.boolean(),
  top: z.boolean(),
})

export const updateAnnouncementRequestSchema = createAnnouncementRequestSchema

export type AdminAnnouncement = z.infer<typeof adminAnnouncementSchema>

// ---------------------------------------------------------------- 教程 / 练习

export const tutorialTypeSchema = z.enum(["python", "c"])

export const adminTutorialSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  content: z.string(),
  code: z.string().nullable(),
  isPublic: z.boolean(),
  order: z.number().int(),
  type: tutorialTypeSchema,
  createdBy: sampleUserSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminTutorialListItemSchema = adminTutorialSchema.omit({
  // 教程正文是整篇 markdown，列表页只排序和切换可见性，不需要它
  content: true,
  code: true,
})

/** 后台教程列表按语言分组返回，对齐旧 TutorialAdminAPI.get 的 `{python, c}` 形状 */
export const adminTutorialGroupsSchema = z.object({
  python: z.array(adminTutorialListItemSchema),
  c: z.array(adminTutorialListItemSchema),
})

export const createTutorialRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  content: z.string(),
  code: z.string().nullable().default(null),
  isPublic: z.boolean().default(false),
  order: z.number().int().default(0),
  type: tutorialTypeSchema,
})

export const updateTutorialRequestSchema = createTutorialRequestSchema
export const setTutorialVisibilityRequestSchema = z.object({ isPublic: z.boolean() })

export const exerciseTypeSchema = z.enum([
  "mcq",
  "sort",
  "fill",
  "match",
  "predict",
  "debug",
  "group",
])

export const adminExerciseSchema = z.object({
  id: z.number().int(),
  type: exerciseTypeSchema,
  data: z.record(z.string(), z.unknown()),
  order: z.number().int(),
})

export const createExerciseRequestSchema = z.object({
  tutorialId: z.number().int().positive(),
  type: exerciseTypeSchema,
  data: z.record(z.string(), z.unknown()),
  order: z.number().int().default(0),
})

export const updateExerciseRequestSchema = createExerciseRequestSchema.omit({
  // 练习不支持改挂到别的教程下 —— 旧 EditExerciseSerializer 也没有 tutorial_id
  tutorialId: true,
})

// ---------------------------------------------------------------- AI 报告

/**
 * 列表只给摘要，正文要点开详情才拿 —— 与旧 AIAnalysisListSerializer 一致。
 * `data`（原始 prompt 与结构化输入）和 `system_prompt` / `user_prompt` 两侧都不下发。
 */
export const adminAiReportListItemSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  createTime: z.string(),
  analysisExcerpt: z.string(),
  isPinned: z.boolean(),
})

export const adminAiReportSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  className: z.string().nullable(),
  createTime: z.string(),
  analysis: z.string(),
})

export const adminAiReportListSchema = paginatedSchema(adminAiReportListItemSchema)
export const toggleAiReportPinResponseSchema = z.object({ isPinned: z.boolean() })

// ---------------------------------------------------------------- 成就

// rarity 复用 achievement.ts 里已有的定义，不重复声明 —— 两份枚举迟早会长歪
export const achievementOperatorSchema = z.enum(["gte", "lte"])

export const achievementMetricSchema = z.object({
  key: z.string(),
  name: z.string(),
  helpText: z.string(),
})

export const adminAchievementSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  rarity: achievementRaritySchema,
  hidden: z.boolean(),
  metric: z.string(),
  metricName: z.string(),
  operator: achievementOperatorSchema,
  threshold: z.number().int(),
  visible: z.boolean(),
  // 后台列表必须显示：阈值配错时学生永远拿不到也永远不会来问，这个计数器是唯一的仪表盘
  unlockCount: z.number().int(),
  order: z.number().int(),
  createTime: z.string().nullable(),
})

export const createAchievementRequestSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().min(1),
  icon: z.string().trim().min(1),
  rarity: achievementRaritySchema,
  hidden: z.boolean().default(false),
  metric: z.string().min(1),
  operator: achievementOperatorSchema,
  threshold: z.number().int(),
  visible: z.boolean().default(true),
  order: z.number().int().default(0),
})

export const updateAchievementRequestSchema = createAchievementRequestSchema

// ---------------------------------------------------------------- 用户管理

export const adminUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  email: z.string().nullable(),
  adminType: z.string(),
  problemPermission: z.string(),
  realName: z.string().nullable(),
  createTime: z.string().nullable(),
  lastLogin: z.string().nullable(),
  openApi: z.boolean(),
  isDisabled: z.boolean(),
  // 明文密码。是有意保留的运营需求：老师要能查学生的密码。
  // 只在超管专属的这一个接口下发，别往任何其它地方复制。
  rawPassword: z.string().nullable(),
  className: z.string().nullable(),
})

export const adminUserListSchema = paginatedSchema(adminUserSchema)

export const updateUserRequestSchema = z.object({
  username: z.string().trim().min(1).max(32),
  email: z.email().max(64),
  adminType: z.enum(["Regular User", "Student Admin", "Teacher Admin", "Super Admin"]),
  problemPermission: z.enum(["None", "Own", "All"]),
  realName: z.string().max(32).nullable().default(null),
  isDisabled: z.boolean(),
  openApi: z.boolean(),
  // 空串表示不改密码，与旧 EditUserSerializer 的 allow_blank 一致
  password: z.string().max(128).default(""),
})

/** 导入用户：每行 [用户名, 密码, 邮箱, 真名]，与前端粘贴的 Excel 列序一致 */
export const importUsersRequestSchema = z.object({
  users: z.array(z.tuple([
    z.string().trim().min(1).max(32),
    z.string().min(1),
    z.string(),
    z.string(),
  ])).min(1),
})

export const deleteUsersRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
})

export const resetPasswordResponseSchema = z.object({ password: z.string() })

// ---------------------------------------------------------------- 站点配置 / 运维

export const updateWebsiteConfigRequestSchema = z.object({
  websiteBaseUrl: z.string().max(256),
  websiteName: z.string().trim().min(1).max(64),
  websiteNameShortcut: z.string().trim().min(1).max(32),
  websiteFooter: z.string().max(1024 * 64),
  allowRegister: z.boolean(),
  submissionListShowAll: z.boolean(),
  classList: z.array(z.string()),
  enableMaxkb: z.boolean(),
})

export const judgeServerSchema = z.object({
  id: z.number().int(),
  hostname: z.string(),
  ip: z.string().nullable(),
  judgerVersion: z.string(),
  cpuCore: z.number().int(),
  memoryUsage: z.number(),
  cpuUsage: z.number(),
  lastHeartbeat: z.string(),
  createTime: z.string(),
  taskNumber: z.number().int(),
  serviceUrl: z.string().nullable(),
  isDisabled: z.boolean(),
  /** 心跳在 6 秒内才算在线，与 dashboard 的判活口径一致 */
  status: z.enum(["normal", "abnormal"]),
})

export const judgeServerListSchema = z.object({
  token: z.string(),
  servers: z.array(judgeServerSchema),
})

export const updateJudgeServerRequestSchema = z.object({ isDisabled: z.boolean() })

export const orphanTestCaseSchema = z.object({
  id: z.string(),
  createTime: z.number(),
})

/**
 * 后台的用户排名列表。行的形状与 oj 侧榜单相同，但**没有 100 名的上限**：
 * 这里不是榜单，是老师按班级前缀翻全班学生的管理视图，要能一直翻到底。
 *
 * 独立成一条端点而不是给公开榜单加个「不限量」开关：那个开关一旦存在，
 * 匿名请求就能拉走全校学生名单和个性签名。
 */
export const adminUserRankSchema = paginatedSchema(rankProfileSchema)

export const dashboardInfoSchema = z.object({
  userCount: z.number().int(),
  recentContestCount: z.number().int(),
  todaySubmissionCount: z.number().int(),
  judgeServerCount: z.number().int(),
})

export const uploadImageResponseSchema = z.object({
  success: z.boolean(),
  msg: z.string(),
  filePath: z.string(),
})

// ---------------------------------------------------------------- 比赛管理

export const adminContestSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  tag: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  createTime: z.string(),
  lastUpdateTime: z.string(),
  // 后台要能看到自己设的密码（用来告诉学生），oj 侧的 contestSchema 则永远不含它
  password: z.string().nullable(),
  visible: z.boolean(),
  allowedIpRanges: z.array(z.string()),
  createdBy: sampleUserSchema,
  status: z.enum(["1", "0", "-1"]),
  contestType: z.enum(["Public", "Password Protected"]),
})

export const adminContestListSchema = paginatedSchema(adminContestSchema)

export const createContestRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  description: z.string(),
  tag: z.string().max(64),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  // 空串等同于「不设密码」，与旧 CreateConetestSeriaizer 的 allow_blank 一致
  password: z.string().max(32).nullable().default(null),
  visible: z.boolean(),
  allowedIpRanges: z.array(z.string().max(32)).default([]),
})

export const updateContestRequestSchema = createContestRequestSchema

export const acmHelperItemSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  realName: z.string().nullable(),
  problemId: z.string(),
  problemDisplayId: z.string(),
  acInfo: z.record(z.string(), z.unknown()),
  checked: z.boolean(),
})

export const updateAcmHelperRequestSchema = z.object({
  rankId: z.number().int().positive(),
  problemId: z.string().min(1),
  checked: z.boolean(),
})

// ---------------------------------------------------------------- 题单管理

export const problemSetDifficultySchema = z.enum(["Easy", "Medium", "Hard"])
export const problemSetStatusSchema = z.enum(["draft", "active", "archived"])
export const badgeConditionTypeSchema = z.enum(["all_problems", "problem_count", "score"])

export const adminProblemSetSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  difficulty: problemSetDifficultySchema,
  status: problemSetStatusSchema,
  endTime: z.string().nullable(),
  visible: z.boolean(),
  createdBy: sampleUserSchema,
  createTime: z.string(),
  lastUpdateTime: z.string(),
  problemsCount: z.number().int(),
  /** 加入这份题单的人数，后台用来判断改动会影响多少人 */
  participantCount: z.number().int(),
})

export const adminProblemSetListSchema = paginatedSchema(adminProblemSetSchema)

export const createProblemSetRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string(),
  difficulty: problemSetDifficultySchema.default("Easy"),
  status: problemSetStatusSchema.default("active"),
  endTime: z.string().nullable().default(null),
  visible: z.boolean().default(true),
})

export const updateProblemSetRequestSchema = createProblemSetRequestSchema
export const updateProblemSetStatusRequestSchema = z.object({ status: problemSetStatusSchema })

export const adminProblemSetProblemSchema = z.object({
  id: z.number().int(),
  problemsetId: z.number().int(),
  problemId: z.number().int(),
  displayId: z.string(),
  title: z.string(),
  difficulty: z.string(),
  order: z.number().int(),
  isRequired: z.boolean(),
  score: z.number().int(),
  hint: z.string().nullable(),
})

export const addProblemToSetRequestSchema = z.object({
  /** 展示用题号（_id），不是自增主键 —— 老师手里只有题号 */
  problemId: z.string().trim().min(1),
  order: z.number().int().default(0),
  isRequired: z.boolean().default(true),
  score: z.number().int().default(0),
  hint: z.string().default(""),
})

export const updateProblemInSetRequestSchema = z.object({
  order: z.number().int().optional(),
  isRequired: z.boolean().optional(),
  score: z.number().int().optional(),
  hint: z.string().optional(),
})

export const adminProblemSetBadgeSchema = z.object({
  id: z.number().int(),
  problemsetId: z.number().int(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  conditionType: badgeConditionTypeSchema,
  conditionValue: z.number().int(),
  /** 已获得该奖章的人数，后台改条件前要能看到影响面 */
  earnedCount: z.number().int(),
})

export const createProblemSetBadgeRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string(),
  icon: z.string(),
  conditionType: badgeConditionTypeSchema,
  conditionValue: z.number().int().default(0),
})

export const updateProblemSetBadgeRequestSchema = createProblemSetBadgeRequestSchema

export const adminProblemSetProgressSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  username: z.string(),
  realName: z.string().nullable(),
  joinTime: z.string(),
  completeTime: z.string().nullable(),
  isCompleted: z.boolean(),
  progressPercentage: z.number(),
  completedProblemsCount: z.number().int(),
  totalProblemsCount: z.number().int(),
  totalScore: z.number().int(),
})

// ---------------------------------------------------------------- 标签与题目分析

export const adminTagSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  problemCount: z.number().int(),
})

export const renameTagRequestSchema = z.object({ name: z.string().trim().min(1).max(64) })

export const renameTagResponseSchema = z.object({
  /** 改名撞上已有标签时视为合并：题目关系转移过去、原标签删除 */
  merged: z.boolean(),
  id: z.number().int(),
  name: z.string(),
  affectedCount: z.number().int(),
})

export const batchProblemTagRequestSchema = z.object({
  problemIds: z.array(z.number().int().positive()).min(1),
  tagNames: z.array(z.string()).min(1),
  action: z.enum(["add", "remove"]),
})

export const batchProblemTagResponseSchema = z.object({
  problemCount: z.number().int(),
  tagCount: z.number().int(),
})

export const stuckProblemSchema = z.object({
  problemId: z.string(),
  problemTitle: z.string(),
  total: z.number().int(),
  failed: z.number().int(),
  failedUsers: z.number().int(),
  acRate: z.number(),
})

export const acTrendYearSchema = z.object({
  year: z.number().int(),
  total: z.number().int(),
  accepted: z.number().int(),
  acRate: z.number(),
})

export const acTrendSchema = z.object({
  problemId: z.string(),
  problemTitle: z.string(),
  yearly: z.array(acTrendYearSchema),
})

export const generateFlowchartRequestSchema = z.object({ python: z.string().min(1).max(64 * 1024) })
export const generateFlowchartResponseSchema = z.object({ flowchart: z.string() })

// ---------------------------------------------------------------- 题目管理

export const adminProblemListItemSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
  createdBy: sampleUserSchema,
  visible: z.boolean(),
  createTime: z.string(),
  difficulty: problemDifficultySchema,
  tags: z.array(z.string()),
  hasAstRules: z.boolean(),
  allowFlowchart: z.boolean(),
  showFlowchart: z.boolean(),
  // 最高票评价 {type, count}。**只有公开题列表下发**，比赛题列表恒传 null ——
  // 与旧后端 reaction/services.py:get_top_reactions 的口径一致。
  topReaction: z
    .object({ type: reactionKeySchema, count: z.number().int() })
    .nullable(),
})

export const adminProblemListSchema = paginatedSchema(adminProblemListItemSchema)

/** 后台题目详情：包含 oj 侧永不下发的 answers / testCase* / astRules */
export const adminProblemSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
  description: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  samples: z.array(z.record(z.string(), z.unknown())),
  testCaseId: z.string(),
  testCaseScore: z.array(z.record(z.string(), z.unknown())),
  hint: z.string().nullable(),
  languages: z.array(z.string()),
  template: z.record(z.string(), z.string()),
  createTime: z.string(),
  lastUpdateTime: z.string(),
  timeLimit: z.number().int(),
  memoryLimit: z.number().int(),
  visible: z.boolean(),
  difficulty: problemDifficultySchema,
  source: z.string().nullable(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
  statisticInfo: z.record(z.string(), z.unknown()),
  shareSubmission: z.boolean(),
  contestId: z.number().int().nullable(),
  createdBy: sampleUserSchema,
  isPublic: z.boolean(),
  tags: z.array(z.string()),
  allowFlowchart: z.boolean(),
  showFlowchart: z.boolean(),
  mermaidCode: z.string().nullable(),
  flowchartHint: z.string().nullable(),
  astRules: z.unknown(),
  answers: z.array(z.record(z.string(), z.unknown())),
  prompt: z.string().nullable(),
  sqlConfig: sqlConfigSchema.nullable(),
  sqlDisplay: sqlDisplaySchema.nullable(),
})

export const createProblemRequestSchema = z.object({
  _id: z.string().trim().min(1).max(32),
  title: z.string().trim().min(1).max(1024),
  description: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  samples: z.array(z.record(z.string(), z.unknown())),
  testCaseId: z.string().regex(/^[a-zA-Z0-9]+$/).max(32),
  testCaseScore: z.array(z.record(z.string(), z.unknown())),
  timeLimit: z.number().int().min(1).max(1000 * 60),
  memoryLimit: z.number().int().min(1).max(1024),
  languages: z.array(z.string()).min(1),
  template: z.record(z.string(), z.string()),
  visible: z.boolean(),
  difficulty: z.enum(["Low", "Mid", "High"]),
  tags: z.array(z.string().max(32)).min(1),
  hint: z.string().nullable().default(null),
  source: z.string().max(256).nullable().default(null),
  prompt: z.string().nullable().default(null),
  answers: z.array(z.record(z.string(), z.unknown())).default([]),
  shareSubmission: z.boolean(),
  allowFlowchart: z.boolean().default(false),
  showFlowchart: z.boolean().default(false),
  mermaidCode: z.string().nullable().default(null),
  flowchartHint: z.string().nullable().default(null),
  astRules: z.unknown().default(null),
  // order_sensitive 缺省补 false —— 与旧后端 SQLConfigSerializer 的
  // `BooleanField(default=False)` 一致
  sqlConfig: sqlConfigSchema
    .extend({ order_sensitive: z.boolean().default(false) })
    .nullable()
    .default(null),
})

export const updateProblemRequestSchema = createProblemRequestSchema

export const makeProblemPublicRequestSchema = z.object({
  displayId: z.string().trim().min(1).max(32),
})

export const addContestProblemRequestSchema = z.object({
  problemId: z.number().int().positive(),
  displayId: z.string().trim().min(1).max(32),
})

export const testCaseEntrySchema = z.object({
  stripped_output_md5: z.string(),
  input_size: z.number().int(),
  output_size: z.number().int(),
  input_name: z.string(),
  output_name: z.string(),
})

/**
 * 测试点上传的返回。字段名保持 snake_case —— 它会被原样存进 problem.test_case_score
 * 和落盘的 info 文件，而判题沙箱读的就是这套键名，改成 camelCase 会判不了题。
 */
export const uploadTestCaseResponseSchema = z.object({
  id: z.string(),
  info: z.array(testCaseEntrySchema),
})

export const sqlTestCaseScriptSchema = z.object({
  name: z.string(),
  content: z.string(),
})

export const sqlPreviewRequestSchema = z.object({
  initSql: z.string().min(1).max(1024 * 1024),
  refSql: z.string().min(1).max(1024 * 1024),
  mode: z.enum(["query", "modify"]),
})

export const generateSqlTestCaseRequestSchema = z.object({
  refSql: z.string().min(1).max(64 * 1024),
  mode: z.enum(["query", "modify"]),
})

export const generateSqlTestCaseResponseSchema = z.object({ sql: z.string() })

export type AdminAchievement = z.infer<typeof adminAchievementSchema>
export type AchievementMetric = z.infer<typeof achievementMetricSchema>

export type AdminProblem = z.infer<typeof adminProblemSchema>
export type AdminProblemListItem = z.infer<typeof adminProblemListItemSchema>
export type AdminProblemList = z.infer<typeof adminProblemListSchema>
export type CreateProblemRequest = z.infer<typeof createProblemRequestSchema>

export type AdminContest = z.infer<typeof adminContestSchema>
export type AdminContestList = z.infer<typeof adminContestListSchema>
export type AcmHelperItem = z.infer<typeof acmHelperItemSchema>
export type AdminUser = z.infer<typeof adminUserSchema>
export type AdminUserList = z.infer<typeof adminUserListSchema>
export type JudgeServer = z.infer<typeof judgeServerSchema>
export type DashboardInfo = z.infer<typeof dashboardInfoSchema>
export type JudgeServerList = z.infer<typeof judgeServerListSchema>
export type OrphanTestCase = z.infer<typeof orphanTestCaseSchema>
export type AdminUserRank = z.infer<typeof adminUserRankSchema>

export type AdminAiReportListItem = z.infer<typeof adminAiReportListItemSchema>
export type AdminAiReport = z.infer<typeof adminAiReportSchema>
export type AdminAiReportList = z.infer<typeof adminAiReportListSchema>
export type StuckProblem = z.infer<typeof stuckProblemSchema>
export type AcTrend = z.infer<typeof acTrendSchema>

export type AdminTag = z.infer<typeof adminTagSchema>
export type RenameTagResponse = z.infer<typeof renameTagResponseSchema>
export type BatchProblemTagResponse = z.infer<typeof batchProblemTagResponseSchema>
export type SqlTestCaseScript = z.infer<typeof sqlTestCaseScriptSchema>
export type GenerateSqlTestCaseResponse = z.infer<typeof generateSqlTestCaseResponseSchema>
export type AdminProblemSetProgress = z.infer<typeof adminProblemSetProgressSchema>

export type AdminAnnouncementList = z.infer<typeof adminAnnouncementListSchema>
export type CreateAnnouncementRequest = z.infer<typeof createAnnouncementRequestSchema>
export type UpdateAnnouncementRequest = z.infer<typeof updateAnnouncementRequestSchema>
export type TutorialType = z.infer<typeof tutorialTypeSchema>
export type AdminTutorial = z.infer<typeof adminTutorialSchema>
export type AdminTutorialListItem = z.infer<typeof adminTutorialListItemSchema>
export type AdminTutorialGroups = z.infer<typeof adminTutorialGroupsSchema>
export type CreateTutorialRequest = z.infer<typeof createTutorialRequestSchema>
export type UpdateTutorialRequest = z.infer<typeof updateTutorialRequestSchema>
export type SetTutorialVisibilityRequest = z.infer<typeof setTutorialVisibilityRequestSchema>
export type ExerciseType = z.infer<typeof exerciseTypeSchema>
export type AdminExercise = z.infer<typeof adminExerciseSchema>
export type CreateExerciseRequest = z.infer<typeof createExerciseRequestSchema>
export type UpdateExerciseRequest = z.infer<typeof updateExerciseRequestSchema>
export type ToggleAiReportPinResponse = z.infer<typeof toggleAiReportPinResponseSchema>
export type AchievementOperator = z.infer<typeof achievementOperatorSchema>
export type CreateAchievementRequest = z.infer<typeof createAchievementRequestSchema>
export type UpdateAchievementRequest = z.infer<typeof updateAchievementRequestSchema>
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>
export type ImportUsersRequest = z.infer<typeof importUsersRequestSchema>
export type DeleteUsersRequest = z.infer<typeof deleteUsersRequestSchema>
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>
export type UpdateWebsiteConfigRequest = z.infer<typeof updateWebsiteConfigRequestSchema>
export type UpdateJudgeServerRequest = z.infer<typeof updateJudgeServerRequestSchema>
export type UploadImageResponse = z.infer<typeof uploadImageResponseSchema>
export type CreateContestRequest = z.infer<typeof createContestRequestSchema>
export type UpdateContestRequest = z.infer<typeof updateContestRequestSchema>
export type UpdateAcmHelperRequest = z.infer<typeof updateAcmHelperRequestSchema>
export type ProblemSetDifficulty = z.infer<typeof problemSetDifficultySchema>
export type ProblemSetStatus = z.infer<typeof problemSetStatusSchema>
export type BadgeConditionType = z.infer<typeof badgeConditionTypeSchema>
export type AdminProblemSet = z.infer<typeof adminProblemSetSchema>
export type AdminProblemSetList = z.infer<typeof adminProblemSetListSchema>
export type CreateProblemSetRequest = z.infer<typeof createProblemSetRequestSchema>
export type UpdateProblemSetRequest = z.infer<typeof updateProblemSetRequestSchema>
export type UpdateProblemSetStatusRequest = z.infer<typeof updateProblemSetStatusRequestSchema>
export type AdminProblemSetProblem = z.infer<typeof adminProblemSetProblemSchema>
export type AddProblemToSetRequest = z.infer<typeof addProblemToSetRequestSchema>
export type UpdateProblemInSetRequest = z.infer<typeof updateProblemInSetRequestSchema>
export type AdminProblemSetBadge = z.infer<typeof adminProblemSetBadgeSchema>
export type CreateProblemSetBadgeRequest = z.infer<typeof createProblemSetBadgeRequestSchema>
export type UpdateProblemSetBadgeRequest = z.infer<typeof updateProblemSetBadgeRequestSchema>
export type RenameTagRequest = z.infer<typeof renameTagRequestSchema>
export type BatchProblemTagRequest = z.infer<typeof batchProblemTagRequestSchema>
export type AcTrendYear = z.infer<typeof acTrendYearSchema>
export type GenerateFlowchartRequest = z.infer<typeof generateFlowchartRequestSchema>
export type GenerateFlowchartResponse = z.infer<typeof generateFlowchartResponseSchema>
export type UpdateProblemRequest = z.infer<typeof updateProblemRequestSchema>
export type MakeProblemPublicRequest = z.infer<typeof makeProblemPublicRequestSchema>
export type AddContestProblemRequest = z.infer<typeof addContestProblemRequestSchema>
export type TestCaseEntry = z.infer<typeof testCaseEntrySchema>
export type UploadTestCaseResponse = z.infer<typeof uploadTestCaseResponseSchema>
export type SqlPreviewRequest = z.infer<typeof sqlPreviewRequestSchema>
export type GenerateSqlTestCaseRequest = z.infer<typeof generateSqlTestCaseRequestSchema>

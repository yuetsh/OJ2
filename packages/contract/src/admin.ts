import { z } from "zod"

import { achievementRaritySchema } from "./achievement"
import { paginatedSchema, sampleUserSchema } from "./common"

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

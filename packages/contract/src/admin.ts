import { z } from "zod"

import { ADMIN_TYPES, PROBLEM_PERMISSIONS } from "./roles"

import { achievementRaritySchema } from "./achievement"
import { rankProfileSchema } from "./account"
import { paginatedSchema, sampleUserSchema } from "./common"
import { reactionKeySchema } from "./content"
import { badgeConditionTypeSchema } from "./problemset"
import { problemLanguageSchema, runnableLanguageSchema } from "./language"
import {
  astRuleSchema,
  astRulesSchema,
  problemDifficultySchema,
  sqlConfigSchema,
  sqlDisplaySchema,
  tagCategorySchema,
} from "./problem"

// 放这里而不是 roles.ts：roles.ts 要保持不 import zod，理由见那边的文件头
export const adminTypeSchema = z.enum(ADMIN_TYPES)
export const problemPermissionSchema = z.enum(PROBLEM_PERMISSIONS)

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

// 列表不带 content：公告正文是 8MB 上限的富文本，列表页只显示标题
export const adminAnnouncementListItemSchema = adminAnnouncementSchema.omit({
  content: true,
})

export const adminAnnouncementListSchema = paginatedSchema(adminAnnouncementListItemSchema)

export const createAnnouncementRequestSchema = z.object({
  title: z.string().trim().min(1).max(64),
  tag: z.string().max(64),
  content: z.string().max(1024 * 1024 * 8),
  visible: z.boolean(),
  top: z.boolean(),
})

export const updateAnnouncementRequestSchema = createAnnouncementRequestSchema

export type ProblemSample = z.infer<typeof problemSampleSchema>
export type ProblemAnswer = z.infer<typeof problemAnswerSchema>
export type ProblemTestCaseScore = z.infer<typeof problemTestCaseScoreSchema>
export type AdminAnnouncement = z.infer<typeof adminAnnouncementSchema>
export type AdminAnnouncementListItem = z.infer<typeof adminAnnouncementListItemSchema>

// ---------------------------------------------------------------- 教程 / 练习

export const tutorialTypeSchema = z.enum(["python", "c"])

/** 后台一课挂的一道「去做几道题」。按 tutorial_problem.order 排 */
export const adminTutorialProblemSchema = z.object({
  id: z.number().int(),
  displayId: z.string(),
  title: z.string(),
  mustDo: z.boolean(),
})

export const adminTutorialSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  content: z.string(),
  // 「示例代码」字段界面上已经去掉（正文里的代码块能直接运行了），发布脚本还在传，照收照回
  code: z.string().nullable(),
  project: z.string(),
  problems: z.array(adminTutorialProblemSchema),
  isPublic: z.boolean(),
  order: z.number().int(),
  type: tutorialTypeSchema,
  createdBy: sampleUserSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminTutorialListItemSchema = adminTutorialSchema
  .omit({
    // 教程正文是整篇 markdown，列表页用不上
    content: true,
    code: true,
    problems: true,
  })
  .extend({
    exerciseCount: z.number().int(),
    problemCount: z.number().int(),
    /** 打开过这一课的学生数（全部时间），老师判断哪课没人看 */
    readers: z.number().int(),
  })

/** 后台教程列表按语言分组返回，对齐旧 TutorialAdminAPI.get 的 `{python, c}` 形状 */
export const adminTutorialGroupsSchema = z.object({
  python: z.array(adminTutorialListItemSchema),
  c: z.array(adminTutorialListItemSchema),
})

/**
 * `project` 不传就从正文第一段的「**所属项目：…**」抽 —— 发布脚本（docs/*-tutorials/
 * publish.js）不认识这个字段，更新时也不能因为它没传就把项目清空。
 */
export const createTutorialRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  content: z.string(),
  code: z.string().nullable().default(null),
  project: z.string().trim().max(64).optional(),
  isPublic: z.boolean().default(false),
  order: z.number().int().default(0),
  type: tutorialTypeSchema,
})

export const updateTutorialRequestSchema = createTutorialRequestSchema
export const setTutorialVisibilityRequestSchema = z.object({
  isPublic: z.boolean(),
})

/** 一课挂哪几道题，整串替换，顺序就是数组顺序 */
export const TUTORIAL_PROBLEM_MAX = 6
export const setTutorialProblemsRequestSchema = z.object({
  problemIds: z.array(z.number().int().positive()).max(TUTORIAL_PROBLEM_MAX),
})

/** 拖动排序：同一门课的教程 id 按新顺序排好整串交上来 */
export const reorderTutorialsRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
})

/** 项目改名：这门课里所有挂在 `from` 下的教程一起改 */
export const renameTutorialProjectRequestSchema = z.object({
  type: tutorialTypeSchema,
  from: z.string().max(64),
  to: z.string().trim().min(1).max(64),
})

/** 后台给一课挑题时的候选：必会题排在前面 */
export const tutorialProblemCandidateSchema = adminTutorialProblemSchema.extend({
  tags: z.array(z.string()),
})

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
  /** 列表里名字旁边写是哪个班的 */
  className: z.string().nullable(),
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
export const toggleAiReportPinResponseSchema = z.object({
  isPinned: z.boolean(),
})

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
  isDisabled: z.boolean(),
  // 在线与否不在库里，是从 Redis 的活动时间戳算出来的（api 的 auth/presence.ts）
  isOnline: z.boolean(),
  // 明文密码。是有意保留的运营需求：老师要能查学生的密码。
  // 只在超管专属的这一个接口下发，别往任何其它地方复制。
  rawPassword: z.string().nullable(),
  className: z.string().nullable(),
})

export const adminUserListSchema = paginatedSchema(adminUserSchema).extend({
  /** 同样筛选条件下从没登录过的人数（列表顶上「48 人 · 1 人从没登录」） */
  neverLoggedIn: z.number().int(),
})

/** 批量建号之前查重：这几个用户名哪些已经有了 */
export const checkUsernamesRequestSchema = z.object({
  usernames: z.array(z.string().trim().min(1).max(32)).min(1).max(500),
})
export const checkUsernamesResponseSchema = z.object({
  existing: z.array(z.object({ username: z.string(), createTime: z.string().nullable() })),
})

export const updateUserRequestSchema = z.object({
  username: z.string().trim().min(1).max(32),
  email: z.email().max(64),
  adminType: adminTypeSchema,
  problemPermission: problemPermissionSchema,
  realName: z.string().max(32).nullable().default(null),
  isDisabled: z.boolean(),
  // 空串表示不改密码，与旧 EditUserSerializer 的 allow_blank 一致
  password: z.string().max(128).default(""),
})

/** 导入用户：每行 [用户名, 密码, 邮箱, 真名]，与前端粘贴的 Excel 列序一致 */
export const importUsersRequestSchema = z.object({
  users: z
    .array(z.tuple([z.string().trim().min(1).max(32), z.string().min(1), z.string(), z.string()]))
    .min(1),
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

export const updateJudgeServerRequestSchema = z.object({
  isDisabled: z.boolean(),
})

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
  createdBy: sampleUserSchema,
  status: z.enum(["1", "0", "-1"]),
  contestType: z.enum(["Public", "Password Protected"]),
})

/** 后台比赛列表的一行：比赛本身，加几道题、几人参加（交过题的人数） */
export const adminContestListItemSchema = adminContestSchema.extend({
  problemCount: z.number().int(),
  participantCount: z.number().int(),
})

export const adminContestListSchema = paginatedSchema(adminContestListItemSchema)

export const createContestRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  description: z.string(),
  tag: z.string().max(64),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  // 空串等同于「不设密码」，与旧 CreateConetestSeriaizer 的 allow_blank 一致
  password: z.string().max(32).nullable().default(null),
  visible: z.boolean(),
})

export const updateContestRequestSchema = createContestRequestSchema

export const updateAcmHelperRequestSchema = z.object({
  rankId: z.number().int().positive(),
  problemId: z.string().min(1),
  checked: z.boolean(),
})

// ---------------------------------------------------------------- 题单管理

export const adminProblemSetSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  /** 布置到哪天（东八区当天结束）；null = 没布置 */
  assignedUntil: z.string().nullable(),
  /** 这一轮布置开始的时刻 */
  assignedAt: z.string().nullable(),
  /** 现在在不在布置期内（服务端的钟） */
  assigning: z.boolean(),
  /** 公开：学生能在题单列表里看到、能进 */
  visible: z.boolean(),
  createdBy: sampleUserSchema,
  createTime: z.string(),
  lastUpdateTime: z.string(),
  problemsCount: z.number().int(),
  /** 加入这份题单的人数，后台用来判断改动会影响多少人 */
  participantCount: z.number().int(),
  /** 做完（必做题全对）的人数 */
  completedCount: z.number().int(),
  badgeCount: z.number().int(),
})

export const adminProblemSetListSchema = paginatedSchema(adminProblemSetSchema)

export const createProblemSetRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().default(""),
  /** 布置到哪天；null = 不布置。从「没在布置」变成「布置到将来」时，服务端把布置开始记成现在 */
  assignedUntil: z.string().nullable().default(null),
  visible: z.boolean().default(true),
})

export const updateProblemSetRequestSchema = createProblemSetRequestSchema

export const adminProblemSetProblemSchema = z.object({
  id: z.number().int(),
  problemSetId: z.number().int(),
  problemId: z.number().int(),
  problemDisplayId: z.string(),
  title: z.string(),
  difficulty: z.string(),
  order: z.number().int(),
  isRequired: z.boolean(),
})

export const addProblemsToSetRequestSchema = z.object({
  /** 展示用题号（_id），不是自增主键 —— 老师手里只有题号。按给的顺序接在最后 */
  problemIds: z.array(z.string().trim().min(1)).min(1).max(100),
})

export const addProblemsToSetResultSchema = z.object({
  added: z.array(z.string()),
  /** 题号不存在、不可见或是比赛题 */
  missing: z.array(z.string()),
  /** 本来就在题单里 */
  duplicate: z.array(z.string()),
})

export const updateProblemInSetRequestSchema = z.object({
  isRequired: z.boolean(),
})

/** 拖动排序：题单里题目的链接 id，按新顺序给全 */
export const reorderProblemSetProblemsRequestSchema = z.object({
  ids: z.array(z.number().int()).min(1),
})

export const adminProblemSetBadgeSchema = z.object({
  id: z.number().int(),
  problemSetId: z.number().int(),
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
  icon: z.string().min(1),
  conditionType: badgeConditionTypeSchema,
  conditionValue: z.number().int().default(0),
})

export const updateProblemSetBadgeRequestSchema = createProblemSetBadgeRequestSchema

// ---------------------------------------------------------------- 标签与题目分析

export const adminTagSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  category: tagCategorySchema,
  /** 分类有没有人确认过。出题时新建的标签是 false，默认先算知识点，等老师归类 */
  categoryConfirmed: z.boolean(),
  problemCount: z.number().int(),
})

export const setTagCategoryRequestSchema = z.object({
  category: tagCategorySchema,
})

export const renameTagRequestSchema = z.object({
  name: z.string().trim().min(1).max(64),
})

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

/** 勾了几道题，一次让学生看得到 / 藏起来。只认公开题、只认自己能改的 */
export const batchProblemVisibleRequestSchema = z.object({
  problemIds: z.array(z.number().int().positive()).min(1),
  visible: z.boolean(),
})

export const batchProblemTagResponseSchema = z.object({
  problemCount: z.number().int(),
  tagCount: z.number().int(),
})

/**
 * 卡点分析的一道题（一行）。口径是「人 × 题」：只算**第一次交**落在所选时间段里的那些
 * 人题对，指标按这对的全部历史算（做没做对、交了几次才对）。比率由前端按人数算，
 * 这样知识点的汇总能按所选门槛过滤后再加权。
 */
export const stuckProblemSchema = z.object({
  id: z.number().int(),
  displayId: z.string(),
  title: z.string(),
  /** 知识点（category = knowledge 的标签） */
  tags: z.array(z.string()),
  /** 做过的人 */
  users: z.number().int(),
  /** 第一次交就对的人 */
  firstTry: z.number().int(),
  /** 做对了的人 */
  solved: z.number().int(),
  /** 做对的人「做对那次及之前」一共交了几次，加总 —— 除以 solved 就是平均 */
  solvedTries: z.number().int(),
})

export const stuckStudentSchema = z.object({
  username: z.string(),
  className: z.string().nullable(),
  firstTry: z.boolean(),
  solved: z.boolean(),
  /** 做对了：做对那次及之前交了几次；没做对：一共交了几次 */
  tries: z.number().int(),
  /** 第一次交到做对隔了几分钟，没做对是 null */
  minutes: z.number().int().nullable(),
  lastResult: z.number().int(),
  lastSubmissionId: z.string(),
})

export const stuckProblemDetailSchema = z.object({
  problem: z.object({
    id: z.number().int(),
    displayId: z.string(),
    title: z.string(),
    tags: z.array(z.string()),
  }),
  students: z.array(stuckStudentSchema),
  /** 这些人错的那些次，按判题结果分 */
  errors: z.array(z.object({ result: z.number().int(), count: z.number().int() })),
  /** 全站历年（学年按 9 月起算，`year` 是起始年），不受班级和时间段影响 */
  history: z.array(
    z.object({ year: z.number().int(), users: z.number().int(), firstTry: z.number().int() }),
  ),
})

/** 年度趋势：一道题在各届（班号前两位）的「一次就对」，只给至少 5 人做过的格子 */
export const gradeTrendProblemSchema = z.object({
  id: z.number().int(),
  displayId: z.string(),
  title: z.string(),
  grades: z.array(
    z.object({ grade: z.string(), users: z.number().int(), firstTry: z.number().int() }),
  ),
})

// ---------------------------------------------------------------- 自学情况

/**
 * 「自学情况」的方块格：一个班的学生 × 这门课的每一课。
 *
 * **没打开过任何一课的学生也要有一行**（`opened` 为空）—— 页面上把他们收成一串名单，
 * 这张表首要回答的就是「谁还没开始」。`done` 是学完的课（练一练全对，见 `isLessonDone`），
 * 一定也在 `opened` 里或者是没打开却把练一练做完了的（老链接直达练习的情况）。
 */
export const learnBoardStudentSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  realName: z.string().nullable(),
  className: z.string().nullable(),
  opened: z.array(z.number().int()),
  done: z.array(z.number().int()),
  exerciseSolved: z.number().int(),
  totalSeconds: z.number().int(),
  lastViewedAt: z.string().nullable(),
})

export const learnBoardSchema = z.object({
  /** 实际看的是哪个班。老师没选时后端按排名页同一套规则猜，猜不出是 null */
  className: z.string().nullable(),
  tutorials: z.array(
    z.object({
      id: z.number().int(),
      title: z.string(),
      project: z.string(),
      exerciseTotal: z.number().int(),
    }),
  ),
  students: z.array(learnBoardStudentSchema),
})

/**
 * 「按练习」一行。回答的是「哪道练习卡住了全班」——
 * `solvedUsers / triedUsers` 是正确率，`avgAttemptsToSolve` 是做对的人平均试了几次，
 * `firstTryUsers` 是一次就做对的人数。三个一起看才分得清「题目难」和「题目有歧义」：
 * 前者是试了几次终于做对，后者是很多人第一次就掉进同一个坑。
 */
export const learnExerciseProgressSchema = z.object({
  exerciseId: z.number().int(),
  tutorialId: z.number().int(),
  tutorialTitle: z.string(),
  tutorialOrder: z.number().int(),
  type: exerciseTypeSchema,
  order: z.number().int(),
  question: z.string(),
  triedUsers: z.number().int(),
  solvedUsers: z.number().int(),
  firstTryUsers: z.number().int(),
  attempts: z.number().int(),
  avgAttemptsToSolve: z.number(),
})

export const learnExerciseProgressListSchema = z.object({
  studentCount: z.number().int(),
  results: z.array(learnExerciseProgressSchema),
})

/** 单道练习的逐人明细，后台表格展开时才拉 */
export const learnExerciseAttemptSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  realName: z.string().nullable(),
  className: z.string().nullable(),
  attempts: z.number().int(),
  wrongAttempts: z.number().int(),
  solved: z.boolean(),
  attemptsToSolve: z.number().int().nullable(),
  lastWrongAnswer: z.string().nullable(),
  lastAttemptAt: z.string(),
})

export const generateFlowchartRequestSchema = z.object({
  python: z
    .string()
    .min(1)
    .max(64 * 1024),
})
/** AI 照 Python 答案画的参考流程图：结构树（FlowDoc），后台画布直接摆上去接着改 */
export const generateFlowchartResponseSchema = z.object({
  doc: z.record(z.string(), z.unknown()),
})

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
  /** SQL 题：列表里标题后面挂标签；编辑时进 SQL 出题页 */
  isSql: z.boolean(),
  hasAstRules: z.boolean(),
  allowFlowchart: z.boolean(),
  showFlowchart: z.boolean(),
  // 最高票评价 {type, count}。**只有公开题列表下发**，比赛题列表恒传 null ——
  // 与旧后端 reaction/services.py:get_top_reactions 的口径一致。
  topReaction: z.object({ type: reactionKeySchema, count: z.number().int() }).nullable(),
  /**
   * 做对 / 做过的人数（代码提交，和前台题目列表同一口径）。比赛题列表恒为 0 ——
   * 那个口径只数题库里交的。做过的人数 > 0 就删不掉（有提交），列表里「删除」据此灰掉
   */
  solvedUsers: z.number().int(),
  triedUsers: z.number().int(),
})

export const adminProblemListSchema = paginatedSchema(adminProblemListItemSchema).extend({
  /**
   * 「全部 / 学生看得到 / 藏着的」三个按钮上的数：除了可见性，筛选条件和列表一样。
   * 只有公开题列表给，比赛题列表没有这组按钮
   */
  counts: z
    .object({ all: z.number().int(), visible: z.number().int(), hidden: z.number().int() })
    .optional(),
})

/**
 * 题面样例 / 标准答案 / 测试点分值。这三个旧后端都是逐字段校验的
 * （CreateSampleSerializer / CreateAnswerSerializer / CreateTestCaseScoreSerializer），
 * 新后端一路写成 `z.record(z.unknown())` **反而比旧的松**。
 *
 * 生产库 956 道题逐条比对过：samples 947 条是 {input,output}（另外 9 条是空数组，
 * SQL 题没样例）、answers 268 条是 {language,code}（633 条 null、55 条空数组）。
 */
export const problemSampleSchema = z.object({
  input: z.string(),
  output: z.string(),
})

export const problemAnswerSchema = z.object({
  language: z.string(),
  code: z.string(),
})

/**
 * 测试点分值。**只有这三个键** —— 上传接口的响应比这多三个
 * （stripped_output_md5 / input_size / output_size），旧后端的 DRF serializer
 * 收下时把多的丢掉，生产库 956 行全是三键。zod 的 object 默认也剥未知键，
 * 行为一致。
 *
 * score 前端算出来是字符串（`(100 / n).toFixed(0)`），旧后端 IntegerField 转成
 * 整数落库，7990 条全是 int —— 这里用 coerce 保持同一个落库形状。
 */
export const problemTestCaseScoreSchema = z.object({
  input_name: z.string().max(32),
  output_name: z.string().max(32),
  score: z.coerce.number().int().min(0),
})

/** 后台题目详情：包含 oj 侧永不下发的 answers / testCase* / astRules */
export const adminProblemSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
  description: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  samples: z.array(problemSampleSchema),
  testCaseId: z.string(),
  testCaseScore: z.array(problemTestCaseScoreSchema),
  hint: z.string().nullable(),
  languages: z.array(z.string()),
  template: z.record(z.string(), z.string()),
  createTime: z.string(),
  /**
   * `problem.last_update_time` 是全库唯一可空的那一列（961 道题里 470 道是 NULL：
   * 从来没被编辑过的老题）。公共的 problemDetailSchema 早就是 nullable，这里漏了，
   * 于是后台打开任何一道没编辑过的题都会 500 在 parse 上。
   */
  lastUpdateTime: z.string().nullable(),
  timeLimit: z.number().int(),
  memoryLimit: z.number().int(),
  visible: z.boolean(),
  difficulty: problemDifficultySchema,
  source: z.string().nullable(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
  statisticInfo: z.record(z.string(), z.unknown()),
  contestId: z.number().int().nullable(),
  createdBy: sampleUserSchema,
  isPublic: z.boolean(),
  tags: z.array(z.string()),
  allowFlowchart: z.boolean(),
  showFlowchart: z.boolean(),
  mermaidCode: z.string().nullable(),
  /** 参考流程图的结构树（FlowDoc）；2026-10 之前出的题只有 mermaidCode，这里是空对象 */
  flowchartData: z.record(z.string(), z.unknown()),
  flowchartHint: z.string().nullable(),
  astRules: astRulesSchema.nullable(),
  answers: z.array(problemAnswerSchema),
  prompt: z.string().nullable(),
  sqlConfig: sqlConfigSchema.nullable(),
  sqlDisplay: sqlDisplaySchema.nullable(),
})

/**
 * 出题页新建标签时的名字上限，沿用旧 CreateProblemSerializer 的 32。
 * 出题页的输入框拿它做 maxlength —— 不共享一个常量的话，超长标签只会在保存时
 * 撞出 zod 的英文报错（"Too big: expected string to have <=32 characters"），
 * 老师看不懂也不知道该改哪里。
 *
 * 列本身是 text 没有长度限制，标签管理页（createTagRequestSchema /
 * renameTagRequestSchema）放到 64 —— 两处口径不同是旧后端就有的，这里只是把
 * 出题页这一侧的数字挪到一处，没有改任何校验的松紧。
 */
export const PROBLEM_TAG_MAX_LENGTH = 32

export const createProblemRequestSchema = z.object({
  _id: z.string().trim().min(1).max(32),
  title: z.string().trim().min(1).max(1024),
  description: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  samples: z.array(problemSampleSchema),
  testCaseId: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/)
    .max(32),
  testCaseScore: z.array(problemTestCaseScoreSchema),
  timeLimit: z
    .number()
    .int()
    .min(1)
    .max(1000 * 60),
  memoryLimit: z.number().int().min(1).max(1024),
  // 收窄到语言联合而不是裸 string[]：`problem.languages` 列上挂着
  // `$type<ProblemLanguage[]>()`，那个断言得有人兑现 —— 闸就设在这里（写入侧）。
  languages: z.array(problemLanguageSchema).min(1),
  template: z.record(z.string(), z.string()),
  visible: z.boolean(),
  difficulty: z.enum(["Low", "Mid", "High"]),
  tags: z.array(z.string().max(PROBLEM_TAG_MAX_LENGTH)).min(1),
  hint: z.string().nullable().default(null),
  source: z.string().max(256).nullable().default(null),
  prompt: z.string().nullable().default(null),
  answers: z.array(problemAnswerSchema).default([]),
  allowFlowchart: z.boolean().default(false),
  showFlowchart: z.boolean().default(false),
  mermaidCode: z.string().nullable().default(null),
  /**
   * 用画布画的参考流程图（FlowDoc）。给了就以它为准，mermaidCode 由后端照它重新生成；
   * 不给（老题只有手写的 Mermaid）就原样存 mermaidCode
   */
  flowchartData: z.record(z.string(), z.unknown()).nullable().default(null),
  flowchartHint: z.string().nullable().default(null),
  astRules: astRulesSchema.nullable().default(null),
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

/** 比赛题排顺序：给出这场比赛**全部**题目的 id，按这个顺序把编号改成 1、2、3… */
export const reorderContestProblemsRequestSchema = z.object({
  problemIds: z.array(z.number().int().positive()).min(1).max(100),
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
  initSql: z
    .string()
    .min(1)
    .max(1024 * 1024),
  refSql: z
    .string()
    .min(1)
    .max(1024 * 1024),
  mode: z.enum(["query", "modify"]),
  /**
   * 这组是不是题面上给学生看的那组（第 1 组）。增删改题只有这一组必须改到行 ——
   * 其余组可以一行都不改，用来看学生会不会多改（比如 WHERE 写漏了）
   */
  shown: z.boolean().default(true),
})

export const generateSqlTestCaseRequestSchema = z.object({
  refSql: z
    .string()
    .min(1)
    .max(64 * 1024),
  mode: z.enum(["query", "modify"]),
})

export const generateSqlTestCaseResponseSchema = z.object({ sql: z.string() })

/**
 * 一道题最多几组测试数据（编程题的 N.in / N.out、SQL 题的 N.sql 都算）。
 * 提交详情要把每组的结果一行行列出来，几百组的题截图截不下；
 * 2026-10 线上超过 20 组的题已经全部缩到 20 组。
 */
export const TEST_CASE_MAX_CASES = 20

/**
 * 编程题出题页回显已有的测试点（N.in / N.out 原文）。太大的不展开 —— 页面上要一组一组
 * 摆出来、改了还要整包重跑一遍标准答案，几百组或者几 MB 的数据摆不下也跑不动，
 * 这种只给数量和大小，老师走下载 / 导入 zip。
 */
export const TEST_CASE_EDIT_MAX_CASES = 100
export const TEST_CASE_EDIT_MAX_FILE_BYTES = 32 * 1024

export const testCaseFilesSchema = z.discriminatedUnion("editable", [
  z.object({
    editable: z.literal(true),
    cases: z.array(z.object({ input: z.string(), output: z.string() })),
  }),
  z.object({
    editable: z.literal(false),
    count: z.number().int(),
    totalBytes: z.number().int(),
  }),
])

/**
 * 出题页的语法要求：每条规则学生看到的那句话，以及标准答案自己过不过（规则配错时
 * 标准答案也过不了）。`code` 给空串就只要那句话，`passed` 为 null
 */
export const astCheckRequestSchema = z.object({
  language: runnableLanguageSchema,
  code: z.string().max(1024 * 1024),
  rules: z.array(astRuleSchema).min(1).max(50),
})

export const astCheckResponseSchema = z.object({
  rules: z.array(
    z.object({
      description: z.string(),
      passed: z.boolean().nullable(),
      actual: z.number().int().optional(),
    }),
  ),
})

/** AI 按题面和标准答案想几组测试输入（输出由标准答案在判题机上跑，不让 AI 编） */
export const generateTestInputsRequestSchema = z.object({
  description: z.string().max(64 * 1024),
  inputDescription: z.string().max(16 * 1024),
  language: runnableLanguageSchema,
  answer: z
    .string()
    .min(1)
    .max(64 * 1024),
  existing: z.array(z.string().max(4096)).max(100),
})

export const generateTestInputsResponseSchema = z.object({ inputs: z.array(z.string()) })

export type AdminAchievement = z.infer<typeof adminAchievementSchema>
export type AchievementMetric = z.infer<typeof achievementMetricSchema>

export type AdminProblem = z.infer<typeof adminProblemSchema>
export type AdminProblemListItem = z.infer<typeof adminProblemListItemSchema>
export type AdminProblemList = z.infer<typeof adminProblemListSchema>
export type CreateProblemRequest = z.infer<typeof createProblemRequestSchema>

export type AdminContest = z.infer<typeof adminContestSchema>
export type AdminContestList = z.infer<typeof adminContestListSchema>
export type AdminContestListItem = z.infer<typeof adminContestListItemSchema>
export type AdminUser = z.infer<typeof adminUserSchema>
export type AdminUserList = z.infer<typeof adminUserListSchema>
export type CheckUsernamesResponse = z.infer<typeof checkUsernamesResponseSchema>
export type JudgeServer = z.infer<typeof judgeServerSchema>
export type DashboardInfo = z.infer<typeof dashboardInfoSchema>
export type JudgeServerList = z.infer<typeof judgeServerListSchema>
export type OrphanTestCase = z.infer<typeof orphanTestCaseSchema>
export type AdminUserRank = z.infer<typeof adminUserRankSchema>

export type AdminAiReportListItem = z.infer<typeof adminAiReportListItemSchema>
export type AdminAiReport = z.infer<typeof adminAiReportSchema>
export type AdminAiReportList = z.infer<typeof adminAiReportListSchema>
export type StuckProblem = z.infer<typeof stuckProblemSchema>
export type StuckStudent = z.infer<typeof stuckStudentSchema>
export type StuckProblemDetail = z.infer<typeof stuckProblemDetailSchema>
export type GradeTrendProblem = z.infer<typeof gradeTrendProblemSchema>
export type LearnBoard = z.infer<typeof learnBoardSchema>
export type LearnBoardStudent = z.infer<typeof learnBoardStudentSchema>
export type LearnExerciseProgress = z.infer<typeof learnExerciseProgressSchema>
export type LearnExerciseProgressList = z.infer<typeof learnExerciseProgressListSchema>
export type LearnExerciseAttempt = z.infer<typeof learnExerciseAttemptSchema>

export type AdminTag = z.infer<typeof adminTagSchema>
export type RenameTagResponse = z.infer<typeof renameTagResponseSchema>
export type BatchProblemTagResponse = z.infer<typeof batchProblemTagResponseSchema>
export type SqlTestCaseScript = z.infer<typeof sqlTestCaseScriptSchema>
export type GenerateSqlTestCaseResponse = z.infer<typeof generateSqlTestCaseResponseSchema>
export type TestCaseFiles = z.infer<typeof testCaseFilesSchema>
export type AstCheckRequest = z.infer<typeof astCheckRequestSchema>
export type AstCheckResponse = z.infer<typeof astCheckResponseSchema>
export type GenerateTestInputsRequest = z.infer<typeof generateTestInputsRequestSchema>
export type GenerateTestInputsResponse = z.infer<typeof generateTestInputsResponseSchema>

export type AdminAnnouncementList = z.infer<typeof adminAnnouncementListSchema>
export type CreateAnnouncementRequest = z.infer<typeof createAnnouncementRequestSchema>
export type UpdateAnnouncementRequest = z.infer<typeof updateAnnouncementRequestSchema>
export type TutorialType = z.infer<typeof tutorialTypeSchema>
export type AdminTutorial = z.infer<typeof adminTutorialSchema>
export type AdminTutorialListItem = z.infer<typeof adminTutorialListItemSchema>
export type AdminTutorialGroups = z.infer<typeof adminTutorialGroupsSchema>
export type AdminTutorialProblem = z.infer<typeof adminTutorialProblemSchema>
export type TutorialProblemCandidate = z.infer<typeof tutorialProblemCandidateSchema>
export type SetTutorialProblemsRequest = z.infer<typeof setTutorialProblemsRequestSchema>
export type ReorderTutorialsRequest = z.infer<typeof reorderTutorialsRequestSchema>
export type RenameTutorialProjectRequest = z.infer<typeof renameTutorialProjectRequestSchema>
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
export type AdminProblemSet = z.infer<typeof adminProblemSetSchema>
export type AdminProblemSetList = z.infer<typeof adminProblemSetListSchema>
export type CreateProblemSetRequest = z.infer<typeof createProblemSetRequestSchema>
export type UpdateProblemSetRequest = z.infer<typeof updateProblemSetRequestSchema>
export type AdminProblemSetProblem = z.infer<typeof adminProblemSetProblemSchema>
export type AddProblemsToSetRequest = z.infer<typeof addProblemsToSetRequestSchema>
export type AddProblemsToSetResult = z.infer<typeof addProblemsToSetResultSchema>
export type ReorderProblemSetProblemsRequest = z.infer<
  typeof reorderProblemSetProblemsRequestSchema
>
export type UpdateProblemInSetRequest = z.infer<typeof updateProblemInSetRequestSchema>
export type AdminProblemSetBadge = z.infer<typeof adminProblemSetBadgeSchema>
export type CreateProblemSetBadgeRequest = z.infer<typeof createProblemSetBadgeRequestSchema>
export type UpdateProblemSetBadgeRequest = z.infer<typeof updateProblemSetBadgeRequestSchema>
export type RenameTagRequest = z.infer<typeof renameTagRequestSchema>
export type BatchProblemTagRequest = z.infer<typeof batchProblemTagRequestSchema>
export type BatchProblemVisibleRequest = z.infer<typeof batchProblemVisibleRequestSchema>
export type GenerateFlowchartRequest = z.infer<typeof generateFlowchartRequestSchema>
export type GenerateFlowchartResponse = z.infer<typeof generateFlowchartResponseSchema>
export type UpdateProblemRequest = z.infer<typeof updateProblemRequestSchema>
export type MakeProblemPublicRequest = z.infer<typeof makeProblemPublicRequestSchema>
export type AddContestProblemRequest = z.infer<typeof addContestProblemRequestSchema>
export type TestCaseEntry = z.infer<typeof testCaseEntrySchema>
export type UploadTestCaseResponse = z.infer<typeof uploadTestCaseResponseSchema>
export type SqlPreviewRequest = z.infer<typeof sqlPreviewRequestSchema>
export type GenerateSqlTestCaseRequest = z.infer<typeof generateSqlTestCaseRequestSchema>

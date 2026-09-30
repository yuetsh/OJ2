import { z } from "zod"

import { judgeStatusSchema } from "./judge-status"
import { runnableLanguageSchema } from "./language"

export const classRankItemSchema = z.object({
  className: z.string(),
  userCount: z.number().int(),
  totalAc: z.number().int(),
  totalSubmission: z.number().int(),
  avgAc: z.number(),
  acRate: z.number(),
  rank: z.number().int(),
})

export const classUserRankItemSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  acceptedNumber: z.number().int(),
  submissionNumber: z.number().int(),
  rank: z.number().int(),
})

export const classUserRankSchema = z.object({
  className: z.string(),
  myRank: z.number().int(),
  total: z.number().int(),
  ranks: z.array(classUserRankItemSchema),
})

export const classComparisonSchema = z.object({
  className: z.string(),
  userCount: z.number().int(),
  totalAc: z.number().int(),
  totalSubmission: z.number().int(),
  avgAc: z.number(),
  medianAc: z.number(),
  q1Ac: z.number(),
  q3Ac: z.number(),
  iqr: z.number(),
  stdDev: z.number(),
  top10Avg: z.number(),
  middle80Avg: z.number(),
  bottom10Avg: z.number(),
  excellentRate: z.number(),
  passRate: z.number(),
  activeRate: z.number(),
  acRate: z.number(),
  compositeScore: z.number(),
  recentTotalAc: z.number().int().optional(),
  recentTotalSubmission: z.number().int().optional(),
  recentAvgAc: z.number().optional(),
  recentMedianAc: z.number().optional(),
  recentTop10Avg: z.number().optional(),
  recentActiveCount: z.number().int().optional(),
})

export const classComparisonRequestSchema = z.object({
  classNames: z.array(z.string()).min(1),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
})

export const classComparisonResponseSchema = z.object({
  comparisons: z.array(classComparisonSchema),
  hasTimeRange: z.boolean(),
})

/**
 * 「班里在做」：同班同一天有好几个人做的题，基本就是老师在课上点名的那几道。
 * `day` 是东八区日历日；最近 7 天都没有这样的题时为 null，`problems` 为空。
 */
export const classActivityProblemSchema = z.object({
  problemDisplayId: z.string(),
  title: z.string(),
  /** 那天做过这道题的同班人数（含自己） */
  userCount: z.number().int(),
  /** 其中那天通过了的人数 */
  acceptedCount: z.number().int(),
  /**
   * 我自己在题库里（不含比赛）做这道题的状态，不限那一天。老师布置时选了语言的，
   * 代码只认用那个语言交的（流程图照旧算）
   */
  myStatus: z.enum(["accepted", "tried", "none"]),
})

/**
 * 老师布置这节课时选的语言（Python / C / C++）。null = 没选：推断出来的课、加这一项之前
 * 布置的课。选了之后这份作业「做完」只认这个语言交对的，学生打开这几道题编辑器默认就是它
 */
const lessonLanguageSchema = runnableLanguageSchema.nullable()

export const classActivitySchema = z.object({
  className: z.string().nullable(),
  day: z.string().nullable(),
  /** teacher = 老师在课堂看板里布置的；inferred = 从同班提交记录推断的 */
  source: z.enum(["teacher", "inferred"]).nullable(),
  language: lessonLanguageSchema,
  problems: z.array(classActivityProblemSchema),
})

/**
 * 首页的「上次来」卡（原来登录后弹的「登录速报」并进了首页，AI 那两句不要了）。
 * 窗口是**上次登录到这次登录之间**，不是到现在 —— 这次登录期间卡片内容不变，
 * 今天做的题不会混进「上次」里。只算题库提交，比赛的题号在题库里点不开。
 */
export const lastVisitSchema = z.object({
  /** 上次登录的时刻。null = 头一回登录（或会话早于这个字段） */
  previousLogin: z.string().nullable(),
  /** null = 上次来已经是 30 天以前，或那次一条代码都没交 */
  summary: z
    .object({
      submissionCount: z.number().int(),
      /** 那次做对的题数（去重） */
      solvedCount: z.number().int(),
      /** 那次最后一条提交的时刻，前端拿它和「班里那天」比是不是同一天 */
      lastSubmitTime: z.string(),
      /**
       * 那次交过、**到现在都还没做对**的题（这次登录后补做对了的不算），
       * 按最后一次提交倒序，最多 3 道
       */
      unsolved: z.array(
        z.object({
          problemDisplayId: z.string(),
          title: z.string(),
          attempts: z.number().int(),
          lastResult: judgeStatusSchema,
        }),
      ),
      /** 那次做对的题，按第一次做对的先后，最多 12 道（总数看 solvedCount） */
      solved: z.array(z.object({ problemDisplayId: z.string(), title: z.string() })),
    })
    .nullable(),
})

/**
 * 课堂看板里老师布置这节课的题：按输入顺序给展示题号，最多 20 道，空数组 = 清掉。
 * `language` 是这份作业用什么语言做；不传当 null（上线时还开着的旧看板页面不带它）
 */
export const classLessonRequestSchema = z.object({
  className: z.string().trim().min(1),
  problemDisplayIds: z.array(z.string().trim().min(1)).max(20),
  language: lessonLanguageSchema.optional(),
})

export const classBoardProblemSchema = z.object({
  problemId: z.number().int(),
  problemDisplayId: z.string(),
  title: z.string(),
})

export const classBoardCellSchema = z.object({
  /**
   * accepted 看的是题库里（不含比赛）有没有通过过，不限今天 —— 以前做过的也算做完。
   * 布置时选了语言的，代码的次数和通过都只数那个语言（流程图照旧）
   */
  status: z.enum(["accepted", "tried", "none"]),
  /** 今天在这道题上交了几次（代码 + 流程图） */
  attempts: z.number().int(),
  /**
   * 上面那个数拆开：代码几次、流程图几次。点格子要知道该跳到提交列表的哪一边 ——
   * 这节课整班在画流程图时，跳到代码那边是一片空
   */
  codeAttempts: z.number().int(),
  flowchartAttempts: z.number().int(),
  /** 第一次通过的时刻；今天之前通过的，前端显示成「之前」 */
  acceptedAt: z.string().nullable(),
})

export const classBoardStudentSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  realName: z.string().nullable(),
  /** 和 problems 同序 */
  cells: z.array(classBoardCellSchema),
  /** 今天最后一次提交（任何题），没交过为 null */
  lastSubmitAt: z.string().nullable(),
  /**
   * 今天交过**非比赛**的代码 / 画过流程图没有。点名字跳提交列表用：lastSubmitAt 把比赛提交
   * 也算进去了，而提交列表只列非比赛的，只看它会跳到一个空列表
   */
  codeToday: z.boolean(),
  drawnToday: z.boolean(),
  /** 最近几节课（不含今天，个数见 ClassBoard.recentLessons）里交过题的有几节 */
  recentAttended: z.number().int(),
})

/**
 * 课堂看板：一个班、今天、这节课的几道题 × 全班学生。
 * className 为 null = 没指定班级、最近两小时也没有哪个班在交（没法猜）。
 */
export const classBoardSchema = z.object({
  className: z.string().nullable(),
  day: z.string(),
  source: z.enum(["teacher", "inferred"]).nullable(),
  /** 今天布置的语言（见 lessonLanguageSchema） */
  language: lessonLanguageSchema,
  /** 这个班最近一次布置选的语言（含今天），给语言下拉当默认值；从没选过为 null */
  lastLanguage: lessonLanguageSchema,
  problems: z.array(classBoardProblemSchema),
  students: z.array(classBoardStudentSchema),
  /**
   * 「最近几节课」一共几节（最多 5，不含今天）。一节课 = 这个班同学一起做题的一天
   * （同班同一天 ≥ 5 人做同一道题，和「班里在做」同一个判据）。新班、开学头几周不满 5。
   */
  recentLessons: z.number().int(),
})

/**
 * 提交列表「这节课」那颗按钮要的：哪个班、这节课是哪几道题。和课堂看板同一套取法
 * （老师布置过就用布置的，否则按今天同班提交推断），但不带花名册 —— 列表只拿它当筛选条件。
 * className 为 null = 没指定、最近两小时也没有哪个班在交。
 */
export const classLessonSchema = z.object({
  className: z.string().nullable(),
  source: z.enum(["teacher", "inferred"]).nullable(),
  /** 选了语言时，列表那边连语言一起筛 */
  language: lessonLanguageSchema,
  problems: z.array(z.object({ problemDisplayId: z.string(), title: z.string() })),
})

export type ClassRankItem = z.infer<typeof classRankItemSchema>
export type ClassUserRank = z.infer<typeof classUserRankSchema>
export type ClassComparison = z.infer<typeof classComparisonSchema>
export type ClassComparisonResponse = z.infer<typeof classComparisonResponseSchema>

export type ClassActivity = z.infer<typeof classActivitySchema>
export type LastVisit = z.infer<typeof lastVisitSchema>
export type ClassLessonRequest = z.infer<typeof classLessonRequestSchema>
export type ClassBoard = z.infer<typeof classBoardSchema>
export type ClassLesson = z.infer<typeof classLessonSchema>
export type ClassBoardProblem = z.infer<typeof classBoardProblemSchema>
export type ClassBoardStudent = z.infer<typeof classBoardStudentSchema>
export type ClassBoardCell = z.infer<typeof classBoardCellSchema>
export type ClassActivityProblem = z.infer<typeof classActivityProblemSchema>

export type ClassUserRankItem = z.infer<typeof classUserRankItemSchema>
export type ClassComparisonRequest = z.infer<typeof classComparisonRequestSchema>

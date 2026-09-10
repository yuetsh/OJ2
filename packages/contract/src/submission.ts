import { z } from "zod"

import { paginatedSchema } from "./common"
import { problemLanguageSchema } from "./language"

export const judgeStatusSchema = z.union([
  z.literal(-2),
  z.literal(-1),
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(10),
])

/**
 * 判题机原始输出（`submission.info` 的 JSONB 原文）。
 *
 * 形状按**生产库 124191 条提交实测**得出，不是照着前端那份额外手抄的：
 *
 * - `err` 实测 124191 条**全是 null**，从来没见过字符串 —— 但契约仍留 `string`，
 *   因为判题机层面它是有意义的通道，收紧成 `z.null()` 会在它第一次真的报错时炸。
 * - `data` 有 **12048 条是 null**（编译失败等没有逐测试点结果的情形），
 *   所以它必须 nullable。前端原来手抄的 `Info` 把 data 写成了非空数组，
 *   这 12048 条在类型上根本不成立，只是没有一处会去读它才没炸。
 * - 数组项比前端手抄的多三处：SQL 判题多带 `error_message`（201 个测试点）、
 *   部分带 `score`（10 个）。所以这里的字段一律可选，不用 strictObject。
 *
 * 键名是**判题沙箱定的 snake_case**，不要跟着响应字段一起改。
 */
export const judgeCaseResultSchema = z.object({
  error: z.number(),
  memory: z.number(),
  output: z.string().nullable(),
  result: judgeStatusSchema,
  signal: z.number(),
  cpu_time: z.number(),
  exit_code: z.number(),
  real_time: z.number(),
  test_case: z.string(),
  output_md5: z.string(),
  /** SQL 判题会带上中文原因，沙箱判题没有这个键 */
  error_message: z.string().optional(),
  score: z.number().optional(),
})

export const judgeInfoSchema = z.object({
  err: z.string().nullable(),
  data: z.array(judgeCaseResultSchema).nullable(),
})

/**
 * `info` 允许的两种取值，**不能只写成完整形状**：
 *
 * 1. 完整形状：判题机写的 JSONB 原文；
 * 2. **空对象**：后端对非管理员用 `info: {}` 下发的占位（`routes/submission.ts:841`
 *    的 `full ? row.submission.info : {}`），同一个空对象也是插入待判提交时的初值。
 *
 * 第 2 种是真实存在的合法取值，收紧成只认完整形状会让**每一条非管理员看的提交详情
 * 直接 500**（`submissionDetailSchema.parse` 在路由里抛，被 onError 兜成 internal-error）。
 * 这不是假想：收紧当天就在本地实测复现了。
 *
 * 换句话说，空对象表达的是「这条响应对你不含 info」，一个**权限投影**，
 * 而不是「字段缺失」—— 契约要如实描述它。
 */
export const submissionInfoSchema = z.union([judgeInfoSchema, z.object({})])

/**
 * 判题产出的统计（`submission.statistic_info` 的 JSONB 原文）。
 *
 * 五个键全部可选，依据是生产库实测的出现次数：time_cost / memory_cost 各 112097、
 * score 3993、err_info 3153、ast_results 56，另有 27 条空对象。
 *
 * **不能用严格对象。** 有 8916 条历史记录里的 JSONB 原文内嵌了带转义的 shell
 * 输出、本身不是合法 JSON，后端 `objectValue()` 会把它兜成 `{ value: "<原串>" }`
 * 再下发 —— 严格 schema 会把这 8916 条判成契约分歧，而它们其实是正常的失败记录。
 */
export const statisticInfoSchema = z.object({
  score: z.number().optional(),
  /** 判题机写进 statistic_info 的错误文本，教师面板的「最近一条错在哪」也读它 */
  err_info: z.string().optional(),
  time_cost: z.number().optional(),
  memory_cost: z.number().optional(),
  ast_results: z.array(
    z.object({
      description: z.string(),
      passed: z.boolean(),
      /** count_* 规则实际数到的次数，判题机只在这两个引擎上写 */
      actual: z.number().optional(),
    }),
  ).optional(),
})

export const createSubmissionRequestSchema = z.object({
  problemId: z.number().int().positive(),
  /**
   * 提交的语言。用题目语言的联合而不是 `z.string()` —— 学生能选的语言就是题目
   * `languages` 里列出的那些，写宽松了的话，前端把语言拼错（`"C＋＋"`、`"python3"`
   * 大小写）会一路走到判题机才以 `Unsupported judge language` 报系统错误，
   * 学生看到的是「系统错误」而不是「语言不对」。
   */
  language: problemLanguageSchema,
  code: z.string().min(1).max(1024 * 1024),
  contestId: z.number().int().positive().optional(),
  /**
   * 来源题单。学生从 `/problemset/:id/problem/:pid` 那个入口提交时前端带上，
   * 后端落进 `submission.problemset_id`，提交列表据此标出「这条是刷题单刷出来的」。
   *
   * 只是**来源标记**，不参与判题、也不参与题单进度记账 —— 进度由判完之后的
   * `recordSolvedProblem` 记进所有已加入且含这道题的题单，和从哪个入口进来无关。
   * 所以这里带错了顶多是标记不准，不会影响成绩。
   */
  problemSetId: z.number().int().positive().optional(),
})

export const createSubmissionResponseSchema = z.object({
  submissionId: z.string(),
})

export const submissionDetailSchema = z.object({
  id: z.string(),
  createTime: z.string(),
  userId: z.number().int(),
  username: z.string(),
  code: z.string(),
  result: judgeStatusSchema,
  /** 未判完或非管理员看时为 `{}`，见 submissionInfoSchema 的注释 */
  info: submissionInfoSchema,
  language: problemLanguageSchema,
  statisticInfo: statisticInfoSchema,
  contestId: z.number().int().nullable(),
  problemId: z.number().int(),
  /**
   * 题目的展示编号（problem._id）。**独立的 /submission/:id 页面要靠它** ——
   * 那条路由只喂 submissionID，组件拿不到 display id，而「复制回到题目」要用它
   * 拼路由。原来只给内部数字 id，于是那个按钮在这条路由上一点就抛
   * `Missing required param "problemID"`。
   */
  problemDisplayId: z.string(),
  showLink: z.boolean(),
})

/**
 * 内嵌在别处（目前只有站内信）的提交对象。对齐旧后端的
 * `SubmissionSafeModelSerializer(exclude=("info", "contest", "ip"))` ——
 * 这些键**根本不出现**，而不是出现但值为空。（`ip` 已随 IP 功能整体删除。）
 *
 * 独立成一个 schema 而不是复用 submissionDetailSchema 传空值：形状一致了，
 * 将来有人「顺手」把空值改成真值就不会变成泄露，因为这里压根没有这些字段。
 */
export const embeddedSubmissionSchema = submissionDetailSchema
  .omit({ info: true, contestId: true, problemId: true })
  // 旧 SubmissionSafeModelSerializer 里 problem 是
  // `SlugRelatedField(slug_field="_id")`，即**展示用题号**而非数字主键。
  // 站内信页面拿它拼 `/problem/<题号>` 链接，给数字 id 会拼出打不开的地址。
  .extend({ problem: z.string() })

/**
 * 判题进度推送。**只带前端真正要用的东西**：靠 submissionId 认领、靠 result /
 * status 决定是继续等还是去拉详情。
 *
 * 这里曾经还带着 time_cost / memory_cost / err_info —— 从 statistic_info 原样
 * 抄一份出来，前端一处都没读过。耗时和错误信息在提交详情里本来就有，判完了去
 * 拉一次就是了，不必让推送顺带背一份 JSONB 的形状。
 */
export const submissionUpdateSchema = z.object({
  type: z.literal("submission_update"),
  submissionId: z.string(),
  result: judgeStatusSchema,
  status: z.enum(["pending", "judging", "finished", "error"]),
  score: z.number().optional(),
})

export const submissionListItemSchema = z.object({
  id: z.string(),
  problem: z.string(),
  problemTitle: z.string(),
  showLink: z.boolean(),
  createTime: z.string(),
  userId: z.number().int(),
  username: z.string(),
  result: judgeStatusSchema,
  language: problemLanguageSchema,
  statisticInfo: statisticInfoSchema,
  /**
   * 来源题单，非题单入口提交的为 null。比赛提交恒为 null（比赛题不会进题单）。
   * 历史提交里只有「当年首次 AC 那一条」有值 —— 迁移 0007 从 problemset_submission
   * 回填的就是这些，其余老提交无从判断入口，一律留空。
   */
  problemSet: z.object({ id: z.number().int(), title: z.string() }).nullable(),
})

export const submissionListSchema = paginatedSchema(submissionListItemSchema)

/**
 * **一条都没交**的学生。`realName` 是从用户名里剥掉 `ks<班级号>` 前缀后剩下的那一段，
 * 不是 user.real_name 列 —— 与 F2「真名默认不下发」不冲突：这里只有教师能看到，
 * 且教师面板的用途正是点名谁没做。
 *
 * 注意它不是「未完成」的全部：交了但一次没对的学生在 `dataAttempted` 里。
 */
export const unacceptedStudentSchema = z.object({
  username: z.string(),
  realName: z.string(),
})

/**
 * **交了但一次没对**的学生。这批人原来两栏都不在 —— 不在「完成人数」（没 AC），
 * 也不在「未完成」名单（那一栏只收一条没交的），于是课堂上最该去看一眼的人
 * 反而从屏幕上消失了。`submissionCount` 是窗口内的提交次数，教师据此判断
 * 「卡了多久」。
 */
export const attemptedStudentSchema = unacceptedStudentSchema.extend({
  submissionCount: z.number().int(),
  /**
   * 已经解决的题数。查多道题时这一栏里混着「一道没对」和「三道做出两道」两种人，
   * 差几道决定了老师先管谁 —— 所以名字后面要缀 `2/3`。
   */
  solvedCount: z.number().int(),
  /**
   * 最近一条提交错在哪。教师点名字就能看到「是编译错了还是答案错了」，
   * 不必再切去提交列表翻这个人。`error` 是判题机写进 statistic_info 的 err_info，
   * 已截断；没有错误文本（比如答案错误那种）时为 null。
   */
  lastFailure: z
    .object({
      id: z.string(),
      /** 题目的展示编号，用来告诉老师错在哪道题 */
      problem: z.string(),
      result: judgeStatusSchema,
      error: z.string().nullable(),
    })
    .nullable(),
})

export const submissionStatisticsUserSchema = z.object({
  username: z.string(),
  className: z.string().nullable(),
  submissionCount: z.number().int(),
  /** 通过的**提交条数**。correctRate 的分子就是它 */
  acceptedCount: z.number().int(),
  /**
   * 解决的**题数**（同一道题重复 AC 只算一道）。表格「已解决」那一列显示的是它 ——
   * 不指定题号查「这节课全班」时，条数和题数能差出好几倍。
   */
  solvedCount: z.number().int(),
  /**
   * 「答案对了但语法没按要求写」且**最后也没改对**的题数。这些题算在 solvedCount 里
   * （AST_CHECK_FAILED 全站都算通过），单列出来只是让教师看得见教学上没达标的那几个。
   */
  astOnlyCount: z.number().int(),
  /** 这个人还在判题队列里的条数。`submissionCount` 含它，`correctRate` 的分母不含 */
  judgingCount: z.number().int(),
  // 百分比数值，不带 %。旧后端返回 "85.5%" 字符串，展示格式化交给前端。
  correctRate: z.number(),
  /**
   * 这个人在本次查询的口径下做完了没有（查了 N 道题就要 N 道都解决）。
   *
   * `data` 里**没做完的人也在**，教师才能在同一张表里展开看他错在哪；「完成人数」
   * 和完成度算的是 `done` 为真的那些，不是 `data.length`。
   */
  done: z.boolean(),
})

/**
 * 展开行的明细，**按需拉**（GET /submissions/statistics/items）。
 *
 * 原来是随统计一起给每个人各带一份，可表格一次只展开一行 —— 生产快照上那是
 * 4.9 万行没人看的数据。`truncated` 为真时前端要说明「只显示最近 N 条」，
 * 免得老师以为这人就交了这么多。
 */
export const submissionStatisticsItemsSchema = z.object({
  items: z.array(z.object({ id: z.string(), result: judgeStatusSchema })),
  truncated: z.boolean(),
})

export const submissionStatisticsSchema = z.object({
  submissionCount: z.number().int(),
  acceptedCount: z.number().int(),
  /**
   * 还没判完的条数（PENDING / JUDGING）。`submissionCount` 把它算在内，
   * `correctRate` 的分母不算 —— 全班同时交卷的那几秒，分母涨了分子没涨，
   * 正确率会凭空掉一截。下发它是为了让教师看得出「那几条还在判」。
   */
  judgingCount: z.number().int(),
  correctRate: z.number(),
  // 花名册人数（未禁用的普通用户）。**只有这一个分母下发**：完成度由前端算，
  // 因为「请假隐藏」会把请假的人从分母里减掉，那是后端不知道的浏览器本地状态。
  personCount: z.number().int(),
  /** 窗口里交过东西的所有人（做没做完看 `done`），按提交数倒序 */
  data: z.array(submissionStatisticsUserSchema),
  /** 一条都没交的（花名册里的人减去有提交的人） */
  dataUnaccepted: z.array(unacceptedStudentSchema),
  /**
   * 交了但没做完的（一道没对，或者查三道只做出两道）。
   *
   * 传了用户名时按花名册取，和 dataUnaccepted 同一个范围；不传用户名时没有花名册，
   * 退回「窗口内有提交但没做完的全部普通学生」—— 否则这批人两栏都不在，看起来
   * 就像统计只认成功的提交。dataUnaccepted 没有花名册就真的算不出来，仍然为空。
   */
  dataAttempted: z.array(attemptedStudentSchema),
})

export const formatCodeRequestSchema = z.object({
  code: z.string().max(1024 * 1024),
  language: z.enum(["python", "c", "cpp", "sql"]),
})

export const formatCodeResponseSchema = z.object({ code: z.string() })

export type JudgeStatus = z.infer<typeof judgeStatusSchema>
export type JudgeInfo = z.infer<typeof judgeInfoSchema>
export type JudgeCaseResult = z.infer<typeof judgeCaseResultSchema>
export type StatisticInfo = z.infer<typeof statisticInfoSchema>
export type CreateSubmissionRequest = z.infer<
  typeof createSubmissionRequestSchema
>
export type SubmissionDetail = z.infer<typeof submissionDetailSchema>
export type SubmissionUpdate = z.infer<typeof submissionUpdateSchema>
export type SubmissionStatistics = z.infer<typeof submissionStatisticsSchema>
export type SubmissionStatisticsUser = z.infer<
  typeof submissionStatisticsUserSchema
>
export type SubmissionStatisticsItems = z.infer<
  typeof submissionStatisticsItemsSchema
>
export type UnacceptedStudent = z.infer<typeof unacceptedStudentSchema>
export type AttemptedStudent = z.infer<typeof attemptedStudentSchema>

export type SubmissionListItem = z.infer<typeof submissionListItemSchema>
export type SubmissionList = z.infer<typeof submissionListSchema>
export type EmbeddedSubmission = z.infer<typeof embeddedSubmissionSchema>
export type CreateSubmissionResponse = z.infer<typeof createSubmissionResponseSchema>
export type FormatCodeResponse = z.infer<typeof formatCodeResponseSchema>

export type FormatCodeRequest = z.infer<typeof formatCodeRequestSchema>

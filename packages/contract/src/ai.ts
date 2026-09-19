import { z } from "zod"

/**
 * 评级。`grade()` 返回 S/A/B/C，`averageGrade()` 在没有可用数据时返回空串 ——
 * 空串是真会下发的值，别把它从这里去掉，前端要按「无评级」处理。
 */
export const gradeSchema = z.enum(["S", "A", "B", "C", ""])

export const durationDataSchema = z.object({
  unit: z.string(),
  index: z.number().int(),
  start: z.string(),
  end: z.string(),
  grade: gradeSchema,
  problemCount: z.number().int(),
  /** 该周期内判为通过的提交数。problemCount 是去重后的题数，两者不能互相代替 */
  acceptedCount: z.number().int(),
  submissionCount: z.number().int(),
})

export const solvedProblemSchema = z.object({
  problem: z.object({
    title: z.string(),
    displayId: z.string(),
    contestTitle: z.string(),
    contestId: z.number().int().nullable(),
  }),
  acTime: z.string(),
  rank: z.number().int().nullable(),
  acCount: z.number().int(),
  grade: gradeSchema,
  periodRank: z.number().int().nullable(),
  periodAcCount: z.number().int(),
  difficulty: z.string(),
  /** 到首次通过为止在这道题上提交了几次（含通过那次）。1 就是一次过 */
  attempts: z.number().int(),
})

export const flowchartSummarySchema = z.object({
  problemId: z.string(),
  problemTitle: z.string(),
  submissionCount: z.number().int(),
  bestScore: z.number(),
  bestGrade: z.string(),
  latestSubmissionTime: z.string(),
  avgScore: z.number(),
})

/**
 * 时间活跃度的一个格子。星期和时段都按东八区切，和热力图同一个口径 ——
 * 别让容器或数据库的 TZ 决定「学生周几晚上做题多」。
 */
export const activityBucketSchema = z.object({
  /** 0=周日 … 6=周六 */
  weekday: z.number().int().min(0).max(6),
  /** 0=凌晨(0-6) 1=上午(6-12) 2=下午(12-18) 3=晚上(18-24) */
  period: z.number().int().min(0).max(3),
  count: z.number().int(),
})

export const aiDetailSchema = z.object({
  user: z.string(),
  className: z.string().nullable(),
  start: z.string(),
  end: z.string(),
  /**
   * 区间内做出来的题数。逐题明细走 `GET /ai/solved` 分页拿 ——
   * 一个活跃学生一年能做几百道，整份塞进这个响应没有必要。
   */
  solvedCount: z.number().int(),
  /** 每道做出来的题「到首次通过为止提交了几次」，分档放在前端 */
  attempts: z.array(z.number().int()),
  flowcharts: z.array(flowchartSummarySchema),
  grade: gradeSchema,
  tags: z.record(z.string(), z.number().int()),
  difficulty: z.record(z.string(), z.number().int()),
  contestCount: z.number().int(),
  /** 时间活跃度：按**全部提交**统计，不是只统计 AC */
  activity: z.array(activityBucketSchema),
  /**
   * 判完的失败提交按状态码分组，多的在前。状态码是落库的值，
   * 前端用 utils/constants 的 JUDGE_STATUS 翻成中文，两边必须一致。
   */
  errors: z.array(
    z.object({
      result: z.number().int(),
      count: z.number().int(),
    }),
  ),
  /**
   * solved 里的 rank/acCount 是在哪个范围里排的。班里只有一个人时后端会回退到全服，
   * 前端不能只看 className 有没有值就写「班级排名」。
   */
  rankScope: z.enum(["class", "global"]),
})

/**
 * 请求只说「看谁、哪段时间、按什么粒度」，学情数据由服务端自己算。
 * 以前是 `details: z.unknown()` / `duration: z.unknown()` —— 前端算好的整包 POST 回去，
 * 原样进 prompt 又原样写进 ai_analysis 表，等于让任何登录用户决定喂给模型什么。
 */
/** GET /ai/solved 的分页响应 */
export const solvedListSchema = z.object({
  results: z.array(solvedProblemSchema),
  total: z.number().int(),
})

export const aiAnalysisRequestSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  duration: z.string().min(1),
  username: z.string().optional(),
})

/**
 * 解锁「让 AI 分析我的代码」所需的失败提交数。前端拿它决定按钮露不露面、
 * 后端拿它卡 POST /ai/hint —— 放在契约里就是为了不让两边各写一个 3。
 *
 * 编译失败不受这个门槛限制：报错只关乎语法、不涉及解法，而英文编译报错恰恰是
 * 零基础学生最先撞上、最容易直接放弃的那堵墙。
 */
export const HINT_MIN_FAILURES = 3

export const aiHintRequestSchema = z.object({ submissionId: z.string().min(1) })

/**
 * AI 提示第一段「诊断」给错误归的类。**key 是落库的值（`ai_hint.diagnosis.tag`），
 * 和判题状态码一样只能新增、不能改已有 key 的含义** —— 教师端的学情统计要按它聚合。
 * `label` 只是给人看的说明，可以改措辞。
 *
 * 口径按中职入门的 C / Python 定的。`output_format` 刻意写细：多余的输入提示语、
 * 全角冒号、多一个空格、小数位数，是这批学生最常见、也最冤的一类 WA。
 */
export const HINT_ERROR_TAGS = {
  syntax: "语法错误",
  input_format: "输入读取方式不对（格式、分隔、个数）",
  output_format:
    "输出格式不对（多余的输入提示语、全角/半角符号、多余空格或换行、小数位数）",
  condition: "条件判断写错（比较符、漏了分支）",
  loop_bound: "循环次数或边界不对（差一）",
  integer_division: "整数除法或取余用错",
  type_overflow: "数据类型不对或溢出（int 不够、浮点精度）",
  uninitialized: "变量没初始化，或累加器没清零",
  missing_case: "漏了特殊情况（0、负数、边界值）",
  runtime_error: "运行时错误（下标越界、除以零）",
  timeout: "超时（算法太慢或死循环）",
  wrong_approach: "思路整体不对",
  other: "其他，或者看不出来",
} as const

export type HintErrorTag = keyof typeof HINT_ERROR_TAGS

/**
 * 诊断的出参。**只有枚举和数字，不允许任何自由文本** —— 诊断那一段能看到标准答案，
 * 学生代码又是它的输入，出参里只要有一段文字就是一条把答案带出去的通道。
 * 这样注入最多能左右一个枚举值和两个行号。多出来的字段被 zod 剥掉。
 */
export const hintDiagnosisSchema = z.object({
  tag: z.enum(
    Object.keys(HINT_ERROR_TAGS) as [HintErrorTag, ...HintErrorTag[]],
  ),
  /** 问题所在的行号区间（从 1 起，含两端）；说不准就是 null */
  lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]).nullable(),
  confidence: z.enum(["high", "low"]),
})

export type HintDiagnosis = z.infer<typeof hintDiagnosisSchema>

/**
 * 学生对一条 AI 提示的评价（POST /ai/hint/:id/feedback）。提示的 id 由 /ai/hint 流的
 * `done` 事件带回来。可以改票，以最后一次为准。
 */
export const aiHintFeedbackRequestSchema = z.object({ helpful: z.boolean() })

export const classAnalysisRequestSchema = z.object({
  comparison: z.record(z.string(), z.unknown()),
})

export const classPkAnalysisRequestSchema = z.object({
  comparisons: z.array(z.record(z.string(), z.unknown())).min(2),
  timeRangeLabel: z.string().default("全部时间"),
})

/**
 * 热力图的一格 = **一周**（不是一天）。timestamp 是那一周（按东八区日历）周一的 UTC 零点，
 * 前端按东八区取年月日（`zonedParts`），不要用浏览器本地部件。
 * value 是整周的提交次数。按天切的话一年 365 格里三百多格是空的，
 * 中职学生一年也就在二三十天有提交，整张图看着像没用过。
 */
export const heatmapItemSchema = z.object({
  timestamp: z.number(),
  value: z.number().int(),
})

export const aiAnalysisRecordSchema = z.object({
  id: z.number().int(),
  provider: z.string(),
  model: z.string(),
  data: z.record(z.string(), z.unknown()),
  analysis: z.string(),
  createTime: z.string(),
  isPinned: z.boolean(),
  username: z.string().optional(),
})

export const loginSummarySchema = z.object({
  summary: z.object({
    start: z.string(),
    end: z.string(),
    newProblemCount: z.number().int(),
    submissionCount: z.number().int(),
    acceptedCount: z.number().int(),
    solvedCount: z.number().int(),
    flowchartSubmissionCount: z.number().int(),
  }),
  analysis: z.string(),
  analysisError: z.string().optional(),
})

export type Grade = z.infer<typeof gradeSchema>
export type DurationData = z.infer<typeof durationDataSchema>
export type SolvedProblem = z.infer<typeof solvedProblemSchema>
export type FlowchartSummary = z.infer<typeof flowchartSummarySchema>
export type ActivityBucket = z.infer<typeof activityBucketSchema>
export type AiDetail = z.infer<typeof aiDetailSchema>
export type SolvedList = z.infer<typeof solvedListSchema>
export type HeatmapItem = z.infer<typeof heatmapItemSchema>
export type AiAnalysisRecord = z.infer<typeof aiAnalysisRecordSchema>
export type LoginSummary = z.infer<typeof loginSummarySchema>

export type AiAnalysisRequest = z.infer<typeof aiAnalysisRequestSchema>
export type AiHintRequest = z.infer<typeof aiHintRequestSchema>
export type AiHintFeedbackRequest = z.infer<typeof aiHintFeedbackRequestSchema>
export type ClassAnalysisRequest = z.infer<typeof classAnalysisRequestSchema>
export type ClassPkAnalysisRequest = z.infer<
  typeof classPkAnalysisRequestSchema
>

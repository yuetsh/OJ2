import { z } from "zod"

import { classPkPeriodSchema } from "./ranking"

/**
 * 智能分析看哪段时间。全按东八区日历切（同排名页）：这周 = 本周一零点起，这个月 = 本月 1 日
 * 零点起，这学期 = `termStart()`（9 月 1 日 / 2 月 1 日），全部 = 不设下限。
 */
export const learningPeriodSchema = z.enum(["week", "month", "term", "all"])

export const LEARNING_PERIOD_LABELS = {
  week: "这周",
  month: "这个月",
  term: "这学期",
  all: "全部",
} as const satisfies Record<z.infer<typeof learningPeriodSchema>, string>

/**
 * 一道题在这段时间里的结果。代码提交和流程图合起来算，口径同课堂看板：代码 AC /
 * AST_CHECK_FAILED、流程图评到 A / S 都算做对。
 *
 * - `first`：第一次交就对了
 * - `tries`：交了 `attempts` 次才对（含做对那次）
 * - `fail`：交了 `attempts` 次，还没做对
 * - `none`：班上这节课做了，这个学生一次没交
 */
export const learningItemSchema = z.object({
  displayId: z.string(),
  title: z.string(),
  status: z.enum(["first", "tries", "fail", "none"]),
  attempts: z.number().int(),
  /** 班上第几个做对（只数这段时间里做对的同班同学）；没做对、没有班级时为 null */
  rank: z.number().int().nullable(),
  /** 这段时间班上几人做对；没有班级时为 null */
  classSolved: z.number().int().nullable(),
  /** 没做对时最后一次代码提交的判题状态；只交过流程图时为 null */
  lastResult: z.number().int().nullable(),
})

/**
 * 一天一行。`lesson` 是班上这节课的题：老师在课堂看板布置过就用布置的，否则同班同一天
 * ≥ 5 人做过的题（同「班里在做」的推断）；一道题只归到一天。`own` 是这个学生这天自己练的、
 * 不属于任何一节课的题，按他第一次交的那天归。
 */
export const learningDaySchema = z.object({
  /** 东八区日历日 `YYYY-MM-DD` */
  day: z.string(),
  lesson: z.array(learningItemSchema),
  own: z.array(learningItemSchema),
})

export const learningReportSchema = z.object({
  username: z.string(),
  className: z.string().nullable(),
  period: learningPeriodSchema,
  start: z.string().nullable(),
  end: z.string(),
  solved: z.number().int(),
  firstTry: z.number().int(),
  /** 这段时间班上上了几节课（有 `lesson` 的天数） */
  lessonCount: z.number().int(),
  /** 代码 + 流程图提交次数 */
  submissionCount: z.number().int(),
  /** 交过还没做对的题，交得多的在前 */
  unsolved: z.array(learningItemSchema),
  /**
   * 和班上比。「班上」= 这段时间交过题的同班学生（同排名口径的学生角色），没有班级时为 null。
   * `rank` 是按做对题数排第几（比他多的人数 + 1）。
   */
  classStats: z
    .object({
      size: z.number().int(),
      medianSolved: z.number(),
      medianFirstPercent: z.number().int(),
      rank: z.number().int(),
    })
    .nullable(),
  /** 新的在前 */
  days: z.array(learningDaySchema),
  /** 没通过的代码提交按判题状态分组，多的在前；系统错误、还没判完的不算 */
  errors: z.array(z.object({ result: z.number().int(), count: z.number().int() })),
  /** 全部知识点（tag 的 knowledge 类），按题库里题数从多到少；没碰过的 solved = tried = 0 */
  knowledge: z.array(
    z.object({ name: z.string(), solved: z.number().int(), tried: z.number().int() }),
  ),
  /** 老师看学生时，同班按用户名排的前一个 / 后一个；学生看自己时为 null */
  neighbors: z.object({ prev: z.string().nullable(), next: z.string().nullable() }).nullable(),
})

/**
 * 请求只说「看谁、哪段时间」，学情数据由服务端自己算。
 * 以前是 `details: z.unknown()` / `duration: z.unknown()` —— 前端算好的整包 POST 回去，
 * 原样进 prompt 又原样写进 ai_analysis 表，等于让任何登录用户决定喂给模型什么。
 */
export const aiAnalysisRequestSchema = z.object({
  period: learningPeriodSchema,
  username: z.string().optional(),
})

/**
 * 解锁「让 AI 分析我的代码」所需的失败提交数。前端拿它决定按钮露不露面、
 * 后端拿它卡 POST /ai/hint —— 放在契约里就是为了不让两边各写一个数字。
 *
 * 编译失败不受这个门槛限制：报错只关乎语法、不涉及解法，而英文编译报错恰恰是
 * 零基础学生最先撞上、最容易直接放弃的那堵墙。
 *
 * **2c 起从 3 降到 1**（设计 2.6）：门槛的活由下面的等级阶梯接走了 —— 第一次失败
 * 只开放 L0，而 L0 只反问、什么都不泄露，拦着它没有意义；再往上每级都要学生自己
 * 点、而且要再交一次，比一刀切的「攒够 3 次」更贴学生卡住的时刻。
 */
export const HINT_MIN_FAILURES = 1

/**
 * AI 提示的等级（AI 时代 OJ 设计 2.2）。**数字是落库的值（`ai_hint.level`）**，
 * 和判题状态码一样只能新增、不能改已有含义 —— 教师端「依赖提示」这类风险标签
 * 要按它聚合，改含义等于把历史数据一起改了。
 *
 * 0～4 是一条阶梯，只能逐级上升：**一条新的失败提交最多解锁一级**，而且要学生自己
 * 点「再多一点提示」才升，不会自动往上爬（2.6）。所以从第一次失败到 L4 至少要交 5 次。
 *
 * L3 / L4 是 2d 加的。**L4 是阶梯上唯一允许出现代码的一级**（至多两行，见
 * `services/hint-filter.ts` 的 `KEY_LINES_MAX`），L0～L3 一行代码都不许有。
 * 老师按班级 / 作业设最高等级还没做，现在所有题都开到 L4。
 */
export const HINT_LEVELS = [
  { level: 0, name: "反问", summary: "只反问，不给结论" },
  { level: 1, name: "定位", summary: "只说问题在哪，不说为什么" },
  { level: 2, name: "概念", summary: "讲清涉及的概念，不给改法" },
  { level: 3, name: "思路", summary: "分步骤讲解题思路，不写代码" },
  { level: 4, name: "示例", summary: "用相似的例子演示，或给出关键的一行" },
] as const

export const HINT_MAX_LEVEL = 4

/**
 * 编译失败的提示走这个值，**不在阶梯上**（查阶梯的 SQL 一律 `level >= 0`）。
 *
 * 编译错误只关乎语法、不涉及解法，给出定位甚至正确片段都不算放水 —— 而英文编译
 * 报错恰恰是零基础学生最先撞上、最容易直接放弃的那堵墙，所以它既不消耗等级、
 * 也不推进等级（同 HINT_MIN_FAILURES 对编译失败的豁免）。
 *
 * `ai_hint.level` 还有第三种值 null：2c 上线之前那批不分级的提示，同样不参与阶梯。
 */
export const HINT_LEVEL_COMPILE = -1

/** 给界面看的等级名。编译失败那一档不叫 L-1 */
export function hintLevelLabel(level: number) {
  if (level === HINT_LEVEL_COMPILE) return "编译错误"
  const item = HINT_LEVELS.find((entry) => entry.level === level)
  // 给学生看的，从 1 数起、不写「L0」：学生不知道 L 是什么，也不会从 0 数
  return item ? `第 ${item.level + 1} 档 · ${item.name}` : `第 ${level + 1} 档`
}

/**
 * `more` = 学生点的是「再多一点提示」。**升级只能由学生主动发起**：不带它就按当前
 * 等级再生成一次（换了提交也一样），带上它且距上次升级之后又交过一次才会 +1。
 */
export const aiHintRequestSchema = z.object({
  submissionId: z.string().min(1),
  more: z.boolean().optional(),
})

/**
 * `/ai/hint` 流末尾 `done` 事件的载荷。`hintId` 落库失败时为 null（前端据此不出评价
 * 按钮），`canEscalate` 是「现在再点一次『再多一点提示』能不能升级」—— 前端拿它决定
 * 那个按钮出不出，而不是自己去推算阶梯。
 */
export const aiHintDoneSchema = z.object({
  hintId: z.number().int().nullable(),
  level: z.number().int(),
  canEscalate: z.boolean(),
})

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
  output_format: "输出格式不对（多余的输入提示语、全角/半角符号、多余空格或换行、小数位数）",
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
  tag: z.enum(Object.keys(HINT_ERROR_TAGS) as [HintErrorTag, ...HintErrorTag[]]),
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

/**
 * 班级 AI 分析只传班号，数字在服务端按「班级详情」那一套现算 —— 原来是前端把弹框里的
 * 统计值整包传上来，报告和抽屉里看到的数字可能对不上
 */
export const classAnalysisRequestSchema = z.object({
  className: z.string().trim().min(1).max(32),
})

/** 班级 PK 的 AI 分析同样只传班号和时间段，数字和页面上的是同一份（services/ranking.ts 的 classPk） */
export const classPkAnalysisRequestSchema = z.object({
  classNames: z.array(z.string().trim().min(1).max(32)).min(2).max(8),
  period: classPkPeriodSchema,
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

export type LearningPeriod = z.infer<typeof learningPeriodSchema>
export type LearningItem = z.infer<typeof learningItemSchema>
export type LearningDay = z.infer<typeof learningDaySchema>
export type LearningReport = z.infer<typeof learningReportSchema>
export type AiAnalysisRecord = z.infer<typeof aiAnalysisRecordSchema>

export type AiAnalysisRequest = z.infer<typeof aiAnalysisRequestSchema>
export type AiHintRequest = z.infer<typeof aiHintRequestSchema>
export type AiHintDone = z.infer<typeof aiHintDoneSchema>
export type AiHintFeedbackRequest = z.infer<typeof aiHintFeedbackRequestSchema>
export type ClassAnalysisRequest = z.infer<typeof classAnalysisRequestSchema>
export type ClassPkAnalysisRequest = z.infer<typeof classPkAnalysisRequestSchema>

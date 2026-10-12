import { z } from "zod"

import { paginatedSchema } from "./common"

export const flowchartStatusSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
])

export const createFlowchartRequestSchema = z.object({
  problemId: z.number().int().positive(),
  mermaidCode: z
    .string()
    .trim()
    .min(1)
    .max(50_000)
    .refine(
      (value) => value.split("\n").filter((line) => line.trim()).length <= 200,
      "Flowchart is too complex",
    ),
  flowchartData: z.record(z.string(), z.unknown()).default({}),
})

export const flowchartSubmissionSchema = z.object({
  id: z.string(),
  username: z.string(),
  problemId: z.number().int(),
  mermaidCode: z.string(),
  flowchartData: z.record(z.string(), z.unknown()),
  status: flowchartStatusSchema,
  createTime: z.string(),
  aiScore: z.number().nullable(),
  aiGrade: z.string().nullable(),
  aiFeedback: z.string().nullable(),
  aiSuggestions: z.string().nullable(),
  aiCriteriaDetails: z.record(z.string(), z.unknown()),
  aiProvider: z.string(),
  aiModel: z.string(),
  processingTime: z.number().nullable(),
  evaluationTime: z.string().nullable(),
})

export const flowchartListItemSchema = z.object({
  id: z.string(),
  username: z.string(),
  problemDisplayId: z.string(),
  problemTitle: z.string(),
  status: flowchartStatusSchema,
  createTime: z.string(),
  aiScore: z.number().nullable(),
  aiGrade: z.string().nullable(),
  aiProvider: z.string(),
  aiModel: z.string(),
  processingTime: z.number().nullable(),
  evaluationTime: z.string().nullable(),
  showLink: z.boolean(),
})

export const flowchartListSchema = paginatedSchema(flowchartListItemSchema).extend({
  /** 题号框里查不到的题号，口径同 submissionListSchema.unknownProblems */
  unknownProblems: z.array(z.string()),
})
export const createFlowchartResponseSchema = z.object({
  submissionId: z.string(),
  status: z.literal("pending"),
})
/**
 * 流程图画到这两档算这道题做完：题单进度、课堂条、课堂看板、「你画的流程图」、结果页签的 ✓
 * 都按它（设计文档 2026-09-28-problem-page-redesign 第 3 节决定 4、6）。前后端只有这一份
 */
export const FLOWCHART_PASS_GRADES = ["S", "A"] as const

export function isFlowchartPass(grade: string | null | undefined) {
  return (FLOWCHART_PASS_GRADES as readonly string[]).includes(grade ?? "")
}

/** 自己在一道题上评完的历次分数，早的在前；hidden = 被题单闸门藏起来的次数 */
export const flowchartScoresSchema = z.object({
  scores: z.array(
    z.object({
      id: z.string(),
      score: z.number(),
      grade: z.string(),
      createTime: z.string(),
    }),
  ),
  hidden: z.number().int(),
})

export const flowchartStatisticsSchema = z.object({
  totalCount: z.number().int(),
  avgScore: z.number(),
  gradeDistribution: z.record(z.string(), z.number().int()),
  criteriaAverages: z.record(z.string(), z.object({ avg: z.number(), max: z.number() })),
  personCount: z.number().int(),
  completedCount: z.number().int(),
  wordFrequencies: z.array(z.object({ word: z.string(), count: z.number().int() })),
  /**
   * 2026-10 起「走例子」评的图里最常见的错：每张图取第一组没走对的原因（「『一级果』多输出了
   * 一行『一级果』」），同一句话数一下，最多 8 条。新评法几乎没有评语，词云拼不出来，
   * 而同一个错在一个班里往往原样出现几十次 —— 老师要看的就是它
   */
  commonMistakes: z.array(z.object({ text: z.string(), count: z.number().int() })),
  // 与提交统计共用「未完成学生」的形状，见 submission.ts 的 unacceptedStudentSchema
  dataUnaccepted: z.array(z.object({ username: z.string(), realName: z.string() })),
  /**
   * 每人**最好的一次**（分数最高的那张），统计页的「每人最好的一次」表用。
   * 只含普通学生；按最好成绩从低到高排，没拿到 A 的排前面 —— 老师要先看的是他们
   */
  people: z.array(
    z.object({
      username: z.string(),
      realName: z.string(),
      bestScore: z.number().nullable(),
      bestGrade: z.string().nullable(),
      count: z.number().int(),
      /** 拿到 A / S 的题数（查几道题时要每道都拿到才算完成） */
      goodProblems: z.number().int(),
    }),
  ),
  /** people 超过上限被截了（截掉的是成绩最好的那些） */
  peopleTruncated: z.boolean(),
  /** 查了几道题（没填题号为 0，此时拿到一道 A / S 就算完成） */
  problemCount: z.number().int(),
})

/**
 * 2026-10 起流程图的评法：AI 拿题目的例子和几组测试数据，在学生的图上从「开始」走到「结束」，
 * 逐组看输出对不对（不再打逻辑 40 / 完整 30 / 规范 20 / 清晰 10 四项分）。这份报告存在
 * `ai_criteria_details` 里，靠 `version: 2` 和老的四项分区分开 —— 老提交照旧按四项分显示。
 *
 * path / wrongAt 里是 Mermaid 的节点编号（n0 是开始），前端按同一套顺序对回画布上的框。
 */
export interface FlowchartCaseResult {
  /** 「例子 1」「测试 6」 */
  name: string
  input: string
  expected: string
  /** 照着图走出来的输出，多行用换行连起来 */
  output: string
  ok: boolean
  path: string[]
  wrongAt: string | null
  why: string
}

export interface FlowchartCaseReport {
  version: 2
  passed: number
  total: number
  cases: FlowchartCaseResult[]
}

export const flowchartUpdateSchema = z.object({
  type: z.enum([
    "flowchart_evaluation_completed",
    "flowchart_evaluation_failed",
    "flowchart_evaluation_update",
  ]),
  submissionId: z.string(),
  score: z.number().optional(),
  grade: z.string().optional(),
  feedback: z.string().optional(),
  suggestions: z.string().optional(),
  criteriaDetails: z.unknown().optional(),
  error: z.string().optional(),
})

export type FlowchartUpdate = z.infer<typeof flowchartUpdateSchema>
export type FlowchartStatistics = z.infer<typeof flowchartStatisticsSchema>
export type FlowchartSubmission = z.infer<typeof flowchartSubmissionSchema>
export type FlowchartListItem = z.infer<typeof flowchartListItemSchema>
export type FlowchartList = z.infer<typeof flowchartListSchema>
export type FlowchartScores = z.infer<typeof flowchartScoresSchema>
export type CreateFlowchartResponse = z.infer<typeof createFlowchartResponseSchema>
export type CreateFlowchartRequest = z.infer<typeof createFlowchartRequestSchema>

export type FlowchartStatus = z.infer<typeof flowchartStatusSchema>

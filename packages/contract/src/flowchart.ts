import { z } from "zod"

import { paginatedSchema } from "./common"

export const flowchartStatusSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])

export const createFlowchartRequestSchema = z.object({
  problemId: z.number().int().positive(),
  mermaidCode: z.string().trim().min(1).max(50_000).refine(
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
  problem: z.string(),
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

export const flowchartListSchema = paginatedSchema(flowchartListItemSchema)
export const createFlowchartResponseSchema = z.object({ submissionId: z.string(), status: z.literal("pending") })
export const flowchartCurrentSchema = z.object({ count: z.number().int(), score: z.number(), grade: z.string() })
export const flowchartDetailSchema = z.object({ submission: flowchartSubmissionSchema.nullable(), count: z.number().int() })

export const flowchartStatisticsSchema = z.object({
  totalCount: z.number().int(),
  avgScore: z.number(),
  gradeDistribution: z.record(z.string(), z.number().int()),
  criteriaAverages: z.record(
    z.string(),
    z.object({ avg: z.number(), max: z.number() }),
  ),
  personCount: z.number().int(),
  completedCount: z.number().int(),
  wordFrequencies: z.array(
    z.object({ word: z.string(), count: z.number().int() }),
  ),
  // 与提交统计共用「未完成学生」的形状，见 submission.ts 的 unacceptedStudentSchema
  dataUnaccepted: z.array(
    z.object({ username: z.string(), realName: z.string() }),
  ),
})

export const flowchartUpdateSchema = z.object({
  type: z.enum([
    "flowchart_evaluation_completed",
    "flowchart_evaluation_failed",
    "flowchart_evaluation_update",
  ]),
  submission_id: z.string(),
  score: z.number().optional(),
  grade: z.string().optional(),
  feedback: z.string().optional(),
  suggestions: z.string().optional(),
  criteriaDetails: z.unknown().optional(),
  error: z.string().optional(),
})

export type FlowchartUpdate = z.infer<typeof flowchartUpdateSchema>
export type FlowchartStatistics = z.infer<typeof flowchartStatisticsSchema>

import { z } from "zod"

/** 题目列表项。字段取自 problem 表，只含列表页需要的列。 */
export const problemSummarySchema = z.object({
  id: z.number().int(),
  _id: z.string(), // 展示用编号，与自增 id 不同
  title: z.string(),
  difficulty: z.string(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
})

export type ProblemSummary = z.infer<typeof problemSummarySchema>

export const problemDetailSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
  description: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  samples: z.array(
    z.object({
      input: z.string(),
      output: z.string(),
    }),
  ),
  hint: z.string().nullable(),
  languages: z.array(z.string()),
  template: z.record(z.string(), z.string()),
  createTime: z.string(),
  lastUpdateTime: z.string().nullable(),
  timeLimit: z.number().int(),
  memoryLimit: z.number().int(),
  difficulty: z.string(),
  source: z.string().nullable(),
  prompt: z.string().nullable(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
  statisticInfo: z.record(z.string(), z.unknown()),
  shareSubmission: z.boolean(),
  contestId: z.number().int().nullable(),
  tags: z.array(z.string()),
  createdBy: z.object({
    id: z.number().int(),
    username: z.string(),
    realName: z.string().nullable(),
  }),
  myStatus: z.number().int().nullable(),
  myFailedCount: z.number().int(),
  allowFlowchart: z.boolean(),
  showFlowchart: z.boolean(),
  mermaidCode: z.string().nullable(),
  flowchartData: z.record(z.string(), z.unknown()).nullable(),
  flowchartHint: z.string().nullable(),
  sqlConfig: z.record(z.string(), z.unknown()).nullable(),
  sqlDisplay: z.record(z.string(), z.unknown()).nullable(),
})

export type ProblemDetail = z.infer<typeof problemDetailSchema>

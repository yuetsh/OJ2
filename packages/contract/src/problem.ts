import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"

/**
 * 题目难度。生产库 956 道题只有这三个值（旧 Django 的 Problem.difficulty choices
 * 也是这三个），前端的 DIFFICULTY 映射表按它建 —— 写成 z.string() 的话
 * 多出来的值会静默渲染成 undefined。
 */
export const problemDifficultySchema = z.enum(["Low", "Mid", "High"])
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
  difficulty: problemDifficultySchema,
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

export const problemListItemSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
  difficulty: problemDifficultySchema,
  createdBy: sampleUserSchema,
  tags: z.array(z.string()),
  contestId: z.number().int().nullable(),
  allowFlowchart: z.boolean(),
  showFlowchart: z.boolean(),
  hasAstRules: z.boolean(),
  myStatus: z.number().int().nullable(),
})

export const problemListSchema = paginatedSchema(problemListItemSchema)

export const tagSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  problemCount: z.number().int().nonnegative(),
})

export const problemAuthorSchema = z.object({
  username: z.string(),
  problemCount: z.number().int().nonnegative(),
})

export const yearlyAcSchema = z.object({
  year: z.number().int(),
  total: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  acRate: z.number(),
})

export type ProblemDifficulty = z.infer<typeof problemDifficultySchema>
export type ProblemListItem = z.infer<typeof problemListItemSchema>
export type ProblemList = z.infer<typeof problemListSchema>
export type Tag = z.infer<typeof tagSchema>
export type ProblemAuthor = z.infer<typeof problemAuthorSchema>
export type YearlyAc = z.infer<typeof yearlyAcSchema>

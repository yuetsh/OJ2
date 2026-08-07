import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"
import { problemListItemSchema } from "./problem"

export const problemSetUserProgressSummarySchema = z.object({
  isJoined: z.boolean(),
  progressPercentage: z.number(),
  completedCount: z.number().int(),
  totalCount: z.number().int(),
  isCompleted: z.boolean(),
})

export const problemSetBadgeSchema = z.object({
  id: z.number().int(),
  problemsetId: z.number().int(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  conditionType: z.enum(["all_problems", "problem_count", "score"]),
  conditionValue: z.number().int(),
  isEarned: z.boolean().optional(),
})

export const problemSetSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  createdBy: sampleUserSchema,
  createTime: z.string(),
  lastUpdateTime: z.string().optional(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  status: z.enum(["active", "archived", "draft"]),
  endTime: z.string().nullable(),
  visible: z.boolean(),
  problemsCount: z.number().int(),
  completedCount: z.number().int().optional(),
  userProgress: problemSetUserProgressSummarySchema,
  badges: z.array(problemSetBadgeSchema).optional(),
})

export const problemSetListSchema = paginatedSchema(problemSetSchema)

export const problemSetProblemSchema = z.object({
  id: z.number().int(),
  problemsetId: z.number().int(),
  problem: problemListItemSchema,
  order: z.number().int(),
  isRequired: z.boolean(),
  score: z.number().int(),
  hint: z.string().nullable(),
  isCompleted: z.boolean(),
})

export const joinProblemSetRequestSchema = z.object({
  problemSetId: z.number().int().positive(),
})

export const updateProblemSetProgressRequestSchema = z.object({
  problemSetId: z.number().int().positive(),
  problemId: z.number().int().positive(),
  submissionId: z.string().min(1),
})

export const completedProblemSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
})

export const problemSetProgressSchema = z.object({
  id: z.number().int(),
  problemsetId: z.number().int(),
  user: sampleUserSchema,
  joinTime: z.string(),
  completeTime: z.string().nullable(),
  isCompleted: z.boolean(),
  progressPercentage: z.number(),
  completedProblemsCount: z.number().int(),
  totalProblemsCount: z.number().int(),
  totalScore: z.number().int(),
  completedProblems: z.array(completedProblemSchema),
})

export const problemSetProgressListSchema = paginatedSchema(problemSetProgressSchema).extend({
  statistics: z.object({
    total: z.number().int(),
    completed: z.number().int(),
    avgProgress: z.number(),
  }),
  problems: z.array(completedProblemSchema),
})

export const userBadgeSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  badge: problemSetBadgeSchema,
  earnedTime: z.string(),
  problemset: z.object({ id: z.number().int(), title: z.string() }),
})

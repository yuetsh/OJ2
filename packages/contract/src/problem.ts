import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"

/**
 * 题目难度。生产库 956 道题只有这三个值（旧 Django 的 Problem.difficulty choices
 * 也是这三个），前端的 DIFFICULTY 映射表按它建 —— 写成 z.string() 的话
 * 多出来的值会静默渲染成 undefined。
 */
export const problemDifficultySchema = z.enum(["Low", "Mid", "High"])

/**
 * SQL 题配置与展示数据。两者都是 `problem.sql_config` / `problem.sql_display`
 * 的 **JSONB 原文**，所以键名保持 snake_case —— 回滚时旧后端要读同一份，
 * 且旧后端 `judge/sql_runner.py:build_display` 产出的就是这个形状
 * （生产库 9 道 SQL 题逐条比对过，键集完全一致）。
 *
 * 写成精确 schema 而不是 `z.record(z.unknown())`：前端原来得自己手抄一份
 * SQLDisplay 接口才能渲染表格，抄错了没人拦得住。
 */
export const sqlConfigSchema = z.object({
  mode: z.enum(["query", "modify"]),
  order_sensitive: z.boolean(),
})

/** 表格里的单元格。SQLite 只会给出这三种；BLOB 在落库前已转成十六进制字符串 */
const sqlCellSchema = z.union([z.string(), z.number(), z.null()])

const sqlDisplayColumnSchema = z.object({
  name: z.string(),
  /** 表达式/聚合列（COUNT(*)、别名）在数据表里无同名列，类型为空串，前端据此隐藏 */
  type: z.string(),
})

const sqlResultSetSchema = z.object({
  columns: z.array(sqlDisplayColumnSchema),
  rows: z.array(z.array(sqlCellSchema)),
  total_rows: z.number().int().nonnegative(),
  truncated: z.boolean(),
})

export const sqlDisplayTableSchema = sqlResultSetSchema.extend({
  name: z.string(),
  /** 被标准答案 DROP 的表：条目用初始数据补齐、rows 清空，前端提示「表已删除」 */
  dropped: z.boolean().optional(),
})

export const sqlDisplaySchema = z.object({
  tables: z.array(sqlDisplayTableSchema),
  // query 题给结果集，modify 题给改动后的表 —— 两种形态，前端按有没有
  // changed_tables 分支
  expected: z.union([
    sqlResultSetSchema,
    z.object({ changed_tables: z.array(sqlDisplayTableSchema) }),
  ]),
})

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
  sqlConfig: sqlConfigSchema.nullable(),
  sqlDisplay: sqlDisplaySchema.nullable(),
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
export type SqlConfig = z.infer<typeof sqlConfigSchema>
export type SqlDisplay = z.infer<typeof sqlDisplaySchema>
export type SqlDisplayTable = z.infer<typeof sqlDisplayTableSchema>
export type SqlDisplayColumn = z.infer<typeof sqlDisplayColumnSchema>
export type YearlyAc = z.infer<typeof yearlyAcSchema>

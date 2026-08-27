import { randomBytes } from "node:crypto"

import {
  createFlowchartRequestSchema,
  createFlowchartResponseSchema,
  flowchartCurrentSchema,
  flowchartDetailSchema,
  flowchartListItemSchema,
  flowchartListSchema,
  flowchartStatisticsSchema,
  flowchartSubmissionSchema,
} from "@oj2/contract"
import { and, asc, count, desc, eq, ilike, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, requireTeacher, type AppEnv } from "../auth/middleware"
import { config } from "../config"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { flowchartQueue } from "../queue"
import { getBooleanOption } from "../services/options"
import { consumeToken } from "../services/throttling"
import { buildWordFrequencies } from "../services/word-frequency"
import {
  isAdminRole,
  objectValue,
  queryInteger,
  rounded,
  stripClassPrefix,
  todayStart,
} from "./helpers"

export const flowchartRoutes = new Hono<AppEnv>()

// AI 评分单独一个限流桶，与代码提交的 `throttling:user:<id>` 分开计数
function flowchartThrottleKey(userId: number) {
  return `flowchart:${userId}`
}

function canView(user: import("../auth/session").AuthUser, row: { userId: number }, problem: { createdById: number }) {
  return row.userId === user.id || isAdminRole(user) || problem.createdById === user.id
}

function flowchartData(
  flowchart: typeof schema.flowchartSubmission.$inferSelect,
  username: string,
) {
  return flowchartSubmissionSchema.parse({
    id: flowchart.id,
    username,
    problemId: flowchart.problemId,
    mermaidCode: flowchart.mermaidCode,
    flowchartData: objectValue(flowchart.flowchartData),
    status: flowchart.status,
    createTime: flowchart.createTime,
    aiScore: flowchart.aiScore,
    aiGrade: flowchart.aiGrade,
    aiFeedback: flowchart.aiFeedback,
    aiSuggestions: flowchart.aiSuggestions,
    aiCriteriaDetails: objectValue(flowchart.aiCriteriaDetails),
    aiProvider: flowchart.aiProvider,
    aiModel: flowchart.aiModel,
    processingTime: flowchart.processingTime,
    evaluationTime: flowchart.evaluationTime,
  })
}

flowchartRoutes.post("/flowcharts", requireAuth, async (c) => {
  const parsed = createFlowchartRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || JSON.stringify(parsed.data?.flowchartData ?? {}).length > 500 * 1024) {
    return failure(c, 400, "invalid-request", parsed.error?.issues[0]?.message ?? "Flowchart data is too large")
  }
  const [problem] = await db.select({ id: schema.problem.id, allow: schema.problem.allowFlowchart }).from(schema.problem)
    .where(eq(schema.problem.id, parsed.data.problemId)).limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!problem.allow) return failure(c, 400, "flowchart-not-allowed", "This problem does not allow flowchart submission")
  // 限流：每次提交都会触发一次外部 AI 调用，是和判题沙箱同级的有限资源。
  // 身份前缀单独开一个桶，**不能**直接用 user id —— 那是代码提交在用的桶，
  // 共用的话学生在机房连着交几次代码，流程图这边就会莫名其妙交不上去。
  const throttle = await consumeToken("user", flowchartThrottleKey(c.get("user")!.id))
  if (!throttle.allowed) {
    return failure(c, 429, "too-many-submissions", `Please wait ${Math.floor(throttle.wait)} seconds`)
  }
  const id = randomBytes(16).toString("hex")
  await db.insert(schema.flowchartSubmission).values({
    id,
    userId: c.get("user")!.id,
    problemId: problem.id,
    mermaidCode: parsed.data.mermaidCode,
    flowchartData: parsed.data.flowchartData,
    status: 0,
    createTime: new Date().toISOString(),
    aiScore: null,
    aiGrade: null,
    aiFeedback: null,
    aiSuggestions: null,
    aiCriteriaDetails: {},
    aiProvider: "deepseek",
    aiModel: config.aiModel,
    processingTime: null,
    evaluationTime: null,
  })
  try {
    await flowchartQueue.add("evaluate", { submissionId: id }, { jobId: id })
  } catch (error) {
    await db.update(schema.flowchartSubmission).set({ status: 3 }).where(eq(schema.flowchartSubmission.id, id))
    return failure(c, 502, "queue-unavailable", "Evaluation queue is unavailable")
  }
  return success(c, createFlowchartResponseSchema.parse({ submissionId: id, status: "pending" }), 201)
})

flowchartRoutes.get("/flowcharts", requireAuth, async (c) => {
  const user = c.get("user")!
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const filters = []
  const displayId = c.req.query("problemId")?.trim()
  const username = c.req.query("username")?.trim()
  const grade = c.req.query("grade")
  // 与代码提交列表同一套口径（submission.ts 的 GET /submissions）：关掉
  // submission_list_show_all 时非管理员看不到列表。流程图这边一直漏了这道门，
  // 学生把语言切成「流程图」、用户名随便填一个字就能翻出全班的 AI 评分。
  if (!(await getBooleanOption("submission_list_show_all", true)) && !isAdminRole(user)) {
    return success(c, flowchartListSchema.parse({ results: [], total: 0 }))
  }
  if (displayId) filters.push(sql`lower(${schema.problem.displayId}) = lower(${displayId})`)
  if (c.req.query("myself") === "1" || (!username && user.adminType === "Regular User")) filters.push(eq(schema.flowchartSubmission.userId, user.id))
  else if (username) filters.push(ilike(schema.user.username, `%${username}%`))
  if (c.req.query("today") === "1") filters.push(sql`${schema.flowchartSubmission.createTime} >= ${todayStart()}`)
  if (["S", "A", "B", "C"].includes(grade ?? "")) filters.push(eq(schema.flowchartSubmission.aiGrade, grade!))
  const where = filters.length ? and(...filters) : undefined
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.flowchartSubmission).innerJoin(schema.user, eq(schema.flowchartSubmission.userId, schema.user.id)).innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id)).where(where),
    db.select({ flowchart: schema.flowchartSubmission, username: schema.user.username, problem: schema.problem })
      .from(schema.flowchartSubmission).innerJoin(schema.user, eq(schema.flowchartSubmission.userId, schema.user.id))
      .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id)).where(where)
      .orderBy(desc(schema.flowchartSubmission.createTime)).limit(limit).offset(offset),
  ])
  return success(c, flowchartListSchema.parse({
    results: rows.map(({ flowchart, username, problem }) => flowchartListItemSchema.parse({
      id: flowchart.id,
      username,
      problem: problem.displayId,
      problemTitle: problem.title,
      status: flowchart.status,
      createTime: flowchart.createTime,
      aiScore: flowchart.aiScore,
      aiGrade: flowchart.aiGrade,
      aiProvider: flowchart.aiProvider,
      aiModel: flowchart.aiModel,
      processingTime: flowchart.processingTime,
      evaluationTime: flowchart.evaluationTime,
      showLink: canView(user, flowchart, problem),
    })),
    total: totalRows[0]?.value ?? 0,
  }))
})

const FLOWCHART_COMPLETED = 2

/**
 * 词云的分词条数上限。
 *
 * 数值统计（总数、均分、等级分布、各项平均分、完成人数）仍然按整个时间窗**精确**
 * 计算 —— 那只是已取回行上的算术，不额外花钱。真正会随数据量线性变重的是分词：
 * 每条 feedback / suggestions / comment 都要走一遍 jieba，而前端的「全部时段」
 * 是不带 start 的，攒一学年就得把所有评语重新 cut 一遍。
 *
 * 词云是辅助性的，看的是高频问题，取最近这些条足够；数值不能采样 —— 采了之后
 * 老师看到的完成率和均分就是错的，而且从界面上看不出来。
 */
const WORDCLOUD_TEXT_LIMIT = 3000

flowchartRoutes.get("/flowcharts/statistics", requireTeacher, async (c) => {
  const end = c.req.query("end")?.trim()
  if (!end) return failure(c, 400, "invalid-request", "end is required")
  const start = c.req.query("start")?.trim()

  const filters = [
    eq(schema.flowchartSubmission.status, FLOWCHART_COMPLETED),
    sql`${schema.flowchartSubmission.createTime} <= ${end}`,
  ]
  if (start) filters.push(sql`${schema.flowchartSubmission.createTime} >= ${start}`)

  const displayId = c.req.query("problemId")?.trim()
  if (displayId) {
    const [problem] = await db
      .select({ id: schema.problem.id })
      .from(schema.problem)
      .where(and(
        sql`lower(${schema.problem.displayId}) = lower(${displayId})`,
        isNull(schema.problem.contestId),
        eq(schema.problem.visible, true),
      ))
      .limit(1)
    if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
    filters.push(eq(schema.flowchartSubmission.problemId, problem.id))
  }

  const username = c.req.query("username")?.trim()
  if (username) filters.push(ilike(schema.user.username, `%${username}%`))

  // 只有指定了用户名才谈得上「班级人数」，不指定时分母无意义
  const roster = username
    ? await db
        .select({ username: schema.user.username, className: schema.user.className })
        .from(schema.user)
        .where(and(
          ilike(schema.user.username, `%${username}%`),
          eq(schema.user.isDisabled, false),
          eq(schema.user.adminType, "Regular User"),
        ))
    : []

  const rows = await db
    .select({
      username: schema.user.username,
      score: schema.flowchartSubmission.aiScore,
      grade: schema.flowchartSubmission.aiGrade,
      criteria: schema.flowchartSubmission.aiCriteriaDetails,
      feedback: schema.flowchartSubmission.aiFeedback,
      suggestions: schema.flowchartSubmission.aiSuggestions,
    })
    .from(schema.flowchartSubmission)
    .innerJoin(schema.user, eq(schema.flowchartSubmission.userId, schema.user.id))
    .where(and(...filters))
    // 按时间倒序，好让词云取到的那部分是最近的
    .orderBy(desc(schema.flowchartSubmission.createTime))

  const empty = {
    totalCount: 0,
    avgScore: 0,
    gradeDistribution: {},
    criteriaAverages: {},
    personCount: roster.length,
    completedCount: 0,
    wordFrequencies: [],
    dataUnaccepted: [],
  }
  if (rows.length === 0) return success(c, flowchartStatisticsSchema.parse(empty))

  const gradeDistribution: Record<string, number> = {}
  const criteriaTotals = new Map<string, { sum: number; count: number; max: number }>()
  const texts: string[] = []
  const pushText = (value: string) => {
    if (texts.length < WORDCLOUD_TEXT_LIMIT) texts.push(value)
  }
  const submitted = new Set<string>()
  let scoreSum = 0
  let scoreCount = 0

  for (const row of rows) {
    submitted.add(row.username)
    // 旧后端用 values_list("ai_grade") 分组，null 也会成为一个桶；这里保持同样的口径
    const grade = row.grade ?? ""
    gradeDistribution[grade] = (gradeDistribution[grade] ?? 0) + 1
    if (row.score !== null) {
      scoreSum += row.score
      scoreCount += 1
    }
    for (const [key, value] of Object.entries(objectValue(row.criteria))) {
      const detail = objectValue(value)
      if (typeof detail.score !== "number") continue
      const bucket = criteriaTotals.get(key)
      if (bucket) {
        bucket.sum += detail.score
        bucket.count += 1
      } else {
        // max 取第一次见到的那条，与旧后端 `if key not in criteria_max` 一致
        criteriaTotals.set(key, {
          sum: detail.score,
          count: 1,
          max: typeof detail.max === "number" ? detail.max : 100,
        })
      }
      if (typeof detail.comment === "string" && detail.comment) pushText(detail.comment)
    }
    if (row.feedback) pushText(row.feedback)
    if (row.suggestions) pushText(row.suggestions)
  }

  const criteriaAverages: Record<string, { avg: number; max: number }> = {}
  for (const [key, bucket] of criteriaTotals) {
    criteriaAverages[key] = { avg: rounded(bucket.sum / bucket.count, 1), max: bucket.max }
  }

  return success(c, flowchartStatisticsSchema.parse({
    totalCount: rows.length,
    // 分母是有分数的条数，不是总条数 —— 对齐 Django 的 Avg()，它跳过 NULL
    avgScore: scoreCount ? rounded(scoreSum / scoreCount, 1) : 0,
    gradeDistribution,
    criteriaAverages,
    personCount: roster.length,
    completedCount: submitted.size,
    wordFrequencies: await buildWordFrequencies(texts),
    dataUnaccepted: roster
      .filter((row) => !submitted.has(row.username))
      .map((row) => ({
        username: row.username,
        realName: stripClassPrefix(row.username, row.className),
      })),
  }))
})

flowchartRoutes.get("/flowcharts/:id", requireAuth, async (c) => {
  const [row] = await db.select({ flowchart: schema.flowchartSubmission, username: schema.user.username, problem: schema.problem })
    .from(schema.flowchartSubmission).innerJoin(schema.user, eq(schema.flowchartSubmission.userId, schema.user.id))
    .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
    .where(eq(schema.flowchartSubmission.id, c.req.param("id"))).limit(1)
  if (!row || !canView(c.get("user")!, row.flowchart, row.problem)) return failure(c, 404, "flowchart-not-found", "Submission does not exist")
  return success(c, flowchartData(row.flowchart, row.username))
})

flowchartRoutes.post("/flowcharts/:id/retry", requireAuth, async (c) => {
  const user = c.get("user")!
  const [row] = await db.select({ flowchart: schema.flowchartSubmission, problem: schema.problem }).from(schema.flowchartSubmission)
    .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
    .where(eq(schema.flowchartSubmission.id, c.req.param("id"))).limit(1)
  if (!row || !canView(user, row.flowchart, row.problem)) return failure(c, 404, "flowchart-not-found", "Submission does not exist")
  if (![2, 3].includes(row.flowchart.status)) return failure(c, 409, "retry-not-allowed", "Submission is not in a state that allows retry")
  // canView 允许本人重试自己的提交，不限流的话学生可以反复点着刷 AI 调用。
  // 教师放行：重新判题是他们的日常操作，成批点几十行是正常用法
  if (!isAdminRole(user)) {
    const throttle = await consumeToken("user", flowchartThrottleKey(user.id))
    if (!throttle.allowed) {
      return failure(c, 429, "too-many-submissions", `Please wait ${Math.floor(throttle.wait)} seconds`)
    }
  }
  await db.update(schema.flowchartSubmission).set({
    status: 0, aiScore: null, aiGrade: null, aiFeedback: null, aiSuggestions: null,
    aiCriteriaDetails: {}, processingTime: null, evaluationTime: null,
  }).where(eq(schema.flowchartSubmission.id, row.flowchart.id))
  try {
    // jobId 必须**正好三段**：bullmq 对含 `:` 的自定义 id 有一条兼容老的可重复
    // 任务的校验（job.js 的 `split(':').length !== 3`），两段会直接抛
    // `Custom Id cannot contain :`。原来写的是 `${id}:${时间戳}`，于是这个接口
    // 从来没成功过 —— 而清空评分在入队之前，每点一次就把原来的分数永久清掉、
    // 提交卡在 PENDING 且没有任何任务会来救它。
    await flowchartQueue.add(
      "evaluate",
      { submissionId: row.flowchart.id },
      { jobId: `${row.flowchart.id}:retry:${Date.now()}` },
    )
  } catch (error) {
    // 入队失败就落 FAILED，别把提交丢在 PENDING 上 —— 和 POST /flowcharts 同一处理
    await db.update(schema.flowchartSubmission).set({ status: 3 }).where(eq(schema.flowchartSubmission.id, row.flowchart.id))
    return failure(c, 502, "queue-unavailable", "Evaluation queue is unavailable")
  }
  return success(c, createFlowchartResponseSchema.parse({ submissionId: row.flowchart.id, status: "pending" }))
})

flowchartRoutes.get("/problems/:id/flowchart/current", requireAuth, async (c) => {
  const problemId = queryInteger(c.req.param("id"), 0, { min: 1 })
  const rows = await db.select({ score: schema.flowchartSubmission.aiScore, grade: schema.flowchartSubmission.aiGrade })
    .from(schema.flowchartSubmission).where(and(eq(schema.flowchartSubmission.userId, c.get("user")!.id), eq(schema.flowchartSubmission.problemId, problemId), eq(schema.flowchartSubmission.status, 2)))
    .orderBy(desc(schema.flowchartSubmission.createTime))
  return success(c, flowchartCurrentSchema.parse({ count: rows.length, score: rows[0]?.score ?? 0, grade: rows[0]?.grade ?? "" }))
})

flowchartRoutes.get("/problems/:id/flowchart/history", requireAuth, async (c) => {
  const problemId = queryInteger(c.req.param("id"), 0, { min: 1 })
  const page = queryInteger(c.req.query("page"), 0, { min: 0 })
  const rows = await db.select({ flowchart: schema.flowchartSubmission, username: schema.user.username })
    .from(schema.flowchartSubmission).innerJoin(schema.user, eq(schema.flowchartSubmission.userId, schema.user.id))
    .where(and(eq(schema.flowchartSubmission.userId, c.get("user")!.id), eq(schema.flowchartSubmission.problemId, problemId), eq(schema.flowchartSubmission.status, 2)))
    .orderBy(asc(schema.flowchartSubmission.createTime))
  const selected = page === 0 ? rows.at(-1) : rows[page - 1]
  if (page > rows.length) return failure(c, 400, "page-out-of-range", "Page out of range")
  return success(c, flowchartDetailSchema.parse({ submission: selected ? flowchartData(selected.flowchart, selected.username) : null, count: rows.length }))
})

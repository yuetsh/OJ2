import { randomBytes } from "node:crypto"

import {
  createFlowchartRequestSchema,
  createFlowchartResponseSchema,
  flowchartCurrentSchema,
  flowchartDetailSchema,
  flowchartListItemSchema,
  flowchartListSchema,
  flowchartSubmissionSchema,
} from "@oj2/contract"
import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { config } from "../config"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { flowchartQueue } from "../queue"
import { isAdminRole, objectValue, queryInteger, todayStart } from "./helpers"

export const flowchartRoutes = new Hono<AppEnv>()

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

flowchartRoutes.get("/flowcharts/:id", requireAuth, async (c) => {
  const [row] = await db.select({ flowchart: schema.flowchartSubmission, username: schema.user.username, problem: schema.problem })
    .from(schema.flowchartSubmission).innerJoin(schema.user, eq(schema.flowchartSubmission.userId, schema.user.id))
    .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
    .where(eq(schema.flowchartSubmission.id, c.req.param("id"))).limit(1)
  if (!row || !canView(c.get("user")!, row.flowchart, row.problem)) return failure(c, 404, "flowchart-not-found", "Submission does not exist")
  return success(c, flowchartData(row.flowchart, row.username))
})

flowchartRoutes.post("/flowcharts/:id/retry", requireAuth, async (c) => {
  const [row] = await db.select({ flowchart: schema.flowchartSubmission, problem: schema.problem }).from(schema.flowchartSubmission)
    .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
    .where(eq(schema.flowchartSubmission.id, c.req.param("id"))).limit(1)
  if (!row || !canView(c.get("user")!, row.flowchart, row.problem)) return failure(c, 404, "flowchart-not-found", "Submission does not exist")
  if (![2, 3].includes(row.flowchart.status)) return failure(c, 409, "retry-not-allowed", "Submission is not in a state that allows retry")
  await db.update(schema.flowchartSubmission).set({
    status: 0, aiScore: null, aiGrade: null, aiFeedback: null, aiSuggestions: null,
    aiCriteriaDetails: {}, processingTime: null, evaluationTime: null,
  }).where(eq(schema.flowchartSubmission.id, row.flowchart.id))
  await flowchartQueue.add("evaluate", { submissionId: row.flowchart.id }, { jobId: `${row.flowchart.id}:${Date.now()}` })
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

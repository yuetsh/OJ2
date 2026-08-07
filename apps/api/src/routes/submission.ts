import { randomBytes } from "node:crypto"

import {
  createSubmissionRequestSchema,
  createSubmissionResponseSchema,
  formatCodeRequestSchema,
  formatCodeResponseSchema,
  shareSubmissionRequestSchema,
  submissionDetailSchema,
  submissionListItemSchema,
  submissionListSchema,
} from "@oj2/contract"
import { and, count, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireAuth, type AppEnv } from "../auth/middleware"
import type { AuthUser } from "../auth/session"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { judgeQueue } from "../queue"
import {
  canAccessContest,
  contestStatus,
  findVisibleContest,
  ipAllowed,
  isContestAdmin,
} from "../services/contest"
import { CodeFormatError, formatCode } from "../services/format-code"
import { getBooleanOption } from "../services/options"
import { isAdminRole, isRegularUser, queryInteger, todayStart } from "./helpers"

export const submissionRoutes = new Hono<AppEnv>()

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function requestIp(c: { req: { header(name: string): string | undefined } }) {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded || c.req.header("x-real-ip") || null
}

submissionRoutes.post("/submissions", requireAuth, async (c) => {
  const parsed = createSubmissionRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  )
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", "Invalid submission payload")
  }
  let contestId: number | null = null
  if (parsed.data.contestId) {
    const contest = await findVisibleContest(parsed.data.contestId)
    if (!contest) return failure(c, 404, "contest-not-found", "Contest does not exist")
    const access = await canAccessContest(c, contest, "problems")
    if (!access.ok) return failure(c, access.code === "login-required" ? 401 : 403, access.code, access.message)
    if (contestStatus(contest) === "-1") return failure(c, 403, "contest-ended", "The contest has ended")
    if (!isContestAdmin(c.get("user"), contest) && !ipAllowed(requestIp(c), contest.allowedIpRanges)) {
      return failure(c, 403, "ip-not-allowed", "Your IP is not allowed in this contest")
    }
    contestId = contest.id
  }

  const [problem] = await db
    .select({
      id: schema.problem.id,
      languages: schema.problem.languages,
    })
    .from(schema.problem)
    .where(
      and(
        eq(schema.problem.id, parsed.data.problemId),
        eq(schema.problem.visible, true),
        contestId === null ? isNull(schema.problem.contestId) : eq(schema.problem.contestId, contestId),
      ),
    )
    .limit(1)

  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!stringArray(problem.languages).includes(parsed.data.language)) {
    return failure(
      c,
      400,
      "language-not-allowed",
      `${parsed.data.language} is not allowed in the problem`,
    )
  }

  const user = c.get("user")!
  const submissionId = randomBytes(16).toString("hex")
  const createTime = new Date().toISOString()
  const ip = requestIp(c)

  await db.insert(schema.submission).values({
    id: submissionId,
    problemId: problem.id,
    createTime,
    userId: user.id,
    username: user.username,
    code: parsed.data.code,
    result: JudgeStatus.PENDING,
    info: {},
    language: parsed.data.language,
    shared: false,
    statisticInfo: {},
    ip,
    contestId,
  })

  try {
    await judgeQueue.add(
      "judge",
      { submissionId, problemId: problem.id },
      { jobId: submissionId },
    )
  } catch (error) {
    await db
      .update(schema.submission)
      .set({ result: JudgeStatus.SYSTEM_ERROR })
      .where(eq(schema.submission.id, submissionId))
    console.error("Failed to enqueue submission", error)
    return failure(c, 502, "queue-unavailable", "Judge queue is unavailable")
  }

  return success(
    c,
    createSubmissionResponseSchema.parse({ submissionId }),
    201,
  )
})

submissionRoutes.get("/submissions/today-count", async (c) => {
  const language = c.req.query("language")
  if (language === "Flowchart") {
    const [row] = await db.select({ value: count() }).from(schema.flowchartSubmission)
      .where(sql`${schema.flowchartSubmission.createTime} >= ${todayStart()}`)
    return success(c, row?.value ?? 0)
  }
  const [row] = await db.select({ value: count() }).from(schema.submission)
    .where(and(isNull(schema.submission.contestId), sql`${schema.submission.createTime} >= ${todayStart()}`))
  return success(c, row?.value ?? 0)
})

submissionRoutes.post("/code/format", requireAuth, async (c) => {
  const parsed = formatCodeRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid format payload")
  try {
    const code = await formatCode(parsed.data.code, parsed.data.language)
    return success(c, formatCodeResponseSchema.parse({ code }))
  } catch (error) {
    if (error instanceof CodeFormatError) {
      return failure(c, error.kind === "syntax" ? 400 : 500, error.kind === "syntax" ? "format-error" : "format-tool-error", error.message)
    }
    throw error
  }
})

function canViewSubmission(
  user: AuthUser | null,
  row: typeof schema.submission.$inferSelect,
  problem: typeof schema.problem.$inferSelect,
  contest: typeof schema.contest.$inferSelect | null,
  allowShared = true,
) {
  if (!user) return false
  if (row.userId === user.id || isAdminRole(user) || problem.createdById === user.id) return true
  if (!allowShared) return false
  if (contest && contestStatus(contest) !== "-1") return false
  return problem.shareSubmission || row.shared
}

async function submissionDetail(id: string, user: AuthUser) {
  const [row] = await db.select({ submission: schema.submission, problem: schema.problem, contest: schema.contest })
    .from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .leftJoin(schema.contest, eq(schema.submission.contestId, schema.contest.id))
    .where(eq(schema.submission.id, id)).limit(1)
  if (!row || !canViewSubmission(user, row.submission, row.problem, row.contest)) return null
  const full = isAdminRole(user) || row.submission.userId === user.id
  return submissionDetailSchema.parse({
    id: row.submission.id,
    createTime: row.submission.createTime,
    userId: row.submission.userId,
    username: row.submission.username,
    code: row.submission.code,
    result: row.submission.result,
    info: full ? row.submission.info : {},
    language: row.submission.language,
    shared: row.submission.shared,
    statisticInfo: objectValue(row.submission.statisticInfo),
    ip: full ? row.submission.ip : null,
    contestId: row.submission.contestId,
    problemId: row.submission.problemId,
    showLink: true,
    canUnshare: canViewSubmission(user, row.submission, row.problem, row.contest, false),
  })
}

submissionRoutes.get("/submissions", optionalAuth, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const user = c.get("user")
  if (!(await getBooleanOption("submission_list_show_all", true)) && isRegularUser(user)) {
    return success(c, submissionListSchema.parse({ results: [], total: 0 }))
  }
  const filters = [isNull(schema.submission.contestId)]
  const displayId = c.req.query("problemId")?.trim()
  const username = c.req.query("username")?.trim()
  const result = c.req.query("result")
  const language = c.req.query("language")?.trim()
  if (displayId) filters.push(sql`lower(${schema.problem.displayId}) = lower(${displayId})`)
  if (c.req.query("myself") === "1" && user) filters.push(eq(schema.submission.userId, user.id))
  else if (username) filters.push(ilike(schema.submission.username, `%${username}%`))
  if (result !== undefined && result !== "" && Number.isInteger(Number(result))) filters.push(eq(schema.submission.result, Number(result)))
  if (language) filters.push(eq(schema.submission.language, language))
  if (c.req.query("today") === "1") filters.push(sql`${schema.submission.createTime} >= ${todayStart()}`)
  const where = and(...filters)
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.submission).innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id)).where(where),
    db.select({ submission: schema.submission, problem: schema.problem }).from(schema.submission)
      .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id)).where(where)
      .orderBy(desc(schema.submission.createTime)).limit(limit).offset(offset),
  ])
  return success(c, submissionListSchema.parse({
    results: rows.map(({ submission, problem }) => submissionListItemSchema.parse({
      id: submission.id,
      problem: problem.displayId,
      problemTitle: problem.title,
      showLink: user ? canViewSubmission(user, submission, problem, null) : false,
      createTime: submission.createTime,
      userId: submission.userId,
      username: submission.username,
      result: submission.result,
      language: submission.language,
      shared: submission.shared,
      statisticInfo: objectValue(submission.statisticInfo),
    })),
    total: totalRows[0]?.value ?? 0,
  }))
})

submissionRoutes.get("/contests/:contestId/submissions", optionalAuth, async (c) => {
  const contest = await findVisibleContest(queryInteger(c.req.param("contestId"), 0, { min: 1 }))
  if (!contest) return failure(c, 404, "contest-not-found", "Contest does not exist")
  const access = await canAccessContest(c, contest, "submissions")
  if (!access.ok) return failure(c, access.code === "login-required" ? 401 : 403, access.code, access.message)
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const filters = [eq(schema.submission.contestId, contest.id)]
  const user = c.get("user")
  const displayId = c.req.query("problemId")?.trim()
  const username = c.req.query("username")?.trim()
  const result = c.req.query("result")
  if (displayId) filters.push(sql`lower(${schema.problem.displayId}) = lower(${displayId})`)
  if (c.req.query("myself") === "1" && user) filters.push(eq(schema.submission.userId, user.id))
  else if (username) filters.push(ilike(schema.submission.username, `%${username}%`))
  if (result !== undefined && result !== "" && Number.isInteger(Number(result))) filters.push(eq(schema.submission.result, Number(result)))
  if (contestStatus(contest) !== "1") filters.push(sql`${schema.submission.createTime} >= ${contest.startTime}`)
  const where = and(...filters)
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.submission).innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id)).where(where),
    db.select({ submission: schema.submission, problem: schema.problem }).from(schema.submission)
      .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id)).where(where)
      .orderBy(desc(schema.submission.createTime)).limit(limit).offset(offset),
  ])
  return success(c, submissionListSchema.parse({
    results: rows.map(({ submission, problem }) => submissionListItemSchema.parse({
      id: submission.id,
      problem: problem.displayId,
      problemTitle: problem.title,
      showLink: user ? canViewSubmission(user, submission, problem, contest) : false,
      createTime: submission.createTime,
      userId: submission.userId,
      username: submission.username,
      result: submission.result,
      language: submission.language,
      shared: submission.shared,
      statisticInfo: objectValue(submission.statisticInfo),
    })),
    total: totalRows[0]?.value ?? 0,
  }))
})

submissionRoutes.get("/submissions/:id", requireAuth, async (c) => {
  const user = c.get("user")!
  const data = await submissionDetail(c.req.param("id"), user)
  if (!data) {
    return failure(c, 404, "submission-not-found", "Submission does not exist")
  }
  return success(c, data)
})

submissionRoutes.put("/submissions/:id", requireAuth, async (c) => {
  const parsed = shareSubmissionRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid share payload")
  const [row] = await db.select({ submission: schema.submission, problem: schema.problem, contest: schema.contest })
    .from(schema.submission).innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .leftJoin(schema.contest, eq(schema.submission.contestId, schema.contest.id))
    .where(eq(schema.submission.id, c.req.param("id"))).limit(1)
  if (!row || !canViewSubmission(c.get("user")!, row.submission, row.problem, row.contest, false)) {
    return failure(c, 404, "submission-not-found", "Submission does not exist")
  }
  if (row.contest && contestStatus(row.contest) === "0") {
    return failure(c, 403, "contest-underway", "Can not share submission now")
  }
  await db.update(schema.submission).set({ shared: parsed.data.shared }).where(eq(schema.submission.id, row.submission.id))
  return success(c, null)
})

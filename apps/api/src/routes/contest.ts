import {
  contestAccessSchema,
  contestListSchema,
  contestPasswordRequestSchema,
  contestRankItemSchema,
  contestRankSchema,
  contestSchema,
  problemDetailSchema,
  problemListItemSchema,
} from "@oj2/contract"
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, sql } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireAuth, type AppEnv } from "../auth/middleware"
import { setContestPassword } from "../auth/session"
import { db, schema } from "../db"
import { failure, success } from "../http"
import {
  canAccessContest,
  checkContestPassword,
  contestDetailsAllowed,
  contestStatus,
  findVisibleContest,
  isContestAdmin,
} from "../services/contest"
import { objectValue, publicTemplates, queryInteger, stringArray } from "./helpers"

export const contestRoutes = new Hono<AppEnv>()

async function creator(id: number) {
  const [row] = await db.select({ id: schema.user.id, username: schema.user.username, realName: schema.userProfile.realName })
    .from(schema.user).leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.user.id, id)).limit(1)
  return row ?? { id, username: "", realName: null }
}

async function serializeContest(contest: typeof schema.contest.$inferSelect, includeNow = false) {
  return contestSchema.parse({
    id: contest.id,
    title: contest.title,
    description: contest.description,
    tag: contest.tag,
    startTime: contest.startTime,
    endTime: contest.endTime,
    createTime: contest.createTime,
    lastUpdateTime: contest.lastUpdateTime,
    createdBy: await creator(contest.createdById),
    status: contestStatus(contest),
    contestType: contest.password ? "Password Protected" : "Public",
    now: includeNow ? new Date().toISOString() : undefined,
  })
}

contestRoutes.get("/contests", async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const keyword = c.req.query("keyword")?.trim()
  const tag = c.req.query("tag")?.trim()
  const status = c.req.query("status")
  const now = new Date().toISOString()
  const filters = [eq(schema.contest.visible, true)]
  if (keyword) filters.push(ilike(schema.contest.title, `%${keyword}%`))
  if (tag) filters.push(eq(schema.contest.tag, tag))
  if (status === "1") filters.push(gte(schema.contest.startTime, now))
  else if (status === "-1") filters.push(lte(schema.contest.endTime, now))
  else if (status === "0") filters.push(and(lte(schema.contest.startTime, now), gte(schema.contest.endTime, now))!)
  const where = and(...filters)
  const [totalRow, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.contest).where(where),
    db.select().from(schema.contest).where(where).orderBy(desc(schema.contest.startTime)).limit(limit).offset(offset),
  ])
  return success(c, contestListSchema.parse({
    results: await Promise.all(rows.map((row) => serializeContest(row))),
    total: totalRow[0]?.value ?? 0,
  }))
})

contestRoutes.get("/contests/:id", async (c) => {
  const contest = await findVisibleContest(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!contest) return failure(c, 404, "contest-not-found", "Contest does not exist")
  return success(c, await serializeContest(contest, true))
})

contestRoutes.post("/contests/:id/access", requireAuth, async (c) => {
  const contest = await findVisibleContest(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!contest || !contest.password) return failure(c, 404, "contest-not-found", "Contest does not exist")
  const parsed = contestPasswordRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Password is required")
  if (!checkContestPassword(parsed.data.password, contest.password)) {
    return failure(c, 403, "wrong-password", "Wrong password or password expired")
  }
  await setContestPassword(c, contest.id, parsed.data.password)
  return success(c, true)
})

contestRoutes.get("/contests/:id/access", requireAuth, async (c) => {
  const contest = await findVisibleContest(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!contest || !contest.password) return failure(c, 404, "contest-not-found", "Contest does not exist")
  const access = await canAccessContest(c, contest, "details")
  return success(c, contestAccessSchema.parse({ access: access.ok }))
})

async function contestProblemTags(problemIds: number[]) {
  if (problemIds.length === 0) return new Map<number, string[]>()
  const rows = await db.select({ problemId: schema.problemTags.problemId, name: schema.problemTag.name })
    .from(schema.problemTags).innerJoin(schema.problemTag, eq(schema.problemTags.problemtagId, schema.problemTag.id))
    .where(inArray(schema.problemTags.problemId, problemIds))
  const map = new Map<number, string[]>()
  for (const row of rows) map.set(row.problemId, [...(map.get(row.problemId) ?? []), row.name])
  return map
}

contestRoutes.get("/contests/:id/problems", optionalAuth, async (c) => {
  const contest = await findVisibleContest(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!contest) return failure(c, 404, "contest-not-found", "Contest does not exist")
  const access = await canAccessContest(c, contest, "problems")
  if (!access.ok) return failure(c, access.code === "login-required" ? 401 : 403, access.code, access.message)
  const rows = await db.select({ problem: schema.problem, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.problem).innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(and(eq(schema.problem.contestId, contest.id), eq(schema.problem.visible, true))).orderBy(asc(schema.problem.displayId))
  const tags = await contestProblemTags(rows.map((row) => row.problem.id))
  const allowed = contestDetailsAllowed(c.get("user"), contest)
  return success(c, rows.map(({ problem, user, realName }) => problemListItemSchema.parse({
    id: problem.id,
    _id: problem.displayId,
    title: problem.title,
    submissionNumber: allowed ? problem.submissionNumber : 0,
    acceptedNumber: allowed ? problem.acceptedNumber : 0,
    difficulty: allowed ? problem.difficulty : "",
    createdBy: { id: user.id, username: user.username, realName },
    tags: tags.get(problem.id) ?? [],
    contestId: contest.id,
    allowFlowchart: problem.allowFlowchart,
    showFlowchart: problem.showFlowchart,
    hasAstRules: problem.astRules !== null,
    myStatus: null,
  })))
})

contestRoutes.get("/contests/:id/problems/:displayId", optionalAuth, async (c) => {
  const contest = await findVisibleContest(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!contest) return failure(c, 404, "contest-not-found", "Contest does not exist")
  const access = await canAccessContest(c, contest, "problems")
  if (!access.ok) return failure(c, access.code === "login-required" ? 401 : 403, access.code, access.message)
  const [row] = await db.select({ problem: schema.problem, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.problem).innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(and(eq(schema.problem.contestId, contest.id), eq(schema.problem.visible, true), sql`lower(${schema.problem.displayId}) = lower(${c.req.param("displayId")})`)).limit(1)
  if (!row) return failure(c, 404, "problem-not-found", "Problem does not exist")
  const tags = await contestProblemTags([row.problem.id])
  const allowed = contestDetailsAllowed(c.get("user"), contest)
  return success(c, problemDetailSchema.parse({
    id: row.problem.id,
    _id: row.problem.displayId,
    title: row.problem.title,
    description: row.problem.description,
    inputDescription: row.problem.inputDescription,
    outputDescription: row.problem.outputDescription,
    samples: Array.isArray(row.problem.samples) ? row.problem.samples : [],
    hint: row.problem.hint,
    languages: stringArray(row.problem.languages),
    template: publicTemplates(row.problem.template),
    createTime: row.problem.createTime,
    lastUpdateTime: row.problem.lastUpdateTime,
    timeLimit: row.problem.timeLimit,
    memoryLimit: row.problem.memoryLimit,
    difficulty: allowed ? row.problem.difficulty : "",
    source: row.problem.source,
    prompt: row.problem.prompt,
    submissionNumber: allowed ? row.problem.submissionNumber : 0,
    acceptedNumber: allowed ? row.problem.acceptedNumber : 0,
    statisticInfo: allowed ? objectValue(row.problem.statisticInfo) : {},
    shareSubmission: row.problem.shareSubmission,
    contestId: contest.id,
    tags: tags.get(row.problem.id) ?? [],
    createdBy: { id: row.user.id, username: row.user.username, realName: row.realName },
    myStatus: null,
    myFailedCount: 0,
    allowFlowchart: row.problem.allowFlowchart,
    showFlowchart: row.problem.showFlowchart,
    mermaidCode: row.problem.allowFlowchart ? null : row.problem.mermaidCode,
    flowchartData: row.problem.allowFlowchart ? null : objectValue(row.problem.flowchartData),
    flowchartHint: row.problem.flowchartHint,
    sqlConfig: row.problem.sqlConfig ? objectValue(row.problem.sqlConfig) : null,
    sqlDisplay: row.problem.sqlDisplay ? objectValue(row.problem.sqlDisplay) : null,
  }))
})

contestRoutes.get("/contests/:id/rank", optionalAuth, async (c) => {
  const contest = await findVisibleContest(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!contest) return failure(c, 404, "contest-not-found", "Contest does not exist")
  const access = await canAccessContest(c, contest, "ranks")
  if (!access.ok) return failure(c, access.code === "login-required" ? 401 : 403, access.code, access.message)
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const where = and(eq(schema.acmContestRank.contestId, contest.id), inArray(schema.user.adminType, ["Regular User", "Student Admin"]), eq(schema.user.isDisabled, false))
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.acmContestRank).innerJoin(schema.user, eq(schema.acmContestRank.userId, schema.user.id)).where(where),
    db.select({ rank: schema.acmContestRank, user: schema.user, realName: schema.userProfile.realName })
      .from(schema.acmContestRank).innerJoin(schema.user, eq(schema.acmContestRank.userId, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id)).where(where)
      .orderBy(desc(schema.acmContestRank.acceptedNumber), asc(schema.acmContestRank.totalTime)).limit(limit).offset(offset),
  ])
  const admin = isContestAdmin(c.get("user"), contest)
  return success(c, contestRankSchema.parse({
    results: rows.map(({ rank, user, realName }) => contestRankItemSchema.parse({
      id: rank.id,
      user: { id: user.id, username: user.username, realName: admin ? realName : null },
      submissionNumber: rank.submissionNumber,
      acceptedNumber: rank.acceptedNumber,
      totalTime: rank.totalTime,
      submissionInfo: objectValue(rank.submissionInfo),
      contestId: rank.contestId,
    })),
    total: totalRows[0]?.value ?? 0,
  }))
})

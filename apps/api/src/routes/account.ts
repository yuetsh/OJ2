import { randomBytes } from "node:crypto"
import { extname, resolve } from "node:path"

import {
  activityRankItemSchema,
  metricsSchema,
  problemRankSchema,
  rankProfileSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  userRankSchema,
} from "@oj2/contract"
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  min,
  or,
  sql,
} from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireAuth, type AppEnv } from "../auth/middleware"
import { config } from "../config"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { getBooleanOption } from "../services/options"
import { getUserProfileById } from "../services/profile"
import { objectValue, queryInteger } from "./helpers"

export const accountRoutes = new Hono<AppEnv>()

accountRoutes.post("/users", async (c) => {
  const parsed = registerRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid registration payload")
  if (!(await getBooleanOption("allow_register", true))) {
    return failure(c, 403, "registration-disabled", "Register function has been disabled by admin")
  }

  const username = parsed.data.username.toLowerCase()
  const email = parsed.data.email.toLowerCase()
  const [duplicate] = await db
    .select({ username: schema.user.username, email: schema.user.email })
    .from(schema.user)
    .where(or(sql`lower(${schema.user.username}) = ${username}`, sql`lower(${schema.user.email}) = ${email}`))
    .limit(1)
  if (duplicate?.username.toLowerCase() === username) {
    return failure(c, 409, "username-exists", "Username already exists")
  }
  if (duplicate?.email?.toLowerCase() === email) {
    return failure(c, 409, "email-exists", "Email already exists")
  }

  const now = new Date().toISOString()
  const password = await Bun.password.hash(parsed.data.password, { algorithm: "argon2id" })
  await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.user).values({
      username,
      email,
      password,
      rawPassword: parsed.data.password.slice(0, 20),
      lastLogin: null,
      createTime: now,
      adminType: "Regular User",
      authToken: null,
      openApi: false,
      openApiAppkey: null,
      isDisabled: false,
      problemPermission: "None",
      sessionKeys: [],
      className: null,
    }).returning({ id: schema.user.id })
    if (!created) throw new Error("User insert did not return an id")
    await tx.insert(schema.userProfile).values({
      userId: created.id,
      acmProblemsStatus: {},
      avatar: `${config.avatarUriPrefix}/default.png`,
      blog: null,
      mood: null,
      acceptedNumber: 0,
      submissionNumber: 0,
      github: null,
      school: null,
      major: null,
      realName: null,
      language: null,
    })
  })
  return success(c, { ok: true }, 201)
})

accountRoutes.get("/profiles/:username", optionalAuth, async (c) => {
  const [target] = await db.select({ id: schema.user.id }).from(schema.user)
    .where(and(sql`lower(${schema.user.username}) = lower(${c.req.param("username")})`, eq(schema.user.isDisabled, false))).limit(1)
  if (!target) return failure(c, 404, "user-not-found", "User does not exist")
  const profile = await getUserProfileById(target.id, c.get("user")?.id === target.id)
  if (!profile) return failure(c, 404, "profile-not-found", "User profile does not exist")
  return success(c, profile)
})

accountRoutes.put("/me/profile", requireAuth, async (c) => {
  const parsed = updateProfileRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid profile payload")
  const values = Object.fromEntries(
    Object.entries(parsed.data).map(([key, value]) => [key, value === "" ? null : value]),
  )
  await db.update(schema.userProfile).set(values).where(eq(schema.userProfile.userId, c.get("user")!.id))
  const profile = await getUserProfileById(c.get("user")!.id, true)
  if (!profile) return failure(c, 404, "profile-not-found", "User profile does not exist")
  return success(c, profile)
})

accountRoutes.post("/me/avatar", requireAuth, async (c) => {
  const body: Record<string, string | File> = await c.req.parseBody().catch(() => ({}))
  const image = body.image
  if (!(image instanceof File)) return failure(c, 400, "invalid-file", "Invalid file content")
  if (image.size > 2 * 1024 * 1024) return failure(c, 400, "file-too-large", "Picture is too large")
  const extension = extname(image.name).toLowerCase()
  if (![".gif", ".jpg", ".jpeg", ".bmp", ".png"].includes(extension)) {
    return failure(c, 400, "unsupported-file", "Unsupported file format")
  }
  const filename = `${randomBytes(10).toString("hex")}${extension}`
  const directory = resolve(config.avatarDirectory)
  await Bun.$`mkdir -p ${directory}`.quiet()
  await Bun.write(resolve(directory, filename), image)
  const avatar = `${config.avatarUriPrefix}/${filename}`
  await db.update(schema.userProfile).set({ avatar }).where(eq(schema.userProfile.userId, c.get("user")!.id))
  return success(c, { avatar })
})

accountRoutes.get("/users/:id/metrics", async (c) => {
  const userId = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [row] = await db.select({ total: count(), first: min(schema.submission.createTime), latest: sql<string>`max(${schema.submission.createTime})` })
    .from(schema.submission)
    .where(and(eq(schema.submission.userId, userId), isNull(schema.submission.contestId)))
  if (!row?.total || !row.first || !row.latest) return failure(c, 404, "no-submissions", "暂无提交")
  return success(c, metricsSchema.parse({ now: new Date().toISOString(), first: row.first, latest: row.latest }))
})

accountRoutes.get("/rankings/users", async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const top = queryInteger(c.req.query("top"), 0, { min: 0, max: 10_000 })
  const username = c.req.query("username")?.trim() ?? ""
  const where = and(
    inArray(schema.user.adminType, ["Regular User", "Student Admin"]),
    eq(schema.user.isDisabled, false),
    gte(schema.userProfile.acceptedNumber, 0),
    username ? ilike(schema.user.username, `%${username}%`) : undefined,
  )
  const [totalRow] = await db.select({ value: count() }).from(schema.userProfile)
    .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id)).where(where)
  const rows = await db.select({ profile: schema.userProfile, user: schema.user }).from(schema.userProfile)
    .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id)).where(where)
    .orderBy(desc(schema.userProfile.acceptedNumber), asc(schema.userProfile.submissionNumber))
    .limit(top > 0 ? Math.min(top, 250) : limit).offset(top > 0 ? 0 : offset)
  const results = rows.map(({ profile, user }) => rankProfileSchema.parse({
    id: profile.id,
    user: { id: user.id, username: user.username, realName: profile.realName },
    acceptedNumber: profile.acceptedNumber,
    submissionNumber: profile.submissionNumber,
    mood: profile.mood,
  }))
  return success(c, userRankSchema.parse({ results, total: totalRow?.value ?? 0 }))
})

accountRoutes.get("/rankings/activity", async (c) => {
  const start = c.req.query("start")
  if (!start || Number.isNaN(Date.parse(start))) return failure(c, 400, "invalid-start", "start time is required")
  const rows = await db.select({ username: schema.submission.username, value: countDistinct(schema.submission.problemId) })
    .from(schema.submission)
    .innerJoin(schema.user, eq(schema.submission.userId, schema.user.id))
    .where(and(
      isNull(schema.submission.contestId),
      gte(schema.submission.createTime, start),
      inArray(schema.submission.result, [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]),
      eq(schema.user.isDisabled, false),
      sql`${schema.user.adminType} <> 'Super Admin'`,
    ))
    .groupBy(schema.submission.username).orderBy(desc(countDistinct(schema.submission.problemId))).limit(10)
  return success(c, rows.map((row) => activityRankItemSchema.parse({ username: row.username, count: row.value })))
})

accountRoutes.get("/problems/:displayId/rank", requireAuth, async (c) => {
  const user = c.get("user")!
  const [problem] = await db.select({ id: schema.problem.id }).from(schema.problem)
    .where(and(sql`lower(${schema.problem.displayId}) = lower(${c.req.param("displayId")})`, isNull(schema.problem.contestId), eq(schema.problem.visible, true))).limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  const accepted = and(eq(schema.submission.problemId, problem.id), inArray(schema.submission.result, [0, 10]))
  const [all] = await db.select({ value: countDistinct(schema.submission.userId) }).from(schema.submission).where(accepted)
  const className = user.className ?? ""
  const classWhere = className
    ? and(accepted, inArray(schema.submission.userId, db.select({ id: schema.user.id }).from(schema.user).where(and(eq(schema.user.className, className), eq(schema.user.isDisabled, false)))))
    : accepted
  const [classCount] = className
    ? await db.select({ value: countDistinct(schema.submission.userId) }).from(schema.submission).where(classWhere)
    : [{ value: 0 }]
  const [first] = await db.select({ value: min(schema.submission.createTime) }).from(schema.submission)
    .where(and(classWhere, eq(schema.submission.userId, user.id)))
  let rank = -1
  if (first?.value) {
    const [rankRow] = await db.select({ value: count() }).from(schema.submission).where(and(classWhere, lte(schema.submission.createTime, first.value)))
    rank = rankRow?.value ?? -1
  }
  return success(c, problemRankSchema.parse({ className, rank, classAcCount: classCount?.value ?? 0, allAcCount: all?.value ?? 0 }))
})

accountRoutes.post("/me/problem-display-ids/refresh", requireAuth, async (c) => {
  const user = c.get("user")!
  const [profile] = await db.select({ value: schema.userProfile.acmProblemsStatus }).from(schema.userProfile)
    .where(eq(schema.userProfile.userId, user.id)).limit(1)
  const status = objectValue(profile?.value)
  const problems = objectValue(status.problems)
  const ids = Object.keys(problems).map(Number).filter(Number.isInteger)
  if (ids.length > 0) {
    const rows = await db.select({ id: schema.problem.id, displayId: schema.problem.displayId }).from(schema.problem)
      .where(and(inArray(schema.problem.id, ids), eq(schema.problem.visible, true)))
    const displayIds = new Map(rows.map((row) => [String(row.id), row.displayId]))
    for (const [id, value] of Object.entries(problems)) {
      const item = objectValue(value)
      const displayId = displayIds.get(id)
      if (displayId) item._id = displayId
      problems[id] = item
    }
    status.problems = problems
    await db.update(schema.userProfile).set({ acmProblemsStatus: status }).where(eq(schema.userProfile.userId, user.id))
  }
  return success(c, null)
})

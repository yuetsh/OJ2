import {
  addContestProblemRequestSchema,
  adminProblemListItemSchema,
  adminProblemListSchema,
  adminProblemSchema,
  createProblemRequestSchema,
  makeProblemPublicRequestSchema,
  updateProblemRequestSchema,
} from "@oj2/contract"
import { and, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireProblemPermission, type AppEnv } from "../../auth/middleware"
import type { AuthUser } from "../../auth/session"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { contestStatus } from "../../services/contest"
import { objectValue, queryInteger, sampleUser, stringArray } from "../helpers"

export const adminProblemRoutes = new Hono<AppEnv>()

type ProblemRow = typeof schema.problem.$inferSelect

function canManageAll(user: AuthUser) {
  return user.adminType === "Super Admin" || user.problemPermission === "All"
}

/**
 * 题目归属判断。比赛题看**比赛**的创建者，公开题看题目自己的创建者 ——
 * 对齐旧后端：`ensure_created_by(problem.contest, user)` vs `ensure_created_by(problem, user)`。
 * 一道比赛题的 created_by 可能是克隆时的操作人，跟谁有权改它没关系。
 */
async function canEdit(user: AuthUser, problem: ProblemRow) {
  if (user.adminType === "Super Admin") return true
  if (problem.contestId === null) {
    return canManageAll(user) || problem.createdById === user.id
  }
  const [contest] = await db.select({ createdById: schema.contest.createdById })
    .from(schema.contest).where(eq(schema.contest.id, problem.contestId)).limit(1)
  return Boolean(contest && contest.createdById === user.id)
}

async function tagNames(problemId: number) {
  const rows = await db.select({ name: schema.problemTag.name }).from(schema.problemTags)
    .innerJoin(schema.problemTag, eq(schema.problemTags.problemtagId, schema.problemTag.id))
    .where(eq(schema.problemTags.problemId, problemId))
  return rows.map((row) => row.name)
}

/** 把标签名解析成 id：去空格、大小写不敏感复用已有标签，没有才新建。对齐旧 resolve_tags */
async function resolveTags(tx: typeof db, names: string[]) {
  const ids: number[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const [existing] = await tx.select({ id: schema.problemTag.id }).from(schema.problemTag)
      .where(sql`lower(${schema.problemTag.name}) = lower(${name})`).limit(1)
    if (existing) { ids.push(existing.id); continue }
    const [created] = await tx.insert(schema.problemTag).values({ name })
      .returning({ id: schema.problemTag.id })
    ids.push(created!.id)
  }
  return ids
}

async function setTags(tx: typeof db, problemId: number, names: string[]) {
  const ids = await resolveTags(tx, names)
  await tx.delete(schema.problemTags).where(eq(schema.problemTags.problemId, problemId))
  if (ids.length) {
    await tx.insert(schema.problemTags).values(ids.map((problemtagId) => ({ problemId, problemtagId })))
  }
}

async function serialize(row: ProblemRow) {
  const [[creator], tags] = await Promise.all([
    db.select({ id: schema.user.id, username: schema.user.username, realName: schema.userProfile.realName })
      .from(schema.user).leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(eq(schema.user.id, row.createdById)).limit(1),
    tagNames(row.id),
  ])
  return adminProblemSchema.parse({
    id: row.id,
    _id: row.displayId,
    title: row.title,
    description: row.description,
    inputDescription: row.inputDescription,
    outputDescription: row.outputDescription,
    samples: Array.isArray(row.samples) ? row.samples : [],
    testCaseId: row.testCaseId,
    testCaseScore: Array.isArray(row.testCaseScore) ? row.testCaseScore : [],
    hint: row.hint,
    languages: stringArray(row.languages),
    template: objectValue(row.template),
    createTime: row.createTime,
    lastUpdateTime: row.lastUpdateTime,
    timeLimit: row.timeLimit,
    memoryLimit: row.memoryLimit,
    visible: row.visible,
    difficulty: row.difficulty,
    source: row.source,
    submissionNumber: row.submissionNumber,
    acceptedNumber: row.acceptedNumber,
    statisticInfo: objectValue(row.statisticInfo),
    shareSubmission: row.shareSubmission,
    contestId: row.contestId,
    createdBy: sampleUser(creator ?? { id: row.createdById, username: "" }, creator?.realName),
    isPublic: row.isPublic,
    tags,
    allowFlowchart: row.allowFlowchart,
    showFlowchart: row.showFlowchart,
    mermaidCode: row.mermaidCode,
    flowchartHint: row.flowchartHint,
    astRules: row.astRules,
    answers: Array.isArray(row.answers) ? row.answers : [],
    prompt: row.prompt,
    sqlConfig: row.sqlConfig ? objectValue(row.sqlConfig) : null,
    sqlDisplay: row.sqlDisplay ? objectValue(row.sqlDisplay) : null,
  })
}

/**
 * 非 SQL 题的公共校验，对齐旧 `ProblemBase.common_checks` 的 else 分支。
 *
 * SQL 分支在这里**只做前置校验、不生成 sqlDisplay** —— 生成需要跑 SQLite，
 * 而新后端还没有 SQL 判题链路（旧 judge/sql_runner.py 378 行无对应实现）。
 * 因此新建 SQL 题会被拒绝，编辑 SQL 题则保留原有 sqlDisplay 不动，不会把已有数据弄坏。
 */
function commonChecks(data: {
  languages: string[]
  inputDescription: string
  outputDescription: string
  samples: unknown[]
  sqlConfig: Record<string, unknown> | null
  answers: Record<string, unknown>[]
}): { error: string } | { sql: boolean } {
  if (data.languages.includes("SQL")) {
    if (data.languages.length !== 1) return { error: "SQL problem cannot be mixed with other languages" }
    if (!data.sqlConfig) return { error: "SQL problem requires sql_config" }
    const hasAnswer = data.answers.some((item) =>
      item.language === "SQL" && typeof item.code === "string" && item.code.trim())
    if (!hasAnswer) return { error: "SQL problem requires a SQL reference answer" }
    return { sql: true }
  }
  if (!data.inputDescription || !data.outputDescription) {
    return { error: "Input and output description are required" }
  }
  if (data.samples.length === 0) return { error: "Samples are required" }
  return { sql: false }
}

const SQL_NOT_SUPPORTED =
  "新后端尚未实现 SQL 判题链路（题目页展示数据需要跑 SQLite 生成），暂不能新建 SQL 题。已有 SQL 题可以正常编辑，其展示数据保持不变。"

function problemValues(data: ReturnType<typeof createProblemRequestSchema.parse>, isSql: boolean) {
  return {
    displayId: data._id,
    title: data.title,
    description: data.description,
    inputDescription: data.inputDescription,
    outputDescription: data.outputDescription,
    samples: data.samples,
    testCaseId: data.testCaseId,
    testCaseScore: data.testCaseScore,
    hint: data.hint,
    languages: data.languages,
    template: data.template,
    timeLimit: data.timeLimit,
    memoryLimit: data.memoryLimit,
    visible: data.visible,
    difficulty: data.difficulty,
    source: data.source,
    shareSubmission: data.shareSubmission,
    allowFlowchart: data.allowFlowchart,
    showFlowchart: data.showFlowchart,
    mermaidCode: data.mermaidCode,
    flowchartHint: data.flowchartHint,
    astRules: data.astRules ?? null,
    answers: data.answers,
    prompt: data.prompt,
    // 防脏数据：非 SQL 题不应携带 SQL 配置，对齐旧 common_checks
    sqlConfig: isSql ? data.sqlConfig : null,
  }
}

// ---------------------------------------------------------------- 公开题目

adminProblemRoutes.get("/problems", requireProblemPermission, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const user = c.get("user")!
  const filters = [isNull(schema.problem.contestId)]
  if (!canManageAll(user)) filters.push(eq(schema.problem.createdById, user.id))
  const author = c.req.query("author")?.trim()
  const keyword = c.req.query("keyword")?.trim()
  const tagId = c.req.query("tagId")?.trim()
  if (author) filters.push(eq(schema.user.username, author))
  if (keyword) {
    filters.push(or(
      ilike(schema.problem.title, `%${keyword}%`),
      ilike(schema.problem.displayId, `%${keyword}%`),
    )!)
  }
  if (tagId) {
    filters.push(inArray(schema.problem.id,
      db.select({ id: schema.problemTags.problemId }).from(schema.problemTags)
        .where(eq(schema.problemTags.problemtagId, Number(tagId)))))
  }
  const where = and(...filters)
  const [totalRow, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.problem)
      .innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id)).where(where),
    db.select({ problem: schema.problem, user: schema.user, realName: schema.userProfile.realName })
      .from(schema.problem)
      .innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(where).orderBy(desc(schema.problem.createTime)).limit(limit).offset(offset),
  ])
  return success(c, adminProblemListSchema.parse({
    results: await Promise.all(rows.map(async ({ problem, user: creator, realName }) =>
      adminProblemListItemSchema.parse({
        id: problem.id,
        _id: problem.displayId,
        title: problem.title,
        createdBy: sampleUser(creator, realName),
        visible: problem.visible,
        createTime: problem.createTime,
        difficulty: problem.difficulty,
        tags: await tagNames(problem.id),
        hasAstRules: problem.astRules !== null,
        allowFlowchart: problem.allowFlowchart,
        showFlowchart: problem.showFlowchart,
        topReaction: null,
      }))),
    total: totalRow[0]?.value ?? 0,
  }))
})

adminProblemRoutes.get("/problems/:id", requireProblemPermission, async (c) => {
  const [row] = await db.select().from(schema.problem)
    .where(eq(schema.problem.id, queryInteger(c.req.param("id"), 0, { min: 1 }))).limit(1)
  if (!row) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!(await canEdit(c.get("user")!, row))) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }
  return success(c, await serialize(row))
})

adminProblemRoutes.post("/problems", requireProblemPermission, async (c) => {
  const parsed = createProblemRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const checked = commonChecks(parsed.data)
  if ("error" in checked) return failure(c, 400, "invalid-problem", checked.error)
  if (checked.sql) return failure(c, 501, "sql-not-supported", SQL_NOT_SUPPORTED)

  const [duplicate] = await db.select({ id: schema.problem.id }).from(schema.problem)
    .where(and(eq(schema.problem.displayId, parsed.data._id), isNull(schema.problem.contestId))).limit(1)
  if (duplicate) return failure(c, 409, "display-id-exists", "Display ID already exists")

  const now = new Date().toISOString()
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.problem).values({
      ...problemValues(parsed.data, false),
      contestId: null,
      createdById: c.get("user")!.id,
      createTime: now,
      lastUpdateTime: now,
      submissionNumber: 0,
      acceptedNumber: 0,
      statisticInfo: {},
      isPublic: false,
      sqlDisplay: null,
    }).returning()
    await setTags(tx as unknown as typeof db, row!.id, parsed.data.tags)
    return row!
  })
  return success(c, await serialize(created), 201)
})

adminProblemRoutes.put("/problems/:id", requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = updateProblemRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const [existing] = await db.select().from(schema.problem).where(eq(schema.problem.id, id)).limit(1)
  if (!existing) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!(await canEdit(c.get("user")!, existing))) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }
  const checked = commonChecks(parsed.data)
  if ("error" in checked) return failure(c, 400, "invalid-problem", checked.error)

  // 题号唯一性的作用域跟着题目走：公开题在全部公开题里唯一，比赛题在本场比赛内唯一
  const [duplicate] = await db.select({ id: schema.problem.id }).from(schema.problem)
    .where(and(
      eq(schema.problem.displayId, parsed.data._id),
      existing.contestId === null
        ? isNull(schema.problem.contestId)
        : eq(schema.problem.contestId, existing.contestId),
      ne(schema.problem.id, id),
    )).limit(1)
  if (duplicate) return failure(c, 409, "display-id-exists", "Display ID already exists")

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(schema.problem).set({
      ...problemValues(parsed.data, checked.sql),
      lastUpdateTime: new Date().toISOString(),
      // SQL 题的 sqlDisplay 原样保留：重新生成需要跑 SQLite，新后端还没有那条链路。
      // 不动它比生成一个错的更安全 —— 它直接决定题目页给学生看的表结构与期望结果。
    }).where(eq(schema.problem.id, id)).returning()
    await setTags(tx as unknown as typeof db, id, parsed.data.tags)
    return row!
  })
  return success(c, await serialize(updated))
})

// 公开题与比赛题共用一条删除路由。旧接口分成两个（admin/problem 与
// admin/contest/problem），但两边都只按题目 id 取、比赛是从题目推导出来的，
// 分开没有意义，还逼前端多传一个它未必知道的 contestId。
adminProblemRoutes.delete("/problems/:id", requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [existing] = await db.select().from(schema.problem).where(eq(schema.problem.id, id)).limit(1)
  if (!existing) return failure(c, 404, "problem-not-found", "Problem does not exists")
  if (!(await canEdit(c.get("user")!, existing))) {
    return failure(c, 404, "problem-not-found", "Problem does not exists")
  }
  return deleteProblem(c, id)
})

/**
 * 删题的共用实现。子表全是 NO ACTION 外键，Django 的级联在应用层，得手工清。
 * 测试用例目录**不删** —— 与旧后端一致（它把 rmtree 注释掉了）。
 * 删错了还能从磁盘捞回来，而误删的测试数据没有别处备份；孤儿目录另有清理入口。
 */
async function deleteProblem(c: Parameters<typeof success>[0], id: number) {
  const [submissions] = await db.select({ value: count() }).from(schema.submission)
    .where(eq(schema.submission.problemId, id))
  if ((submissions?.value ?? 0) > 0) {
    return failure(c, 409, "problem-has-submissions", "该题目已有提交记录，不能删除")
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.problemTags).where(eq(schema.problemTags.problemId, id))
    await tx.delete(schema.problemsetProblem).where(eq(schema.problemsetProblem.problemId, id))
    await tx.delete(schema.flowchartSubmission).where(eq(schema.flowchartSubmission.problemId, id))
    await tx.delete(schema.reaction).where(eq(schema.reaction.problemId, id))
    await tx.delete(schema.problem).where(eq(schema.problem.id, id))
  })
  return success(c, null)
}

// ---------------------------------------------------------------- 比赛题目

adminProblemRoutes.get("/contests/:contestId/problems", requireProblemPermission, async (c) => {
  const contestId = queryInteger(c.req.param("contestId"), 0, { min: 1 })
  const [contest] = await db.select().from(schema.contest).where(eq(schema.contest.id, contestId)).limit(1)
  const user = c.get("user")!
  if (!contest || (user.adminType !== "Super Admin" && contest.createdById !== user.id)) {
    return failure(c, 404, "contest-not-found", "Contest does not exist")
  }
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const filters = [eq(schema.problem.contestId, contestId)]
  const keyword = c.req.query("keyword")?.trim()
  if (keyword) filters.push(ilike(schema.problem.title, `%${keyword}%`))
  const where = and(...filters)
  const [totalRow, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.problem).where(where),
    db.select({ problem: schema.problem, user: schema.user, realName: schema.userProfile.realName })
      .from(schema.problem)
      .innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(where).orderBy(desc(schema.problem.createTime)).limit(limit).offset(offset),
  ])
  return success(c, adminProblemListSchema.parse({
    results: await Promise.all(rows.map(async ({ problem, user: creator, realName }) =>
      adminProblemListItemSchema.parse({
        id: problem.id,
        _id: problem.displayId,
        title: problem.title,
        createdBy: sampleUser(creator, realName),
        visible: problem.visible,
        createTime: problem.createTime,
        difficulty: problem.difficulty,
        tags: await tagNames(problem.id),
        hasAstRules: problem.astRules !== null,
        allowFlowchart: problem.allowFlowchart,
        showFlowchart: problem.showFlowchart,
        topReaction: null,
      }))),
    total: totalRow[0]?.value ?? 0,
  }))
})

adminProblemRoutes.post("/contests/:contestId/problems", requireProblemPermission, async (c) => {
  const contestId = queryInteger(c.req.param("contestId"), 0, { min: 1 })
  const [contest] = await db.select().from(schema.contest).where(eq(schema.contest.id, contestId)).limit(1)
  const user = c.get("user")!
  if (!contest || (user.adminType !== "Super Admin" && contest.createdById !== user.id)) {
    return failure(c, 404, "contest-not-found", "Contest does not exist")
  }
  const parsed = createProblemRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const checked = commonChecks(parsed.data)
  if ("error" in checked) return failure(c, 400, "invalid-problem", checked.error)
  if (checked.sql) return failure(c, 501, "sql-not-supported", SQL_NOT_SUPPORTED)

  const [duplicate] = await db.select({ id: schema.problem.id }).from(schema.problem)
    .where(and(eq(schema.problem.displayId, parsed.data._id), eq(schema.problem.contestId, contestId))).limit(1)
  if (duplicate) return failure(c, 409, "display-id-exists", "Duplicate Display id")

  const now = new Date().toISOString()
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.problem).values({
      ...problemValues(parsed.data, false),
      contestId,
      createdById: user.id,
      createTime: now,
      lastUpdateTime: now,
      submissionNumber: 0,
      acceptedNumber: 0,
      statisticInfo: {},
      isPublic: false,
      sqlDisplay: null,
    }).returning()
    await setTags(tx as unknown as typeof db, row!.id, parsed.data.tags)
    return row!
  })
  return success(c, await serialize(created), 201)
})

// ---------------------------------------------------------------- 比赛题 ⇄ 公开题

adminProblemRoutes.post("/problems/:id/make-public", requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = makeProblemPublicRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "displayId 不能为空")

  const [problem] = await db.select().from(schema.problem).where(eq(schema.problem.id, id)).limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!problem.contestId || problem.isPublic) {
    return failure(c, 409, "already-public", "Already be a public problem")
  }
  const [duplicate] = await db.select({ id: schema.problem.id }).from(schema.problem)
    .where(and(eq(schema.problem.displayId, parsed.data.displayId), isNull(schema.problem.contestId))).limit(1)
  if (duplicate) return failure(c, 409, "display-id-exists", "Duplicate display ID")

  const now = new Date().toISOString()
  const created = await db.transaction(async (tx) => {
    // 原比赛题标记成「已转公开」，避免同一道题被转两次
    await tx.update(schema.problem).set({ isPublic: true }).where(eq(schema.problem.id, id))
    const { id: _old, ...rest } = problem
    const [copy] = await tx.insert(schema.problem).values({
      ...rest,
      contestId: null,
      displayId: parsed.data.displayId,
      // 转出来的公开题默认不可见：题面往往还要按公开场景改一遍
      visible: false,
      isPublic: true,
      submissionNumber: 0,
      acceptedNumber: 0,
      statisticInfo: {},
      createTime: now,
      lastUpdateTime: now,
    }).returning()
    const tags = await tx.select({ tagId: schema.problemTags.problemtagId })
      .from(schema.problemTags).where(eq(schema.problemTags.problemId, id))
    if (tags.length) {
      await tx.insert(schema.problemTags).values(tags.map((tag) => ({
        problemId: copy!.id, problemtagId: tag.tagId,
      })))
    }
    return copy!
  })
  return success(c, await serialize(created), 201)
})

adminProblemRoutes.post("/contests/:contestId/problems/from-public", requireProblemPermission, async (c) => {
  const contestId = queryInteger(c.req.param("contestId"), 0, { min: 1 })
  const parsed = addContestProblemRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const [contest] = await db.select().from(schema.contest).where(eq(schema.contest.id, contestId)).limit(1)
  const [problem] = await db.select().from(schema.problem)
    .where(eq(schema.problem.id, parsed.data.problemId)).limit(1)
  if (!contest || !problem) return failure(c, 404, "not-found", "Contest or Problem does not exist")
  const user = c.get("user")!
  if (user.adminType !== "Super Admin" && contest.createdById !== user.id) {
    return failure(c, 404, "contest-not-found", "Contest does not exist")
  }
  if (contestStatus(contest) === "-1") return failure(c, 409, "contest-ended", "Contest has ended")

  const [duplicate] = await db.select({ id: schema.problem.id }).from(schema.problem)
    .where(and(eq(schema.problem.contestId, contestId), eq(schema.problem.displayId, parsed.data.displayId))).limit(1)
  if (duplicate) return failure(c, 409, "display-id-exists", "Duplicate display id in this contest")

  const now = new Date().toISOString()
  const created = await db.transaction(async (tx) => {
    const { id: _old, ...rest } = problem
    const [copy] = await tx.insert(schema.problem).values({
      ...rest,
      contestId,
      isPublic: true,
      visible: true,
      displayId: parsed.data.displayId,
      submissionNumber: 0,
      acceptedNumber: 0,
      statisticInfo: {},
      createTime: now,
      lastUpdateTime: now,
    }).returning()
    const tags = await tx.select({ tagId: schema.problemTags.problemtagId })
      .from(schema.problemTags).where(eq(schema.problemTags.problemId, problem.id))
    if (tags.length) {
      await tx.insert(schema.problemTags).values(tags.map((tag) => ({
        problemId: copy!.id, problemtagId: tag.tagId,
      })))
    }
    return copy!
  })
  return success(c, await serialize(created), 201)
})

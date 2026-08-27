import {
  acTrendSchema,
  adminTagSchema,
  batchProblemTagRequestSchema,
  batchProblemTagResponseSchema,
  generateFlowchartRequestSchema,
  generateFlowchartResponseSchema,
  renameTagRequestSchema,
  renameTagResponseSchema,
  stuckProblemSchema,
} from "@oj2/contract"
import { and, asc, countDistinct, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireProblemPermission, requireTeacher, type AppEnv } from "../../auth/middleware"
import type { AuthUser } from "../../auth/session"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { JudgeStatus } from "../../judge/status"
import { completeChat } from "../../services/ai"
import { queryInteger, rounded } from "../helpers"
import { findTagsByName, normalizeTagNames } from "./problem"

export const adminTagRoutes = new Hono<AppEnv>()

const ACCEPTED = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]
const FAILED = [JudgeStatus.WRONG_ANSWER, JudgeStatus.COMPILE_ERROR, JudgeStatus.RUNTIME_ERROR]

/** 能管所有题目：超管，或 problemPermission 为 All */
function canManageAllProblems(user: AuthUser) {
  return user.adminType === "Super Admin" || user.problemPermission === "All"
}

// ---------------------------------------------------------------- 标签

adminTagRoutes.get("/problem-tags", requireProblemPermission, async (c) => {
  const keyword = c.req.query("keyword")?.trim()
  const rows = await db.select({
    id: schema.problemTag.id,
    name: schema.problemTag.name,
    problemCount: countDistinct(schema.problemTags.problemId),
  }).from(schema.problemTag)
    .leftJoin(schema.problemTags, eq(schema.problemTags.problemtagId, schema.problemTag.id))
    .where(keyword ? ilike(schema.problemTag.name, `%${keyword}%`) : undefined)
    .groupBy(schema.problemTag.id, schema.problemTag.name)
    // 后台标签管理要看到 problemCount=0 的标签（正是要清理的那些），
    // 所以这里用 leftJoin 且不加 having —— oj 侧的 /problem-tags 才过滤 >0
    .orderBy(desc(countDistinct(schema.problemTags.problemId)), asc(schema.problemTag.name))
  return success(c, rows.map((row) => adminTagSchema.parse(row)))
})

adminTagRoutes.put("/problem-tags/:id", requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = renameTagRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "标签名不能为空")
  const name = parsed.data.name

  const [tag] = await db.select().from(schema.problemTag).where(eq(schema.problemTag.id, id)).limit(1)
  if (!tag) return failure(c, 404, "tag-not-found", "标签不存在，请刷新后重试")

  const [target] = await db.select().from(schema.problemTag)
    .where(and(sql`lower(${schema.problemTag.name}) = lower(${name})`, ne(schema.problemTag.id, id))).limit(1)

  if (!target) {
    await db.update(schema.problemTag).set({ name }).where(eq(schema.problemTag.id, id))
    return success(c, renameTagResponseSchema.parse({ merged: false, id, name, affectedCount: 0 }))
  }

  // 改名撞上已有标签，视为合并：题目关系转移过去，原标签删除
  const affected = await db.transaction(async (tx) => {
    const links = await tx.select({ problemId: schema.problemTags.problemId })
      .from(schema.problemTags).where(eq(schema.problemTags.problemtagId, id))
    const already = new Set((await tx.select({ problemId: schema.problemTags.problemId })
      .from(schema.problemTags).where(eq(schema.problemTags.problemtagId, target.id)))
      .map((row) => row.problemId))
    // 只给还没挂目标标签的题目补关系，否则会撞 (problem_id, problemtag_id) 唯一约束
    const missing = links.filter((link) => !already.has(link.problemId))
    if (missing.length) {
      await tx.insert(schema.problemTags).values(missing.map((link) => ({
        problemId: link.problemId,
        problemtagId: target.id,
      })))
    }
    await tx.delete(schema.problemTags).where(eq(schema.problemTags.problemtagId, id))
    await tx.delete(schema.problemTag).where(eq(schema.problemTag.id, id))
    return links.length
  })
  return success(c, renameTagResponseSchema.parse({
    merged: true, id: target.id, name: target.name, affectedCount: affected,
  }))
})

adminTagRoutes.delete("/problem-tags/:id", requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  // 中间表是 NO ACTION 外键，得先清关系再删标签
  const deleted = await db.transaction(async (tx) => {
    await tx.delete(schema.problemTags).where(eq(schema.problemTags.problemtagId, id))
    return tx.delete(schema.problemTag).where(eq(schema.problemTag.id, id))
      .returning({ id: schema.problemTag.id })
  })
  if (deleted.length === 0) return failure(c, 404, "tag-not-found", "标签不存在，请刷新后重试")
  return success(c, null)
})

adminTagRoutes.post("/problems/batch-tag", requireProblemPermission, async (c) => {
  const parsed = batchProblemTagRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const user = c.get("user")!
  const filters = [inArray(schema.problem.id, parsed.data.problemIds), isNull(schema.problem.contestId)]
  if (!canManageAllProblems(user)) filters.push(eq(schema.problem.createdById, user.id))
  const problems = await db.select({ id: schema.problem.id }).from(schema.problem).where(and(...filters))
  if (problems.length === 0) return failure(c, 404, "no-problems", "没有可操作的题目")

  // 去重且大小写不敏感，与旧 resolve_tags / find_tags 一致
  const wanted = normalizeTagNames(parsed.data.tagNames)

  const tagIds = await db.transaction(async (tx) => {
    const existing = await findTagsByName(tx as unknown as typeof db, wanted)
    // 添加时按需新建标签，移除时只认已有标签 —— 否则「移除」会顺手造出一堆空标签
    if (parsed.data.action === "add") {
      const missing = wanted.filter((name) => !existing.has(name.toLowerCase()))
      if (missing.length) {
        const created = await tx.insert(schema.problemTag).values(missing.map((name) => ({ name })))
          .returning({ id: schema.problemTag.id, name: schema.problemTag.name })
        for (const row of created) existing.set(row.name.toLowerCase(), row.id)
      }
    }
    return wanted.map((name) => existing.get(name.toLowerCase())).filter((id) => id !== undefined)
  })
  if (tagIds.length === 0) return failure(c, 404, "no-tags", "没有匹配的标签")

  const problemIds = problems.map((problem) => problem.id)
  await db.transaction(async (tx) => {
    if (parsed.data.action === "remove") {
      await tx.delete(schema.problemTags).where(and(
        inArray(schema.problemTags.problemId, problemIds),
        inArray(schema.problemTags.problemtagId, tagIds),
      ))
      return
    }
    const existing = await tx.select().from(schema.problemTags).where(and(
      inArray(schema.problemTags.problemId, problemIds),
      inArray(schema.problemTags.problemtagId, tagIds),
    ))
    const have = new Set(existing.map((row) => `${row.problemId}:${row.problemtagId}`))
    const rows = []
    for (const problemId of problemIds) {
      for (const tagId of tagIds) {
        if (!have.has(`${problemId}:${tagId}`)) rows.push({ problemId, problemtagId: tagId })
      }
    }
    if (rows.length) await tx.insert(schema.problemTags).values(rows)
  })

  return success(c, batchProblemTagResponseSchema.parse({
    problemCount: problems.length,
    tagCount: tagIds.length,
  }))
})

// ---------------------------------------------------------------- 题目可见性

adminTagRoutes.put("/problems/:id/visibility", requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [problem] = await db.select({ id: schema.problem.id, visible: schema.problem.visible, createdById: schema.problem.createdById })
    .from(schema.problem).where(eq(schema.problem.id, id)).limit(1)
  // 旧后端这里的 `self.error(...)` 少写了 return，题目不存在时会继续往下跑并抛
  // AttributeError（500）。这里正常返回 404。
  if (!problem) return failure(c, 404, "problem-not-found", "题目不存在")
  const user = c.get("user")!
  if (!canManageAllProblems(user) && problem.createdById !== user.id) {
    return failure(c, 404, "problem-not-found", "题目不存在")
  }
  await db.update(schema.problem).set({ visible: !problem.visible }).where(eq(schema.problem.id, id))
  return success(c, { visible: !problem.visible })
})

// ---------------------------------------------------------------- 卡点题目 / AC 趋势

// 路径特意不放在 /problems 下：Hono 按**注册顺序**匹配（不是静态优先），
// 而 problem.ts 的 `GET /problems/:id` 先注册，会把 `/problems/stuck` 整个吃掉 ——
// 这两个 handler 曾经从未执行过，生效的还是那边的 requireProblemPermission 而非这里的
// requireTeacher，而且完全没有报错。换个前缀，结构上就不可能再被遮蔽。
adminTagRoutes.get("/problem-analytics/stuck", requireTeacher, async (c) => {
  const failedFilter = sql`filter (where ${inArray(schema.submission.result, FAILED)})`
  const rows = await db.select({
    displayId: schema.problem.displayId,
    title: schema.problem.title,
    total: count(),
    accepted: sql<number>`count(*) filter (where ${inArray(schema.submission.result, ACCEPTED)})`.mapWith(Number),
    failed: sql<number>`count(*) ${failedFilter}`.mapWith(Number),
    failedUsers: sql<number>`count(distinct ${schema.submission.userId}) ${failedFilter}`.mapWith(Number),
  }).from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .groupBy(schema.problem.id, schema.problem.displayId, schema.problem.title)
    .having(sql`count(distinct ${schema.submission.userId}) ${failedFilter} > 0`)
    .orderBy(desc(sql`count(distinct ${schema.submission.userId}) ${failedFilter}`))
    .limit(40)
  return success(c, rows.map((row) => stuckProblemSchema.parse({
    problemId: row.displayId,
    problemTitle: row.title,
    total: row.total,
    failed: row.failed,
    failedUsers: row.failedUsers,
    acRate: row.total ? rounded((row.accepted / row.total) * 100, 1) : 0,
  })))
})

adminTagRoutes.get("/problem-analytics/ac-trend", requireTeacher, async (c) => {
  const currentYear = new Date().getFullYear()
  // 参数按旧后端的口径夹逼：越界一律回落到默认值，不报错
  let sinceYear = queryInteger(c.req.query("sinceYear"), 2023)
  if (sinceYear < 2022 || sinceYear > currentYear) sinceYear = 2023
  let untilYear = queryInteger(c.req.query("untilYear"), currentYear)
  if (untilYear < sinceYear || untilYear > currentYear) untilYear = currentYear - 1
  let minPerYear = queryInteger(c.req.query("minPerYear"), 100)
  if (![50, 100, 200].includes(minPerYear)) minPerYear = 100

  const year = sql<number>`extract(year from ${schema.submission.createTime})`.mapWith(Number)
  const rows = await db.select({
    problemId: schema.problem.id,
    displayId: schema.problem.displayId,
    title: schema.problem.title,
    year,
    total: count(),
    accepted: sql<number>`count(*) filter (where ${inArray(schema.submission.result, ACCEPTED)})`.mapWith(Number),
  }).from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .where(and(
      isNull(schema.submission.contestId),
      gte(sql`extract(year from ${schema.submission.createTime})`, sinceYear),
      lte(sql`extract(year from ${schema.submission.createTime})`, untilYear),
    ))
    .groupBy(schema.problem.id, schema.problem.displayId, schema.problem.title, year)
    .orderBy(asc(schema.problem.id), asc(year))

  const required = new Set<number>()
  for (let y = sinceYear; y <= untilYear; y += 1) required.add(y)

  const grouped = new Map<number, { displayId: string; title: string; yearly: typeof rows }>()
  for (const row of rows) {
    const bucket = grouped.get(row.problemId)
    if (bucket) bucket.yearly.push(row)
    else grouped.set(row.problemId, { displayId: row.displayId, title: row.title, yearly: [row] })
  }

  const result = []
  for (const entry of grouped.values()) {
    const years = new Set(entry.yearly.map((row) => row.year))
    // 每一年都得有数据，且每年提交量都超过门槛 —— 否则趋势没有可比性
    if (![...required].every((y) => years.has(y))) continue
    if (!entry.yearly.every((row) => row.total > minPerYear)) continue
    result.push(acTrendSchema.parse({
      problemId: entry.displayId,
      problemTitle: entry.title,
      yearly: entry.yearly
        .map((row) => ({
          year: row.year,
          total: row.total,
          accepted: row.accepted,
          acRate: row.total ? rounded((row.accepted / row.total) * 100, 1) : 0,
        }))
        .sort((left, right) => left.year - right.year),
    }))
  }
  return success(c, result)
})

// ---------------------------------------------------------------- Python → 流程图

adminTagRoutes.post("/problems/flowchart", requireProblemPermission, async (c) => {
  const parsed = generateFlowchartRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "python 代码不能为空")
  try {
    const flowchart = await completeChat(
      `你是一个可以将Python代码转换为mermaid的助手。
请将用户提供的Python代码转换为 Mermaid 纯文本。
注意括号内的内容用引号包裹，如果本身就有引号，请注意双引号和单引号的问题。
请只返回 mermaid 代码，连 \`\`\` 都不需要。`,
      parsed.data.python,
    )
    return success(c, generateFlowchartResponseSchema.parse({ flowchart }))
  } catch (error) {
    console.error("Flowchart generation failed", error)
    return failure(c, 502, "ai-unavailable", "生成失败，请稍后再试")
  }
})

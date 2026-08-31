import {
  addProblemToSetRequestSchema,
  adminProblemSetBadgeSchema,
  adminProblemSetListSchema,
  adminProblemSetProblemSchema,
  adminProblemSetProgressSchema,
  adminProblemSetSchema,
  createProblemSetBadgeRequestSchema,
  createProblemSetRequestSchema,
  updateProblemInSetRequestSchema,
  updateProblemSetBadgeRequestSchema,
  updateProblemSetRequestSchema,
  updateProblemSetStatusRequestSchema,
} from "@oj2/contract"
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireTeacher, type AppEnv } from "../../auth/middleware"
import type { AuthUser } from "../../auth/session"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { recalculateBadge, resyncProgress } from "../../services/problemset"
import { queryInteger, sampleUser } from "../helpers"

export const adminProblemSetRoutes = new Hono<AppEnv>()

type BadgeRow = typeof schema.problemsetBadge.$inferSelect

/** 对齐旧 ensure_created_by：超管放行，其余人只能碰自己建的。越权报「不存在」 */
function ownedBy(user: AuthUser, row: { createdById: number }) {
  return user.adminType === "Super Admin" || row.createdById === user.id
}

/**
 * 取出题单并校验归属。所有嵌套资源（题目/奖章/进度）都先过这一关 ——
 * 旧后端每个方法开头都手抄一遍这段 try/except，抄了 14 遍。
 */
async function loadOwned(c: { req: { param(name: string): string } }, user: AuthUser) {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [row] = await db.select().from(schema.problemset).where(eq(schema.problemset.id, id)).limit(1)
  return row && ownedBy(user, row) ? row : null
}

async function serialize(row: typeof schema.problemset.$inferSelect) {
  return (await serializeMany([row]))[0]!
}

/** 批量版：列表接口走这个，固定 3 条查询，与行数无关（按行 serialize 就是 N+1） */
async function serializeMany(rows: (typeof schema.problemset.$inferSelect)[]) {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const [problems, participants, creators] = await Promise.all([
    db.select({ problemsetId: schema.problemsetProblem.problemsetId, value: count() })
      .from(schema.problemsetProblem).where(inArray(schema.problemsetProblem.problemsetId, ids))
      .groupBy(schema.problemsetProblem.problemsetId),
    db.select({ problemsetId: schema.problemsetProgress.problemsetId, value: count() })
      .from(schema.problemsetProgress).where(inArray(schema.problemsetProgress.problemsetId, ids))
      .groupBy(schema.problemsetProgress.problemsetId),
    db.select({ id: schema.user.id, username: schema.user.username, realName: schema.userProfile.realName })
      .from(schema.user).leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(inArray(schema.user.id, [...new Set(rows.map((row) => row.createdById))])),
  ])
  const problemsBySet = new Map(problems.map((item) => [item.problemsetId, item.value]))
  const participantsBySet = new Map(participants.map((item) => [item.problemsetId, item.value]))
  const creatorById = new Map(creators.map((item) => [item.id, item]))
  return rows.map((row) => {
    const creator = creatorById.get(row.createdById)
    return adminProblemSetSchema.parse({
      id: row.id,
      title: row.title,
      description: row.description,
      difficulty: row.difficulty,
      status: row.status,
      endTime: row.endTime,
      visible: row.visible,
      createdBy: sampleUser(creator ?? { id: row.createdById, username: "" }, creator?.realName),
      createTime: row.createTime,
      lastUpdateTime: row.lastUpdateTime,
      problemsCount: problemsBySet.get(row.id) ?? 0,
      participantCount: participantsBySet.get(row.id) ?? 0,
    })
  })
}

// ---------------------------------------------------------------- 题单本体

adminProblemSetRoutes.get("/problem-sets", requireTeacher, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const user = c.get("user")!
  const filters = []
  // 注意：这里**不过滤 visible**。旧后端的列表写死了 visible=True，可它同时又提供
  // 「切换可见性」的接口 —— 一旦把题单设成不可见，它就从后台列表里消失，
  // 再也没法在界面上改回来。后台必须能看见自己管的全部题单。
  if (user.adminType !== "Super Admin") filters.push(eq(schema.problemset.createdById, user.id))
  const keyword = c.req.query("keyword")?.trim()
  const difficulty = c.req.query("difficulty")?.trim()
  const status = c.req.query("status")?.trim()
  if (keyword) {
    filters.push(or(
      ilike(schema.problemset.title, `%${keyword}%`),
      ilike(schema.problemset.description, `%${keyword}%`),
    )!)
  }
  if (difficulty) filters.push(eq(schema.problemset.difficulty, difficulty))
  if (status) filters.push(eq(schema.problemset.status, status))
  const where = filters.length ? and(...filters) : undefined

  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.problemset).where(where),
    db.select().from(schema.problemset).where(where)
      .orderBy(desc(schema.problemset.createTime)).limit(limit).offset(offset),
  ])
  return success(c, adminProblemSetListSchema.parse({
    results: await serializeMany(rows),
    total: totalRows[0]?.value ?? 0,
  }))
})

adminProblemSetRoutes.post("/problem-sets", requireTeacher, async (c) => {
  const parsed = createProblemSetRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const now = new Date().toISOString()
  const [created] = await db.insert(schema.problemset).values({
    ...parsed.data,
    endTime: parsed.data.endTime ? new Date(parsed.data.endTime).toISOString() : null,
    createdById: c.get("user")!.id,
    createTime: now,
    lastUpdateTime: now,
  }).returning()
  return success(c, await serialize(created!), 201)
})

adminProblemSetRoutes.get("/problem-sets/:id", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  return success(c, await serialize(row))
})

adminProblemSetRoutes.put("/problem-sets/:id", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = updateProblemSetRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const [updated] = await db.update(schema.problemset).set({
    ...parsed.data,
    endTime: parsed.data.endTime ? new Date(parsed.data.endTime).toISOString() : null,
    lastUpdateTime: new Date().toISOString(),
  }).where(eq(schema.problemset.id, row.id)).returning()
  return success(c, await serialize(updated!))
})

adminProblemSetRoutes.put("/problem-sets/:id/visibility", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  // 旧接口是「取反」语义，前端只传 id 不传目标值。保持不变：前端按钮就是个开关
  const [updated] = await db.update(schema.problemset)
    .set({ visible: !row.visible, lastUpdateTime: new Date().toISOString() })
    .where(eq(schema.problemset.id, row.id)).returning()
  return success(c, await serialize(updated!))
})

adminProblemSetRoutes.put("/problem-sets/:id/status", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = updateProblemSetStatusRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "status 不合法")
  const [updated] = await db.update(schema.problemset)
    .set({ status: parsed.data.status, lastUpdateTime: new Date().toISOString() })
    .where(eq(schema.problemset.id, row.id)).returning()
  return success(c, await serialize(updated!))
})

adminProblemSetRoutes.delete("/problem-sets/:id", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  // 五张子表全是 NO ACTION 外键，Django 的级联在应用层。顺序不能反：
  // user_badge 挂在 problemset_badge 上，得先于 badge 删
  await db.transaction(async (tx) => {
    const badges = await tx.select({ id: schema.problemsetBadge.id }).from(schema.problemsetBadge)
      .where(eq(schema.problemsetBadge.problemsetId, row.id))
    if (badges.length) {
      await tx.delete(schema.userBadge).where(inArray(schema.userBadge.badgeId, badges.map((b) => b.id)))
    }
    await tx.delete(schema.problemsetBadge).where(eq(schema.problemsetBadge.problemsetId, row.id))
    await tx.delete(schema.problemsetSubmission).where(eq(schema.problemsetSubmission.problemsetId, row.id))
    await tx.delete(schema.problemsetProgress).where(eq(schema.problemsetProgress.problemsetId, row.id))
    await tx.delete(schema.problemsetProblem).where(eq(schema.problemsetProblem.problemsetId, row.id))
    await tx.delete(schema.problemset).where(eq(schema.problemset.id, row.id))
  })
  return success(c, null)
})

// ---------------------------------------------------------------- 题单里的题目

adminProblemSetRoutes.get("/problem-sets/:id/problems", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const rows = await db.select({ item: schema.problemsetProblem, problem: schema.problem })
    .from(schema.problemsetProblem)
    .innerJoin(schema.problem, eq(schema.problemsetProblem.problemId, schema.problem.id))
    .where(eq(schema.problemsetProblem.problemsetId, row.id))
    .orderBy(asc(schema.problemsetProblem.order), asc(schema.problemsetProblem.id))
  return success(c, rows.map(({ item, problem }) => adminProblemSetProblemSchema.parse({
    id: item.id,
    problemsetId: item.problemsetId,
    problemId: item.problemId,
    displayId: problem.displayId,
    title: problem.title,
    difficulty: problem.difficulty,
    order: item.order,
    isRequired: item.isRequired,
    score: item.score,
    hint: item.hint,
  })))
})

adminProblemSetRoutes.post("/problem-sets/:id/problems", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = addProblemToSetRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const [problem] = await db.select({ id: schema.problem.id }).from(schema.problem).where(and(
    sql`lower(${schema.problem.displayId}) = lower(${parsed.data.problemId})`,
    eq(schema.problem.visible, true),
    isNull(schema.problem.contestId),
  )).limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "题目不存在或不可见")

  const [duplicate] = await db.select({ id: schema.problemsetProblem.id }).from(schema.problemsetProblem)
    .where(and(
      eq(schema.problemsetProblem.problemsetId, row.id),
      eq(schema.problemsetProblem.problemId, problem.id),
    )).limit(1)
  if (duplicate) return failure(c, 409, "problem-already-in-set", "题目已在该题单中")

  const [created] = await db.insert(schema.problemsetProblem).values({
    problemsetId: row.id,
    problemId: problem.id,
    order: parsed.data.order,
    isRequired: parsed.data.isRequired,
    score: parsed.data.score,
    hint: parsed.data.hint,
  }).returning({ id: schema.problemsetProblem.id })
  // 题目集变了，已加入的人的 totalProblemsCount / 百分比都得跟着变，
  // 否则学生看到的进度分母还是老的。旧栈是靠 ProblemSetProblem 的 post_save 信号做的，
  // 不在 views 里，别因为翻不到显式调用就以为它没做（见 services/problemset.ts）。
  await resyncProgress(row.id)
  return success(c, { id: created!.id }, 201)
})

adminProblemSetRoutes.put("/problem-sets/:id/problems/:itemId", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = updateProblemInSetRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "参数错误")
  const updated = await db.update(schema.problemsetProblem).set(parsed.data).where(and(
    eq(schema.problemsetProblem.id, queryInteger(c.req.param("itemId"), 0, { min: 1 })),
    eq(schema.problemsetProblem.problemsetId, row.id),
  )).returning({ id: schema.problemsetProblem.id })
  if (updated.length === 0) return failure(c, 404, "problem-not-in-set", "题目不在该题单中")
  if (parsed.data.score !== undefined) await resyncProgress(row.id)
  return success(c, null)
})

adminProblemSetRoutes.delete("/problem-sets/:id/problems/:itemId", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const deleted = await db.delete(schema.problemsetProblem).where(and(
    eq(schema.problemsetProblem.id, queryInteger(c.req.param("itemId"), 0, { min: 1 })),
    eq(schema.problemsetProblem.problemsetId, row.id),
  )).returning({ id: schema.problemsetProblem.id })
  if (deleted.length === 0) return failure(c, 404, "problem-not-in-set", "题目不在该题单中")
  await resyncProgress(row.id)
  return success(c, null)
})

// ---------------------------------------------------------------- 奖章

async function badgeWithCount(badge: BadgeRow) {
  return (await badgesWithCount([badge]))[0]!
}

/** 批量版：一条 group by 数完整批奖章的获得人数 */
async function badgesWithCount(badges: BadgeRow[]) {
  if (badges.length === 0) return []
  const earned = await db.select({ badgeId: schema.userBadge.badgeId, value: count() })
    .from(schema.userBadge).where(inArray(schema.userBadge.badgeId, badges.map((badge) => badge.id)))
    .groupBy(schema.userBadge.badgeId)
  const countByBadge = new Map(earned.map((item) => [item.badgeId, item.value]))
  return badges.map((badge) => adminProblemSetBadgeSchema.parse({
    id: badge.id,
    problemsetId: badge.problemsetId,
    name: badge.name,
    description: badge.description,
    icon: badge.icon,
    conditionType: badge.conditionType,
    conditionValue: badge.conditionValue,
    earnedCount: countByBadge.get(badge.id) ?? 0,
  }))
}

adminProblemSetRoutes.get("/problem-sets/:id/badges", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const badges = await db.select().from(schema.problemsetBadge)
    .where(eq(schema.problemsetBadge.problemsetId, row.id)).orderBy(asc(schema.problemsetBadge.id))
  return success(c, await badgesWithCount(badges))
})

adminProblemSetRoutes.post("/problem-sets/:id/badges", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = createProblemSetBadgeRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const [created] = await db.insert(schema.problemsetBadge).values({
    ...parsed.data,
    problemsetId: row.id,
  }).returning()
  // 新建奖章要立刻补发给已达标的人 —— 旧后端靠 post_save 信号，这里显式调
  await recalculateBadge(created!)
  return success(c, await badgeWithCount(created!), 201)
})

adminProblemSetRoutes.put("/problem-sets/:id/badges/:badgeId", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = updateProblemSetBadgeRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  const [updated] = await db.update(schema.problemsetBadge).set(parsed.data).where(and(
    eq(schema.problemsetBadge.id, queryInteger(c.req.param("badgeId"), 0, { min: 1 })),
    eq(schema.problemsetBadge.problemsetId, row.id),
  )).returning()
  if (!updated) return failure(c, 404, "badge-not-found", "奖章不存在")
  await recalculateBadge(updated)
  return success(c, await badgeWithCount(updated))
})

adminProblemSetRoutes.delete("/problem-sets/:id/badges/:badgeId", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const badgeId = queryInteger(c.req.param("badgeId"), 0, { min: 1 })
  // 必须先确认这枚奖章确实属于本题单，再动 user_badge。
  // 早先的写法把 userBadge 的清理放在归属校验之前、且只按 badgeId 不限定题单，
  // 于是「自己的题单 id + 别人的奖章 id」会真删掉别人的获奖记录，
  // 然后因为 problemset_badge 删了 0 行而返回 404 —— 事务已经 COMMIT，数据没了却报「不存在」。
  const [badge] = await db.select({ id: schema.problemsetBadge.id }).from(schema.problemsetBadge)
    .where(and(
      eq(schema.problemsetBadge.id, badgeId),
      eq(schema.problemsetBadge.problemsetId, row.id),
    )).limit(1)
  if (!badge) return failure(c, 404, "badge-not-found", "奖章不存在")
  await db.transaction(async (tx) => {
    await tx.delete(schema.userBadge).where(eq(schema.userBadge.badgeId, badge.id))
    await tx.delete(schema.problemsetBadge).where(eq(schema.problemsetBadge.id, badge.id))
  })
  return success(c, null)
})

// ---------------------------------------------------------------- 学生进度

adminProblemSetRoutes.get("/problem-sets/:id/progress", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const rows = await db.select({
    progress: schema.problemsetProgress,
    username: schema.user.username,
    realName: schema.userProfile.realName,
  }).from(schema.problemsetProgress)
    .innerJoin(schema.user, eq(schema.problemsetProgress.userId, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.problemsetProgress.problemsetId, row.id))
    .orderBy(desc(schema.problemsetProgress.joinTime))
  return success(c, rows.map(({ progress, username, realName }) =>
    adminProblemSetProgressSchema.parse({
      id: progress.id,
      userId: progress.userId,
      username,
      // 真名有意下发：这是老师看本班完成情况的页面，已由 requireTeacher + 归属校验把关
      realName,
      joinTime: progress.joinTime,
      completeTime: progress.completeTime,
      isCompleted: progress.isCompleted,
      progressPercentage: progress.progressPercentage,
      completedProblemsCount: progress.completedProblemsCount,
      totalProblemsCount: progress.totalProblemsCount,
      totalScore: progress.totalScore,
    })))
})

adminProblemSetRoutes.delete("/problem-sets/:id/progress/:userId", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const userId = queryInteger(c.req.param("userId"), 0, { min: 1 })
  const deleted = await db.transaction(async (tx) => {
    // 把人踢出题单，他基于这份题单拿到的奖章也该收回，否则奖章会悬空
    const badges = await tx.select({ id: schema.problemsetBadge.id }).from(schema.problemsetBadge)
      .where(eq(schema.problemsetBadge.problemsetId, row.id))
    if (badges.length) {
      await tx.delete(schema.userBadge).where(and(
        eq(schema.userBadge.userId, userId),
        inArray(schema.userBadge.badgeId, badges.map((badge) => badge.id)),
      ))
    }
    await tx.delete(schema.problemsetSubmission).where(and(
      eq(schema.problemsetSubmission.problemsetId, row.id),
      eq(schema.problemsetSubmission.userId, userId),
    ))
    return tx.delete(schema.problemsetProgress).where(and(
      eq(schema.problemsetProgress.problemsetId, row.id),
      eq(schema.problemsetProgress.userId, userId),
    )).returning({ id: schema.problemsetProgress.id })
  })
  if (deleted.length === 0) return failure(c, 404, "progress-not-found", "用户未加入该题单")
  return success(c, null)
})

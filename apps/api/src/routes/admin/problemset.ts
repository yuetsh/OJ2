import {
  addProblemsToSetRequestSchema,
  createProblemSetBadgeRequestSchema,
  createProblemSetRequestSchema,
  reorderProblemSetProblemsRequestSchema,
  updateProblemInSetRequestSchema,
  updateProblemSetBadgeRequestSchema,
  updateProblemSetRequestSchema,
  type AddProblemsToSetResult,
  type AdminProblemSet,
  type AdminProblemSetBadge,
  type AdminProblemSetList,
  type AdminProblemSetProblem,
} from "@oj2/contract"
import { and, asc, count, desc, eq, ilike, inArray, isNull, max, or, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireTeacher, type AppEnv } from "../../auth/middleware"
import type { AuthUser } from "../../auth/session"
import { db, schema } from "../../db"
import { failure, parseBody, success } from "../../http"
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
  const [row] = await db
    .select()
    .from(schema.problemset)
    .where(eq(schema.problemset.id, id))
    .limit(1)
  return row && ownedBy(user, row) ? row : null
}

async function serialize(row: typeof schema.problemset.$inferSelect) {
  return (await serializeMany([row]))[0]!
}

/** 批量版：列表接口走这个，固定 4 条查询，与行数无关（按行 serialize 就是 N+1） */
async function serializeMany(rows: (typeof schema.problemset.$inferSelect)[]) {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const [problems, participants, badges, creators] = await Promise.all([
    db
      .select({
        problemsetId: schema.problemsetProblem.problemsetId,
        value: count(),
      })
      .from(schema.problemsetProblem)
      .where(inArray(schema.problemsetProblem.problemsetId, ids))
      .groupBy(schema.problemsetProblem.problemsetId),
    db
      .select({
        problemsetId: schema.problemsetProgress.problemsetId,
        value: count(),
        completed: sql<number>`count(*) filter (where ${schema.problemsetProgress.isCompleted})::int`,
      })
      .from(schema.problemsetProgress)
      .where(inArray(schema.problemsetProgress.problemsetId, ids))
      .groupBy(schema.problemsetProgress.problemsetId),
    db
      .select({
        problemsetId: schema.problemsetBadge.problemsetId,
        value: count(),
      })
      .from(schema.problemsetBadge)
      .where(inArray(schema.problemsetBadge.problemsetId, ids))
      .groupBy(schema.problemsetBadge.problemsetId),
    db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        realName: schema.userProfile.realName,
      })
      .from(schema.user)
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(inArray(schema.user.id, [...new Set(rows.map((row) => row.createdById))])),
  ])
  const problemsBySet = new Map(problems.map((item) => [item.problemsetId, item.value]))
  const participantsBySet = new Map(participants.map((item) => [item.problemsetId, item]))
  const badgesBySet = new Map(badges.map((item) => [item.problemsetId, item.value]))
  const creatorById = new Map(creators.map((item) => [item.id, item]))
  const now = Date.now()
  return rows.map((row) => {
    const creator = creatorById.get(row.createdById)
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      assignedUntil: row.assignedUntil,
      assignedAt: row.assignedAt,
      assigning:
        row.assignedAt !== null &&
        row.assignedUntil !== null &&
        Date.parse(row.assignedUntil) > now,
      visible: row.visible,
      createdBy: sampleUser(creator ?? { id: row.createdById, username: "" }, creator?.realName),
      createTime: row.createTime,
      lastUpdateTime: row.lastUpdateTime,
      problemsCount: problemsBySet.get(row.id) ?? 0,
      participantCount: participantsBySet.get(row.id)?.value ?? 0,
      completedCount: participantsBySet.get(row.id)?.completed ?? 0,
      badgeCount: badgesBySet.get(row.id) ?? 0,
    } satisfies AdminProblemSet
  })
}

/**
 * 布置期怎么落库。老师给的是「布置到哪天」（东八区当天结束的时刻），开始时刻由服务端定：
 *   - 不布置 → 两个都清掉；
 *   - 现在正在布置 → 只改结束，开始不动（延长、缩短都不该把「以前的代码」的分界挪到现在）；
 *   - 没在布置（从没布置过，或者上一轮已经过期）→ 开始记成现在，这就是「再布置一次」。
 */
function assignment(
  requested: string | null,
  current: { assignedAt: string | null; assignedUntil: string | null } | null,
) {
  if (requested === null) return { assignedAt: null, assignedUntil: null }
  const until = Date.parse(requested)
  if (!Number.isFinite(until) || until <= Date.now()) return "past" as const
  const running =
    current?.assignedAt != null &&
    current.assignedUntil != null &&
    Date.parse(current.assignedUntil) > Date.now()
  return {
    assignedAt: running ? current.assignedAt : new Date().toISOString(),
    assignedUntil: new Date(until).toISOString(),
  }
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
  if (keyword) {
    filters.push(
      or(
        ilike(schema.problemset.title, `%${keyword}%`),
        ilike(schema.problemset.description, `%${keyword}%`),
      )!,
    )
  }
  const where = filters.length ? and(...filters) : undefined

  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.problemset).where(where),
    db
      .select()
      .from(schema.problemset)
      .where(where)
      .orderBy(desc(schema.problemset.createTime))
      .limit(limit)
      .offset(offset),
  ])
  return success(c, {
    results: await serializeMany(rows),
    total: totalRows[0]?.value ?? 0,
  } satisfies AdminProblemSetList)
})

adminProblemSetRoutes.post("/problem-sets", requireTeacher, async (c) => {
  const parsed = await parseBody(c, createProblemSetRequestSchema)
  if (!parsed.success) return parsed.response
  const period = assignment(parsed.data.assignedUntil, null)
  if (period === "past") return failure(c, 400, "assign-in-past", "布置到的日期已经过了")
  const now = new Date().toISOString()
  const [created] = await db
    .insert(schema.problemset)
    .values({
      title: parsed.data.title,
      description: parsed.data.description,
      visible: parsed.data.visible,
      ...period,
      // 难度、状态两列还在表里、非空，但已经不用了（见契约 admin.ts 的说明）
      difficulty: "Easy",
      status: "active",
      createdById: c.get("user")!.id,
      createTime: now,
      lastUpdateTime: now,
    })
    .returning()
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
  const parsed = await parseBody(c, updateProblemSetRequestSchema)
  if (!parsed.success) return parsed.response
  const period = assignment(parsed.data.assignedUntil, row)
  if (period === "past") return failure(c, 400, "assign-in-past", "布置到的日期已经过了")
  const [updated] = await db
    .update(schema.problemset)
    .set({
      title: parsed.data.title,
      description: parsed.data.description,
      visible: parsed.data.visible,
      ...period,
      lastUpdateTime: new Date().toISOString(),
    })
    .where(eq(schema.problemset.id, row.id))
    .returning()
  return success(c, await serialize(updated!))
})

adminProblemSetRoutes.put("/problem-sets/:id/visibility", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  // 旧接口是「取反」语义，前端只传 id 不传目标值。保持不变：前端按钮就是个开关
  const [updated] = await db
    .update(schema.problemset)
    .set({ visible: !row.visible, lastUpdateTime: new Date().toISOString() })
    .where(eq(schema.problemset.id, row.id))
    .returning()
  return success(c, await serialize(updated!))
})

adminProblemSetRoutes.delete("/problem-sets/:id", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  // 子表交给库级 CASCADE（0010）：problemset_{badge,problem,progress,submission} 直接连坐，
  // user_badge 经 problemset_badge 二级连坐。原先这里手抄五条 delete 并要求「顺序不能反」。
  await db.delete(schema.problemset).where(eq(schema.problemset.id, row.id))
  return success(c, null)
})

// ---------------------------------------------------------------- 题单里的题目

adminProblemSetRoutes.get("/problem-sets/:id/problems", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const rows = await db
    .select({ item: schema.problemsetProblem, problem: schema.problem })
    .from(schema.problemsetProblem)
    .innerJoin(schema.problem, eq(schema.problemsetProblem.problemId, schema.problem.id))
    .where(eq(schema.problemsetProblem.problemsetId, row.id))
    .orderBy(asc(schema.problemsetProblem.order), asc(schema.problemsetProblem.id))
  return success(
    c,
    rows.map(
      ({ item, problem }) =>
        ({
          id: item.id,
          problemSetId: item.problemsetId,
          problemId: item.problemId,
          problemDisplayId: problem.displayId,
          title: problem.title,
          difficulty: problem.difficulty,
          order: item.order,
          isRequired: item.isRequired,
        }) satisfies AdminProblemSetProblem,
    ),
  )
})

/**
 * 加题：一次可以给好几个题号（后台搜索框里粘一串「3065 3066 3067」），按给的顺序接在最后。
 * 找不到的、本来就在里面的不报错，分开报回去，前端告诉老师哪几个没加上。
 */
adminProblemSetRoutes.post("/problem-sets/:id/problems", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = await parseBody(c, addProblemsToSetRequestSchema)
  if (!parsed.success) return parsed.response
  const wanted = [...new Set(parsed.data.problemIds.map((id) => id.toLowerCase()))]
  const [problems, existing, last] = await Promise.all([
    db
      .select({ id: schema.problem.id, displayId: schema.problem.displayId })
      .from(schema.problem)
      .where(
        and(
          inArray(sql<string>`lower(${schema.problem.displayId})`, wanted),
          eq(schema.problem.visible, true),
          isNull(schema.problem.contestId),
        ),
      ),
    db
      .select({ problemId: schema.problemsetProblem.problemId })
      .from(schema.problemsetProblem)
      .where(eq(schema.problemsetProblem.problemsetId, row.id)),
    db
      .select({ value: max(schema.problemsetProblem.order) })
      .from(schema.problemsetProblem)
      .where(eq(schema.problemsetProblem.problemsetId, row.id)),
  ])
  const byDisplayId = new Map(problems.map((problem) => [problem.displayId.toLowerCase(), problem]))
  const inSet = new Set(existing.map((item) => item.problemId))
  const result: AddProblemsToSetResult = { added: [], missing: [], duplicate: [] }
  const values: (typeof schema.problemsetProblem.$inferInsert)[] = []
  let order = last[0]?.value ?? 0
  for (const id of wanted) {
    const problem = byDisplayId.get(id)
    if (!problem) result.missing.push(id)
    else if (inSet.has(problem.id)) result.duplicate.push(problem.displayId)
    else {
      inSet.add(problem.id)
      order += 1
      // 分数、提示两列还在表里但已经不用了：score 非空给 0
      values.push({
        problemsetId: row.id,
        problemId: problem.id,
        order,
        isRequired: true,
        score: 0,
      })
      result.added.push(problem.displayId)
    }
  }
  if (values.length) {
    await db.insert(schema.problemsetProblem).values(values)
    // 题目集变了，已加入的人的分母、完成状态、奖章都得跟着变（旧栈靠 post_save 信号，
    // 不在 views 里，别因为翻不到显式调用就以为它没做，见 services/problemset.ts）
    await resyncProgress(row.id)
  }
  return success(c, result, values.length ? 201 : 200)
})

// 必须注册在 /problems/:itemId 前面：Hono 按注册顺序匹配，order 会被当成 :itemId 吃掉
adminProblemSetRoutes.put("/problem-sets/:id/problems/order", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = await parseBody(c, reorderProblemSetProblemsRequestSchema)
  if (!parsed.success) return parsed.response
  const links = await db
    .select({ id: schema.problemsetProblem.id })
    .from(schema.problemsetProblem)
    .where(eq(schema.problemsetProblem.problemsetId, row.id))
  const have = new Set(links.map((link) => link.id))
  const given = new Set(parsed.data.ids)
  if (given.size !== have.size || [...given].some((id) => !have.has(id))) {
    return failure(c, 409, "problems-changed", "题目列表变了，刷新一下再排")
  }
  await db.transaction(async (tx) => {
    for (const [index, id] of parsed.data.ids.entries()) {
      await tx
        .update(schema.problemsetProblem)
        .set({ order: index + 1 })
        .where(eq(schema.problemsetProblem.id, id))
    }
  })
  return success(c, null)
})

adminProblemSetRoutes.put("/problem-sets/:id/problems/:itemId", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = await parseBody(c, updateProblemInSetRequestSchema, "参数错误")
  if (!parsed.success) return parsed.response
  const updated = await db
    .update(schema.problemsetProblem)
    .set(parsed.data)
    .where(
      and(
        eq(schema.problemsetProblem.id, queryInteger(c.req.param("itemId"), 0, { min: 1 })),
        eq(schema.problemsetProblem.problemsetId, row.id),
      ),
    )
    .returning({ id: schema.problemsetProblem.id })
  if (updated.length === 0) return failure(c, 404, "problem-not-in-set", "题目不在该题单中")
  // 必做 / 选做变了，分母和「做完」跟着变
  await resyncProgress(row.id)
  return success(c, null)
})

adminProblemSetRoutes.delete("/problem-sets/:id/problems/:itemId", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const deleted = await db
    .delete(schema.problemsetProblem)
    .where(
      and(
        eq(schema.problemsetProblem.id, queryInteger(c.req.param("itemId"), 0, { min: 1 })),
        eq(schema.problemsetProblem.problemsetId, row.id),
      ),
    )
    .returning({
      id: schema.problemsetProblem.id,
      problemId: schema.problemsetProblem.problemId,
    })
  if (deleted.length === 0) return failure(c, 404, "problem-not-in-set", "题目不在该题单中")
  // 这道题在本题单里的提交记录也要清掉，对齐旧栈 problemset/signals.py 的 post_delete。
  // 不清的话 problemset_submission 会一直攒指向已移出题单的孤儿行。
  await db
    .delete(schema.problemsetSubmission)
    .where(
      and(
        eq(schema.problemsetSubmission.problemsetId, row.id),
        eq(schema.problemsetSubmission.problemId, deleted[0]!.problemId),
      ),
    )
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
  const earned = await db
    .select({ badgeId: schema.userBadge.badgeId, value: count() })
    .from(schema.userBadge)
    .where(
      inArray(
        schema.userBadge.badgeId,
        badges.map((badge) => badge.id),
      ),
    )
    .groupBy(schema.userBadge.badgeId)
  const countByBadge = new Map(earned.map((item) => [item.badgeId, item.value]))
  return badges.map(
    (badge) =>
      ({
        id: badge.id,
        problemSetId: badge.problemsetId,
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        conditionType: badge.conditionType,
        conditionValue: badge.conditionValue,
        earnedCount: countByBadge.get(badge.id) ?? 0,
      }) satisfies AdminProblemSetBadge,
  )
}

adminProblemSetRoutes.get("/problem-sets/:id/badges", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const badges = await db
    .select()
    .from(schema.problemsetBadge)
    .where(eq(schema.problemsetBadge.problemsetId, row.id))
    .orderBy(asc(schema.problemsetBadge.id))
  return success(c, await badgesWithCount(badges))
})

adminProblemSetRoutes.post("/problem-sets/:id/badges", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = await parseBody(c, createProblemSetBadgeRequestSchema)
  if (!parsed.success) return parsed.response
  const [created] = await db
    .insert(schema.problemsetBadge)
    .values({
      ...parsed.data,
      problemsetId: row.id,
    })
    .returning()
  // 新建奖章要立刻补发给已达标的人 —— 旧后端靠 post_save 信号，这里显式调
  await recalculateBadge(created!)
  return success(c, await badgeWithCount(created!), 201)
})

adminProblemSetRoutes.put("/problem-sets/:id/badges/:badgeId", requireTeacher, async (c) => {
  const row = await loadOwned(c, c.get("user")!)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const parsed = await parseBody(c, updateProblemSetBadgeRequestSchema)
  if (!parsed.success) return parsed.response
  const [updated] = await db
    .update(schema.problemsetBadge)
    .set(parsed.data)
    .where(
      and(
        eq(schema.problemsetBadge.id, queryInteger(c.req.param("badgeId"), 0, { min: 1 })),
        eq(schema.problemsetBadge.problemsetId, row.id),
      ),
    )
    .returning()
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
  const [badge] = await db
    .select({ id: schema.problemsetBadge.id })
    .from(schema.problemsetBadge)
    .where(
      and(eq(schema.problemsetBadge.id, badgeId), eq(schema.problemsetBadge.problemsetId, row.id)),
    )
    .limit(1)
  if (!badge) return failure(c, 404, "badge-not-found", "奖章不存在")
  // 获奖记录随奖章一起没：user_badge.badge_id 是 CASCADE（0010）
  await db.delete(schema.problemsetBadge).where(eq(schema.problemsetBadge.id, badge.id))
  return success(c, null)
})

import {
  problemSetBadgeSchema,
  problemSetListSchema,
  problemSetProblemSchema,
  problemSetProgressListSchema,
  problemSetProgressSchema,
  problemSetSchema,
  updateProblemSetProgressRequestSchema,
  joinProblemSetRequestSchema,
  userBadgeSchema,
} from "@oj2/contract"
import {
  and,
  asc,
  avg,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  ne,
  or,
  sql,
} from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireAuth, requireTeacher, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { publishAchievementNotification } from "../events"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { updateAchievementsForProblemSet } from "../services/achievements"
import { computeProgress } from "../services/problemset"
import { objectValue, queryInteger, sampleUser } from "./helpers"

export const problemsetRoutes = new Hono<AppEnv>()

type ProblemSetRow = typeof schema.problemset.$inferSelect

function progressSummary(progress: typeof schema.problemsetProgress.$inferSelect | undefined) {
  return progress ? {
    isJoined: true,
    progressPercentage: progress.progressPercentage,
    completedCount: progress.completedProblemsCount,
    totalCount: progress.totalProblemsCount,
    isCompleted: progress.isCompleted,
  } : {
    isJoined: false,
    progressPercentage: 0,
    completedCount: 0,
    totalCount: 0,
    isCompleted: false,
  }
}

async function problemSetCreators(ids: number[]) {
  const map = new Map<number, ReturnType<typeof sampleUser>>()
  if (ids.length === 0) return map
  const rows = await db.select({ id: schema.user.id, username: schema.user.username, realName: schema.userProfile.realName })
    .from(schema.user).leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(inArray(schema.user.id, ids))
  for (const row of rows) map.set(row.id, sampleUser(row, row.realName))
  return map
}

function badgeData(badge: typeof schema.problemsetBadge.$inferSelect, earned?: boolean) {
  return problemSetBadgeSchema.parse({
    id: badge.id,
    problemsetId: badge.problemsetId,
    name: badge.name,
    description: badge.description,
    icon: badge.icon,
    conditionType: badge.conditionType,
    conditionValue: badge.conditionValue,
    isEarned: earned,
  })
}

/**
 * 一次把整页题单的附属数据全查回来，再在内存里按 problemsetId 分组。
 *
 * 以前是每行 5 条查询（题目数 / 我的进度 / 奖章 / 已获奖章 / 创建者），
 * limit 最大 250 就是 1250 次往返。这里固定 5 条，与行数无关。
 */
async function serializeProblemSets(
  rows: ProblemSetRow[],
  userId?: number,
  includeBadges = false,
) {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const [problemCounts, progresses, badges, earnedRows, creators] = await Promise.all([
    db.select({ problemsetId: schema.problemsetProblem.problemsetId, value: count() })
      .from(schema.problemsetProblem).where(inArray(schema.problemsetProblem.problemsetId, ids))
      .groupBy(schema.problemsetProblem.problemsetId),
    userId ? db.select().from(schema.problemsetProgress)
      .where(and(inArray(schema.problemsetProgress.problemsetId, ids), eq(schema.problemsetProgress.userId, userId)))
      : Promise.resolve([] as (typeof schema.problemsetProgress.$inferSelect)[]),
    includeBadges ? db.select().from(schema.problemsetBadge)
      .where(inArray(schema.problemsetBadge.problemsetId, ids)).orderBy(asc(schema.problemsetBadge.id))
      : Promise.resolve([] as (typeof schema.problemsetBadge.$inferSelect)[]),
    includeBadges && userId ? db.select({ id: schema.userBadge.badgeId }).from(schema.userBadge)
      .innerJoin(schema.problemsetBadge, eq(schema.userBadge.badgeId, schema.problemsetBadge.id))
      .where(and(eq(schema.userBadge.userId, userId), inArray(schema.problemsetBadge.problemsetId, ids)))
      : Promise.resolve([] as { id: number }[]),
    problemSetCreators([...new Set(rows.map((row) => row.createdById))]),
  ])
  const countBySet = new Map(problemCounts.map((item) => [item.problemsetId, item.value]))
  const progressBySet = new Map(progresses.map((item) => [item.problemsetId, item]))
  const badgesBySet = new Map<number, (typeof schema.problemsetBadge.$inferSelect)[]>()
  for (const badge of badges) badgesBySet.set(badge.problemsetId, [...(badgesBySet.get(badge.problemsetId) ?? []), badge])
  const earned = new Set(earnedRows.map((item) => item.id))
  return rows.map((row) => {
    const progress = progressBySet.get(row.id)
    return problemSetSchema.parse({
      id: row.id,
      title: row.title,
      description: row.description,
      createdBy: creators.get(row.createdById) ?? sampleUser({ id: row.createdById, username: "" }, null),
      createTime: row.createTime,
      lastUpdateTime: row.lastUpdateTime,
      difficulty: row.difficulty,
      status: row.status,
      endTime: row.endTime,
      visible: row.visible,
      problemsCount: countBySet.get(row.id) ?? 0,
      completedCount: progress?.completedProblemsCount ?? 0,
      userProgress: progressSummary(progress),
      badges: includeBadges ? (badgesBySet.get(row.id) ?? []).map((badge) => badgeData(badge, earned.has(badge.id))) : undefined,
    })
  })
}

problemsetRoutes.get("/problem-sets", optionalAuth, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const filters = [eq(schema.problemset.visible, true), ne(schema.problemset.status, "draft")]
  const keyword = c.req.query("keyword")?.trim()
  const difficulty = c.req.query("difficulty")?.trim()
  const status = c.req.query("status")?.trim()
  if (keyword) filters.push(or(ilike(schema.problemset.title, `%${keyword}%`), ilike(schema.problemset.description, `%${keyword}%`))!)
  if (difficulty) filters.push(eq(schema.problemset.difficulty, difficulty))
  if (status) filters.push(eq(schema.problemset.status, status))
  const where = and(...filters)
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.problemset).where(where),
    db.select().from(schema.problemset).where(where).orderBy(desc(schema.problemset.createTime)).limit(limit).offset(offset),
  ])
  return success(c, problemSetListSchema.parse({
    results: await serializeProblemSets(rows, c.get("user")?.id, true),
    total: totalRows[0]?.value ?? 0,
  }))
})

problemsetRoutes.get("/problem-sets/:id", optionalAuth, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [row] = await db.select().from(schema.problemset)
    .where(and(eq(schema.problemset.id, id), eq(schema.problemset.visible, true), ne(schema.problemset.status, "draft"))).limit(1)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const [data] = await serializeProblemSets([row], c.get("user")?.id)
  return success(c, data)
})

problemsetRoutes.get("/problem-sets/:id/problems", optionalAuth, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [problemSet] = await db.select({ id: schema.problemset.id }).from(schema.problemset)
    .where(and(eq(schema.problemset.id, id), eq(schema.problemset.visible, true), ne(schema.problemset.status, "draft"))).limit(1)
  if (!problemSet) return failure(c, 404, "problem-set-not-found", "题单不存在")
  // 只取卡片要渲染的四列。取 schema.problem 整行会把题面、样例、答案、ast_rules、
  // flowchart_data、sql_display 一起拉回来，题单页一个都不用。
  //
  // order 后面必须再跟一个 tiebreaker：并列时 Postgres 不保证次序，而卡片是按数组
  // 下标编号的（#1 #2 #3），题单 8 / 11 / 14 实际就存在 order 重复，不定死的话
  // 「第 3 题」指哪道题每次刷新都可能不一样。后台那条列表一直是这么排的。
  const rows = await db.select({
    link: schema.problemsetProblem,
    problemId: schema.problem.id,
    displayId: schema.problem.displayId,
    title: schema.problem.title,
    difficulty: schema.problem.difficulty,
  })
    .from(schema.problemsetProblem)
    .innerJoin(schema.problem, eq(schema.problemsetProblem.problemId, schema.problem.id))
    .where(eq(schema.problemsetProblem.problemsetId, id))
    .orderBy(asc(schema.problemsetProblem.order), asc(schema.problemsetProblem.id))
  const progressRows = c.get("user")
    ? await db.select({ detail: schema.problemsetProgress.progressDetail }).from(schema.problemsetProgress)
      .where(and(eq(schema.problemsetProgress.problemsetId, id), eq(schema.problemsetProgress.userId, c.get("user")!.id))).limit(1)
    : []
  const completed = objectValue(progressRows[0]?.detail)
  return success(c, rows.map(({ link, problemId, displayId, title, difficulty }) => problemSetProblemSchema.parse({
    id: link.id,
    problemsetId: link.problemsetId,
    problem: { id: problemId, _id: displayId, title, difficulty },
    order: link.order,
    isRequired: link.isRequired,
    score: link.score,
    hint: link.hint,
    isCompleted: String(problemId) in completed,
  })))
})

async function recomputeProgress(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  progress: typeof schema.problemsetProgress.$inferSelect,
  detail: Record<string, unknown>,
) {
  const links = await tx.select({ problemId: schema.problemsetProblem.problemId, score: schema.problemsetProblem.score })
    .from(schema.problemsetProblem).where(eq(schema.problemsetProblem.problemsetId, progress.problemsetId))
  // 算法本身在 services/problemset.ts —— 后台改题目后的批量重算走的是同一份，
  // 两边曾经各写一遍，结果后台那份少算了 total_score 和 is_completed
  const update = computeProgress(detail, links, progress.completeTime)
  await tx.update(schema.problemsetProgress).set(update).where(eq(schema.problemsetProgress.id, progress.id))
  return { ...progress, ...update }
}

problemsetRoutes.post("/problem-set-progress", requireAuth, async (c) => {
  const parsed = joinProblemSetRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid problem set")
  const user = c.get("user")!
  const [problemSet] = await db.select({ id: schema.problemset.id }).from(schema.problemset)
    .where(and(eq(schema.problemset.id, parsed.data.problemSetId), eq(schema.problemset.visible, true), ne(schema.problemset.status, "draft"))).limit(1)
  if (!problemSet) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const [existing] = await db.select({ id: schema.problemsetProgress.id }).from(schema.problemsetProgress)
    .where(and(eq(schema.problemsetProgress.problemsetId, problemSet.id), eq(schema.problemsetProgress.userId, user.id))).limit(1)
  if (existing) return failure(c, 409, "already-joined", "已经加入该题单")
  await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.problemsetProgress).values({
      problemsetId: problemSet.id,
      userId: user.id,
      joinTime: new Date().toISOString(),
      completeTime: null,
      isCompleted: false,
      progressPercentage: 0,
      completedProblemsCount: 0,
      totalProblemsCount: 0,
      totalScore: 0,
      progressDetail: {},
    }).returning()
    if (created) await recomputeProgress(tx, created, {})
  })
  return success(c, null, 201)
})

problemsetRoutes.put("/problem-set-progress", requireAuth, async (c) => {
  const parsed = updateProblemSetProgressRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid progress payload")
  const user = c.get("user")!
  const result = await db.transaction(async (tx) => {
    const [problemSet] = await tx.select().from(schema.problemset).where(and(
      eq(schema.problemset.id, parsed.data.problemSetId), eq(schema.problemset.visible, true), ne(schema.problemset.status, "draft"),
    )).limit(1)
    if (!problemSet) return { error: "problem-set-not-found" as const }
    const [progress] = await tx.select().from(schema.problemsetProgress).where(and(
      eq(schema.problemsetProgress.problemsetId, problemSet.id), eq(schema.problemsetProgress.userId, user.id),
    )).for("update").limit(1)
    if (!progress) return { error: "not-joined" as const }
    const [submission] = await tx.select().from(schema.submission).where(and(
      eq(schema.submission.id, parsed.data.submissionId), eq(schema.submission.userId, user.id), eq(schema.submission.problemId, parsed.data.problemId),
    )).limit(1)
    if (!submission) return { error: "submission-not-found" as const }
    if (![JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED].includes(submission.result as 0 | 10)) return { error: "submission-not-accepted" as const }
    const [link] = await tx.select().from(schema.problemsetProblem).where(and(
      eq(schema.problemsetProblem.problemsetId, problemSet.id), eq(schema.problemsetProblem.problemId, parsed.data.problemId),
    )).limit(1)
    if (!link) return { error: "problem-not-in-set" as const }
    const detail = objectValue(progress.progressDetail)
    detail[String(parsed.data.problemId)] = { score: link.score, submit_time: new Date().toISOString() }
    const updated = await recomputeProgress(tx, progress, detail)
    const [existingSubmission] = await tx.select({ id: schema.problemsetSubmission.id })
      .from(schema.problemsetSubmission).where(and(
        eq(schema.problemsetSubmission.problemsetId, problemSet.id),
        eq(schema.problemsetSubmission.userId, user.id),
        eq(schema.problemsetSubmission.problemId, parsed.data.problemId),
      )).limit(1)
    if (!existingSubmission) {
      await tx.insert(schema.problemsetSubmission).values({
        problemsetId: problemSet.id,
        userId: user.id,
        submissionId: submission.id,
        problemId: parsed.data.problemId,
      })
    }
    const badges = await tx.select().from(schema.problemsetBadge).where(eq(schema.problemsetBadge.problemsetId, problemSet.id))
    const hits = badges.filter((badge) => badge.conditionType === "all_problems"
      ? updated.totalProblemsCount > 0 && updated.completedProblemsCount === updated.totalProblemsCount
      : badge.conditionType === "problem_count"
        ? updated.completedProblemsCount >= badge.conditionValue
        : badge.conditionType === "score" && updated.totalScore >= badge.conditionValue)
    if (hits.length === 0) return { earned: [] as (typeof schema.problemsetBadge.$inferSelect)[] }
    // 达标的奖章一次插完，冲突忽略后 returning 回来的就是这次真拿到的
    const inserted = await tx.insert(schema.userBadge).values(hits.map((badge) => ({
      userId: user.id,
      badgeId: badge.id,
      earnedTime: new Date().toISOString(),
    }))).onConflictDoNothing({ target: [schema.userBadge.badgeId, schema.userBadge.userId] })
      .returning({ badgeId: schema.userBadge.badgeId })
    const insertedIds = new Set(inserted.map((row) => row.badgeId))
    return { earned: hits.filter((badge) => insertedIds.has(badge.id)) }
  })
  if ("error" in result && result.error) {
    const error = result.error
    const messages = {
      "problem-set-not-found": "题单不存在",
      "not-joined": "未加入该题单",
      "submission-not-found": "提交记录不存在",
      "submission-not-accepted": "只有通过的提交才能更新进度",
      "problem-not-in-set": "题目不在题单中",
    }
    return failure(c, error.endsWith("not-found") ? 404 : 400, error, messages[error])
  }
  const unlocked = await updateAchievementsForProblemSet(user.id)
  await Promise.all([
    publishAchievementNotification(user.id, result.earned.map((badge) => ({
      id: badge.id,
      name: badge.name,
      description: badge.description,
      icon: badge.icon,
      rarity: "bronze",
      kind: "badge",
    }))),
    publishAchievementNotification(user.id, unlocked.map((achievement) => ({
      id: achievement.id,
      name: achievement.name,
      description: achievement.description,
      icon: achievement.icon,
      rarity: achievement.rarity,
      kind: "achievement",
    }))),
  ])
  return success(c, { earnedBadges: result.earned.map((badge) => badgeData(badge)) })
})

problemsetRoutes.get("/users/:username/badges", optionalAuth, async (c) => {
  const requested = c.req.param("username")
  const username = requested === "me" ? c.get("user")?.username : requested
  if (!username) return failure(c, 401, "login-required", "Authentication required")
  const [target] = await db.select({ id: schema.user.id }).from(schema.user)
    .where(and(eq(schema.user.username, username), eq(schema.user.isDisabled, false))).limit(1)
  if (!target) return failure(c, 404, "user-not-found", "用户不存在")
  const rows = await db.select({ userBadge: schema.userBadge, badge: schema.problemsetBadge, problemSet: schema.problemset })
    .from(schema.userBadge).innerJoin(schema.problemsetBadge, eq(schema.userBadge.badgeId, schema.problemsetBadge.id))
    .innerJoin(schema.problemset, eq(schema.problemsetBadge.problemsetId, schema.problemset.id))
    .where(eq(schema.userBadge.userId, target.id)).orderBy(desc(schema.userBadge.earnedTime))
  return success(c, rows.map(({ userBadge, badge, problemSet }) => userBadgeSchema.parse({
    id: userBadge.id,
    userId: userBadge.userId,
    badge: badgeData(badge),
    earnedTime: userBadge.earnedTime,
    problemset: { id: problemSet.id, title: problemSet.title },
  })))
})

problemsetRoutes.get("/problem-sets/:id/badges", async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [problemSet] = await db.select({ id: schema.problemset.id }).from(schema.problemset).where(and(
    eq(schema.problemset.id, id), eq(schema.problemset.visible, true), ne(schema.problemset.status, "draft"),
  )).limit(1)
  if (!problemSet) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const badges = await db.select().from(schema.problemsetBadge).where(eq(schema.problemsetBadge.problemsetId, id))
  return success(c, badges.map((badge) => badgeData(badge)))
})

problemsetRoutes.get("/problem-sets/:id/user-progress", requireTeacher, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [problemSet] = await db.select({ id: schema.problemset.id }).from(schema.problemset).where(and(
    eq(schema.problemset.id, id), eq(schema.problemset.visible, true), ne(schema.problemset.status, "draft"),
  )).limit(1)
  if (!problemSet) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const className = c.req.query("className")?.trim()
  const completion = c.req.query("completionStatus")?.trim()
  const filters = [eq(schema.problemsetProgress.problemsetId, id)]
  if (className) filters.push(ilike(schema.user.username, `%${className}%`))
  if (completion === "completed") filters.push(eq(schema.problemsetProgress.isCompleted, true))
  else if (completion === "in_progress") filters.push(and(eq(schema.problemsetProgress.isCompleted, false), gt(schema.problemsetProgress.completedProblemsCount, 0))!)
  else if (completion === "not_started") filters.push(eq(schema.problemsetProgress.completedProblemsCount, 0))
  const where = and(...filters)
  const [statsRows, rows, problemRows] = await Promise.all([
    db.select({ total: count(), completed: sql<number>`count(*) filter (where ${schema.problemsetProgress.isCompleted})::int`, avgProgress: avg(schema.problemsetProgress.progressPercentage) })
      .from(schema.problemsetProgress).innerJoin(schema.user, eq(schema.problemsetProgress.userId, schema.user.id)).where(where),
    db.select({ progress: schema.problemsetProgress, user: schema.user, realName: schema.userProfile.realName })
      .from(schema.problemsetProgress).innerJoin(schema.user, eq(schema.problemsetProgress.userId, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id)).where(where)
      .orderBy(desc(schema.problemsetProgress.isCompleted), desc(schema.problemsetProgress.progressPercentage), asc(schema.problemsetProgress.joinTime)).limit(limit).offset(offset),
    db.select({ id: schema.problem.id, _id: schema.problem.displayId, title: schema.problem.title }).from(schema.problemsetProblem)
      .innerJoin(schema.problem, eq(schema.problemsetProblem.problemId, schema.problem.id))
      .where(eq(schema.problemsetProblem.problemsetId, id))
      .orderBy(asc(schema.problemsetProblem.order), asc(schema.problemsetProblem.id)),
  ])
  const problemMap = new Map(problemRows.map((problem) => [String(problem.id), problem]))
  const results = rows.map(({ progress, user: progressUser, realName }) => problemSetProgressSchema.parse({
    id: progress.id,
    problemsetId: progress.problemsetId,
    user: sampleUser(progressUser, realName),
    joinTime: progress.joinTime,
    completeTime: progress.completeTime,
    isCompleted: progress.isCompleted,
    progressPercentage: progress.progressPercentage,
    completedProblemsCount: progress.completedProblemsCount,
    totalProblemsCount: progress.totalProblemsCount,
    totalScore: progress.totalScore,
    completedProblems: Object.keys(objectValue(progress.progressDetail)).flatMap((key) => problemMap.get(key) ?? []),
  }))
  const stats = statsRows[0]
  return success(c, problemSetProgressListSchema.parse({
    results,
    total: stats?.total ?? 0,
    statistics: { total: stats?.total ?? 0, completed: stats?.completed ?? 0, avgProgress: Number(stats?.avgProgress ?? 0) },
    problems: problemRows,
  }))
})

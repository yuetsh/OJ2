import {
  problemListItemSchema,
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
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { publishAchievementNotification } from "../events"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { updateAchievementsForProblemSet } from "../services/achievements"
import { isTeacherOrAbove, objectValue, queryInteger, sampleUser } from "./helpers"

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

async function problemSetCreator(id: number) {
  const [row] = await db.select({ id: schema.user.id, username: schema.user.username, realName: schema.userProfile.realName })
    .from(schema.user).leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.user.id, id)).limit(1)
  return sampleUser(row ?? { id, username: "" }, row?.realName)
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

async function serializeProblemSet(
  row: ProblemSetRow,
  userId?: number,
  includeBadges = false,
) {
  const [[problemCount], [progress], badges, earnedRows] = await Promise.all([
    db.select({ value: count() }).from(schema.problemsetProblem).where(eq(schema.problemsetProblem.problemsetId, row.id)),
    userId ? db.select().from(schema.problemsetProgress).where(and(eq(schema.problemsetProgress.problemsetId, row.id), eq(schema.problemsetProgress.userId, userId))).limit(1) : Promise.resolve([]),
    includeBadges ? db.select().from(schema.problemsetBadge).where(eq(schema.problemsetBadge.problemsetId, row.id)) : Promise.resolve([]),
    includeBadges && userId ? db.select({ id: schema.userBadge.badgeId }).from(schema.userBadge)
      .innerJoin(schema.problemsetBadge, eq(schema.userBadge.badgeId, schema.problemsetBadge.id))
      .where(and(eq(schema.userBadge.userId, userId), eq(schema.problemsetBadge.problemsetId, row.id))) : Promise.resolve([]),
  ])
  const earned = new Set(earnedRows.map((item) => item.id))
  return problemSetSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    createdBy: await problemSetCreator(row.createdById),
    createTime: row.createTime,
    lastUpdateTime: row.lastUpdateTime,
    difficulty: row.difficulty,
    status: row.status,
    endTime: row.endTime,
    visible: row.visible,
    problemsCount: problemCount?.value ?? 0,
    completedCount: progress?.completedProblemsCount ?? 0,
    userProgress: progressSummary(progress),
    badges: includeBadges ? badges.map((badge) => badgeData(badge, earned.has(badge.id))) : undefined,
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
    results: await Promise.all(rows.map((row) => serializeProblemSet(row, c.get("user")?.id, true))),
    total: totalRows[0]?.value ?? 0,
  }))
})

problemsetRoutes.get("/problem-sets/:id", optionalAuth, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [row] = await db.select().from(schema.problemset)
    .where(and(eq(schema.problemset.id, id), eq(schema.problemset.visible, true), ne(schema.problemset.status, "draft"))).limit(1)
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  return success(c, await serializeProblemSet(row, c.get("user")?.id))
})

problemsetRoutes.get("/problem-sets/:id/problems", optionalAuth, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [problemSet] = await db.select({ id: schema.problemset.id }).from(schema.problemset)
    .where(and(eq(schema.problemset.id, id), eq(schema.problemset.visible, true), ne(schema.problemset.status, "draft"))).limit(1)
  if (!problemSet) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const rows = await db.select({ link: schema.problemsetProblem, problem: schema.problem, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.problemsetProblem).innerJoin(schema.problem, eq(schema.problemsetProblem.problemId, schema.problem.id))
    .innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.problemsetProblem.problemsetId, id)).orderBy(asc(schema.problemsetProblem.order))
  const problemIds = rows.map((row) => row.problem.id)
  const [tagRows, progressRows] = await Promise.all([
    problemIds.length ? db.select({ problemId: schema.problemTags.problemId, name: schema.problemTag.name }).from(schema.problemTags)
      .innerJoin(schema.problemTag, eq(schema.problemTags.problemtagId, schema.problemTag.id)).where(inArray(schema.problemTags.problemId, problemIds)) : Promise.resolve([]),
    c.get("user") ? db.select({ detail: schema.problemsetProgress.progressDetail }).from(schema.problemsetProgress)
      .where(and(eq(schema.problemsetProgress.problemsetId, id), eq(schema.problemsetProgress.userId, c.get("user")!.id))).limit(1) : Promise.resolve([]),
  ])
  const tags = new Map<number, string[]>()
  for (const tag of tagRows) tags.set(tag.problemId, [...(tags.get(tag.problemId) ?? []), tag.name])
  const completed = objectValue(progressRows[0]?.detail)
  return success(c, rows.map(({ link, problem, user, realName }) => problemSetProblemSchema.parse({
    id: link.id,
    problemsetId: link.problemsetId,
    problem: problemListItemSchema.parse({
      id: problem.id,
      _id: problem.displayId,
      title: problem.title,
      submissionNumber: problem.submissionNumber,
      acceptedNumber: problem.acceptedNumber,
      difficulty: problem.difficulty,
      createdBy: sampleUser(user, realName),
      tags: tags.get(problem.id) ?? [],
      contestId: problem.contestId,
      allowFlowchart: problem.allowFlowchart,
      showFlowchart: problem.showFlowchart,
      hasAstRules: problem.astRules !== null,
      myStatus: null,
    }),
    order: link.order,
    isRequired: link.isRequired,
    score: link.score,
    hint: link.hint,
    isCompleted: String(problem.id) in completed,
  })))
})

async function recomputeProgress(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  progress: typeof schema.problemsetProgress.$inferSelect,
  detail: Record<string, unknown>,
) {
  const links = await tx.select({ problemId: schema.problemsetProblem.problemId, score: schema.problemsetProblem.score })
    .from(schema.problemsetProblem).where(eq(schema.problemsetProblem.problemsetId, progress.problemsetId))
  const valid = new Map(links.map((link) => [String(link.problemId), link.score]))
  for (const key of Object.keys(detail)) if (!valid.has(key)) delete detail[key]
  let totalScore = 0
  for (const [key, value] of Object.entries(detail)) {
    const score = valid.get(key)
    if (score === undefined) continue
    totalScore += score
    detail[key] = { ...objectValue(value), score }
  }
  const completed = Object.keys(detail).length
  const total = links.length
  const isCompleted = completed === total
  const update = {
    progressDetail: detail,
    totalProblemsCount: total,
    completedProblemsCount: completed,
    totalScore,
    progressPercentage: total > 0 ? completed / total * 100 : 0,
    isCompleted,
    completeTime: isCompleted ? progress.completeTime ?? new Date().toISOString() : null,
  }
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
    const earned: typeof schema.problemsetBadge.$inferSelect[] = []
    for (const badge of badges) {
      const hit = badge.conditionType === "all_problems"
        ? updated.totalProblemsCount > 0 && updated.completedProblemsCount === updated.totalProblemsCount
        : badge.conditionType === "problem_count"
          ? updated.completedProblemsCount >= badge.conditionValue
          : badge.conditionType === "score" && updated.totalScore >= badge.conditionValue
      if (!hit) continue
      const inserted = await tx.insert(schema.userBadge).values({
        userId: user.id,
        badgeId: badge.id,
        earnedTime: new Date().toISOString(),
      }).onConflictDoNothing({ target: [schema.userBadge.badgeId, schema.userBadge.userId] }).returning({ id: schema.userBadge.id })
      if (inserted.length) earned.push(badge)
    }
    return { earned }
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

problemsetRoutes.get("/problem-sets/:id/user-progress", requireAuth, async (c) => {
  const user = c.get("user")!
  if (!isTeacherOrAbove(user)) return failure(c, 403, "permission-denied", "Permission denied")
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
      .where(eq(schema.problemsetProblem.problemsetId, id)).orderBy(asc(schema.problemsetProblem.order)),
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

import {
  joinProblemSetRequestSchema,
  STUDENT_ROLES,
  type ProblemSet,
  type ProblemSetBadge,
  type ProblemSetClassView,
  type ProblemSetList,
  type ProblemSetLock,
  type ProblemSetProblem,
  type UserBadge,
} from "@oj2/contract"
import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireAuth, requireTeacher, type AppEnv } from "../auth/middleware"
import type { AuthUser } from "../auth/session"
import { db, schema } from "../db"
import { failure, parseBody, success } from "../http"
import { JudgeStatus, NON_FAILURE_RESULTS } from "../judge/status"
import {
  assigningSql,
  computeProgress,
  problemSetLockCutoffs,
  problemSetLocksFor,
} from "../services/problemset"
import { asRecord, isTeacherOrAbove, queryInteger, sampleUser } from "./helpers"

export const problemsetRoutes = new Hono<AppEnv>()

type ProblemSetRow = typeof schema.problemset.$inferSelect
type ProgressRow = typeof schema.problemsetProgress.$inferSelect

const SOLVED_RESULTS = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

/** 必做题的 problemId；一道必做都没标的题单退回全部（和 computeProgress 同一个口径） */
function gradedIds(links: { problemId: number; isRequired: boolean }[]) {
  const required = links.filter((link) => link.isRequired)
  return new Set((required.length ? required : links).map((link) => link.problemId))
}

function progressSummary(progress: ProgressRow | undefined) {
  return progress
    ? {
        isJoined: true,
        joinTime: progress.joinTime,
        completedCount: progress.completedProblemsCount,
        totalCount: progress.totalProblemsCount,
        solvedCount: Object.keys(asRecord(progress.progressDetail)).length,
        isCompleted: progress.isCompleted,
        completeTime: progress.completeTime,
      }
    : {
        isJoined: false,
        joinTime: null,
        completedCount: 0,
        totalCount: 0,
        solvedCount: 0,
        isCompleted: false,
        completeTime: null,
      }
}

/**
 * 学生能看到的题单：公开的。老师连没公开的也能打开 —— 后台编辑完要到前台看看学生
 * 看到的样子、看全班情况，不该被 404 挡在外面。
 */
async function loadVisible(id: number, user: AuthUser | null | undefined) {
  const [row] = await db
    .select({ set: schema.problemset, assigning: assigningSql })
    .from(schema.problemset)
    .where(
      and(
        eq(schema.problemset.id, id),
        isTeacherOrAbove(user) ? undefined : eq(schema.problemset.visible, true),
      ),
    )
    .limit(1)
  return row ?? null
}

async function problemSetCreators(ids: number[]) {
  const map = new Map<number, ReturnType<typeof sampleUser>>()
  if (ids.length === 0) return map
  const rows = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      realName: schema.userProfile.realName,
    })
    .from(schema.user)
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(inArray(schema.user.id, ids))
  for (const row of rows) map.set(row.id, sampleUser(row, row.realName))
  return map
}

function badgeData(badge: typeof schema.problemsetBadge.$inferSelect, earnedTime?: string | null) {
  return {
    id: badge.id,
    problemSetId: badge.problemsetId,
    name: badge.name,
    description: badge.description,
    icon: badge.icon,
    conditionType: badge.conditionType,
    conditionValue: badge.conditionValue,
    isEarned: earnedTime === undefined ? undefined : earnedTime !== null,
    earnedTime,
  } satisfies ProblemSetBadge
}

/**
 * 一次把整页题单的附属数据全查回来，再在内存里按 problemsetId 分组。
 * 固定 6 条查询，与行数无关（按行查就是 N+1）。
 */
async function serializeProblemSets(
  rows: { set: ProblemSetRow; assigning: boolean }[],
  userId?: number,
) {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.set.id)
  const [problemCounts, joinedCounts, progresses, badges, earnedRows, creators] = await Promise.all(
    [
      db
        .select({
          problemsetId: schema.problemsetProblem.problemsetId,
          value: count(),
          required: sql<number>`count(*) filter (where ${schema.problemsetProblem.isRequired})::int`,
        })
        .from(schema.problemsetProblem)
        .where(inArray(schema.problemsetProblem.problemsetId, ids))
        .groupBy(schema.problemsetProblem.problemsetId),
      db
        .select({ problemsetId: schema.problemsetProgress.problemsetId, value: count() })
        .from(schema.problemsetProgress)
        .where(inArray(schema.problemsetProgress.problemsetId, ids))
        .groupBy(schema.problemsetProgress.problemsetId),
      userId
        ? db
            .select()
            .from(schema.problemsetProgress)
            .where(
              and(
                inArray(schema.problemsetProgress.problemsetId, ids),
                eq(schema.problemsetProgress.userId, userId),
              ),
            )
        : Promise.resolve([] as ProgressRow[]),
      db
        .select()
        .from(schema.problemsetBadge)
        .where(inArray(schema.problemsetBadge.problemsetId, ids))
        .orderBy(asc(schema.problemsetBadge.id)),
      userId
        ? db
            .select({ id: schema.userBadge.badgeId, earnedTime: schema.userBadge.earnedTime })
            .from(schema.userBadge)
            .innerJoin(
              schema.problemsetBadge,
              eq(schema.userBadge.badgeId, schema.problemsetBadge.id),
            )
            .where(
              and(
                eq(schema.userBadge.userId, userId),
                inArray(schema.problemsetBadge.problemsetId, ids),
              ),
            )
        : Promise.resolve([] as { id: number; earnedTime: string }[]),
      problemSetCreators([...new Set(rows.map((row) => row.set.createdById))]),
    ],
  )
  const countBySet = new Map(problemCounts.map((item) => [item.problemsetId, item]))
  const joinedBySet = new Map(joinedCounts.map((item) => [item.problemsetId, item.value]))
  const progressBySet = new Map(progresses.map((item) => [item.problemsetId, item]))
  const badgesBySet = new Map<number, (typeof schema.problemsetBadge.$inferSelect)[]>()
  for (const badge of badges)
    badgesBySet.set(badge.problemsetId, [...(badgesBySet.get(badge.problemsetId) ?? []), badge])
  const earned = new Map(earnedRows.map((item) => [item.id, item.earnedTime]))
  return rows.map(({ set: row, assigning }) => {
    const progress = progressBySet.get(row.id)
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      createdBy:
        creators.get(row.createdById) ?? sampleUser({ id: row.createdById, username: "" }, null),
      createTime: row.createTime,
      assignedUntil: row.assignedUntil,
      assigning,
      problemsCount: countBySet.get(row.id)?.value ?? 0,
      // 一道必做都没标的题单退回「全部都算必做」，和 computeProgress 同一个口径
      requiredCount: countBySet.get(row.id)?.required || (countBySet.get(row.id)?.value ?? 0),
      joinedCount: joinedBySet.get(row.id) ?? 0,
      userProgress: progressSummary(progress),
      badges: (badgesBySet.get(row.id) ?? []).map((badge) =>
        badgeData(badge, userId ? (earned.get(badge.id) ?? null) : undefined),
      ),
    } satisfies ProblemSet
  })
}

problemsetRoutes.get("/problem-sets", optionalAuth, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const filters = [eq(schema.problemset.visible, true)]
  const keyword = c.req.query("keyword")?.trim()
  if (keyword)
    filters.push(
      or(
        ilike(schema.problemset.title, `%${keyword}%`),
        ilike(schema.problemset.description, `%${keyword}%`),
      )!,
    )
  const where = and(...filters)
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.problemset).where(where),
    db
      .select({ set: schema.problemset, assigning: assigningSql })
      .from(schema.problemset)
      .where(where)
      .orderBy(desc(schema.problemset.createTime))
      .limit(limit)
      .offset(offset),
  ])
  return success(c, {
    results: await serializeProblemSets(rows, c.get("user")?.id),
    total: totalRows[0]?.value ?? 0,
  } satisfies ProblemSetList)
})

// 字面量路由要排在 /problem-sets/:id 前面：Hono 按注册顺序匹配，不是静态优先
// 题号（problemDisplayId）和主键（problemId）都认：提交列表那边手里只有题号
problemsetRoutes.get("/problem-sets/locks", requireAuth, async (c) => {
  const user = c.get("user")!
  if (isTeacherOrAbove(user)) return success(c, [] as ProblemSetLock[])
  let problemId = queryInteger(c.req.query("problemId"), 0, { min: 1 })
  const displayId = c.req.query("problemDisplayId")?.trim()
  if (!problemId && displayId) {
    const [problem] = await db
      .select({ id: schema.problem.id })
      .from(schema.problem)
      .where(and(eq(schema.problem.displayId, displayId), isNull(schema.problem.contestId)))
      .limit(1)
    problemId = problem?.id ?? 0
  }
  if (!problemId) return success(c, [] as ProblemSetLock[])
  const rows = await problemSetLocksFor(user.id, problemId)
  return success(c, rows satisfies ProblemSetLock[])
})

problemsetRoutes.get("/problem-sets/:id", optionalAuth, async (c) => {
  const row = await loadVisible(queryInteger(c.req.param("id"), 0, { min: 1 }), c.get("user"))
  if (!row) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const [data] = await serializeProblemSets([row], c.get("user")?.id)
  return success(c, data)
})

problemsetRoutes.get("/problem-sets/:id/problems", optionalAuth, async (c) => {
  const user = c.get("user")
  const found = await loadVisible(queryInteger(c.req.param("id"), 0, { min: 1 }), user)
  if (!found) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const id = found.set.id
  // order 后面必须再跟一个 tiebreaker：并列时 Postgres 不保证次序，而题目是按数组下标
  // 编号的（1、2、3），老题单里 order 大量重复，不定死的话「第 3 题」每次刷新都可能变
  const rows = await db
    .select({
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
  const problemIds = rows.map((row) => row.problemId)
  const [progressRows, wrongRows, cutoffs] = user
    ? await Promise.all([
        db
          .select({ detail: schema.problemsetProgress.progressDetail })
          .from(schema.problemsetProgress)
          .where(
            and(
              eq(schema.problemsetProgress.problemsetId, id),
              eq(schema.problemsetProgress.userId, user.id),
            ),
          )
          .limit(1),
        db
          .select({ problemId: schema.submission.problemId, value: count() })
          .from(schema.submission)
          .where(
            and(
              eq(schema.submission.userId, user.id),
              eq(schema.submission.problemsetId, id),
              notInArray(schema.submission.result, NON_FAILURE_RESULTS),
            ),
          )
          .groupBy(schema.submission.problemId),
        isTeacherOrAbove(user)
          ? new Map<number, string>()
          : problemSetLockCutoffs(user.id, problemIds),
      ])
    : [[], [], new Map<number, string>()]
  // 「以前做对过 · 旧代码先藏着」：这道题正被闸门挡着，而且分界之前确实做对过
  const hiddenSolved =
    user && cutoffs.size
      ? await db
          .select({ problemId: schema.submission.problemId })
          .from(schema.submission)
          .where(
            and(
              eq(schema.submission.userId, user.id),
              inArray(schema.submission.problemId, [...cutoffs.keys()]),
              inArray(schema.submission.result, SOLVED_RESULTS),
              or(
                ...[...cutoffs].map(
                  ([problemId, cutoff]) =>
                    sql`(${schema.submission.problemId} = ${problemId} and ${schema.submission.createTime} < ${cutoff})`,
                ),
              ),
            ),
          )
          .groupBy(schema.submission.problemId)
      : []
  const hidden = new Set(hiddenSolved.map((row) => row.problemId))
  const solved = asRecord(progressRows[0]?.detail)
  const wrong = new Map(wrongRows.map((row) => [row.problemId, row.value]))
  return success(
    c,
    rows.map(({ link, problemId, displayId, title, difficulty }) => {
      const entry = solved[String(problemId)]
      const solvedTime = entry === undefined ? null : asRecord(entry).submit_time
      return {
        id: link.id,
        problemSetId: link.problemsetId,
        problem: { id: problemId, _id: displayId, title, difficulty },
        order: link.order,
        isRequired: link.isRequired,
        isCompleted: entry !== undefined,
        solvedTime: typeof solvedTime === "string" ? solvedTime : null,
        wrongCount: wrong.get(problemId) ?? 0,
        oldCodeHidden: hidden.has(problemId),
      } satisfies ProblemSetProblem
    }),
  )
})

problemsetRoutes.post("/problem-set-progress", requireAuth, async (c) => {
  const parsed = await parseBody(c, joinProblemSetRequestSchema, "Invalid problem set")
  if (!parsed.success) return parsed.response
  const user = c.get("user")!
  const found = await loadVisible(parsed.data.problemSetId, user)
  if (!found) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const problemSet = found.set
  const [existing] = await db
    .select({ id: schema.problemsetProgress.id })
    .from(schema.problemsetProgress)
    .where(
      and(
        eq(schema.problemsetProgress.problemsetId, problemSet.id),
        eq(schema.problemsetProgress.userId, user.id),
      ),
    )
    .limit(1)
  if (existing) return failure(c, 409, "already-joined", "已经加入该题单")
  await db.transaction(async (tx) => {
    const links = await tx
      .select({
        problemId: schema.problemsetProblem.problemId,
        score: schema.problemsetProblem.score,
        isRequired: schema.problemsetProblem.isRequired,
      })
      .from(schema.problemsetProblem)
      .where(eq(schema.problemsetProblem.problemsetId, problemSet.id))
    // 算法本身在 services/problemset.ts —— 后台改题目后的批量重算走的是同一份
    await tx.insert(schema.problemsetProgress).values({
      problemsetId: problemSet.id,
      userId: user.id,
      joinTime: new Date().toISOString(),
      ...computeProgress({}, links, null),
    })
  })
  return success(c, null, 201)
})

problemsetRoutes.get("/users/:username/badges", optionalAuth, async (c) => {
  const requested = c.req.param("username")
  const username = requested === "me" ? c.get("user")?.username : requested
  if (!username) return failure(c, 401, "login-required", "Authentication required")
  const [target] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(eq(schema.user.username, username), eq(schema.user.isDisabled, false)))
    .limit(1)
  if (!target) return failure(c, 404, "user-not-found", "用户不存在")
  const rows = await db
    .select({
      userBadge: schema.userBadge,
      badge: schema.problemsetBadge,
      problemSet: schema.problemset,
    })
    .from(schema.userBadge)
    .innerJoin(schema.problemsetBadge, eq(schema.userBadge.badgeId, schema.problemsetBadge.id))
    .innerJoin(schema.problemset, eq(schema.problemsetBadge.problemsetId, schema.problemset.id))
    .where(eq(schema.userBadge.userId, target.id))
    .orderBy(desc(schema.userBadge.earnedTime))
  return success(
    c,
    rows.map(
      ({ userBadge, badge, problemSet }) =>
        ({
          id: userBadge.id,
          userId: userBadge.userId,
          badge: badgeData(badge),
          earnedTime: userBadge.earnedTime,
          problemSet: { id: problemSet.id, title: problemSet.title },
        }) satisfies UserBadge,
    ),
  )
})

/**
 * 老师看一个班在这份题单里的情况：真名 × 每道题（几点做对 / 错几次 / 加入前就做对过）。
 *
 * 所有老师都能看，不只是题单的创建者：系统里没有「班级归哪个老师」，课堂看板、数据统计
 * 也是任何老师看任何班，这里和它们一致。
 *
 * 班级不用老师选：从加入过的学生里数出有哪些班，最近有人加入的排第一个、默认就看它，
 * 想看别的班再换（和比赛「全班情况」按参赛者推断班级是一个思路）。名单是那个班的全部学生，
 * 没加入的也列出来，好点名。
 */
problemsetRoutes.get("/problem-sets/:id/class-view", requireTeacher, async (c) => {
  const found = await loadVisible(queryInteger(c.req.param("id"), 0, { min: 1 }), c.get("user"))
  if (!found) return failure(c, 404, "problem-set-not-found", "题单不存在")
  const id = found.set.id
  const studentRole = inArray(schema.user.adminType, [...STUDENT_ROLES])
  const [links, joinedClasses] = await Promise.all([
    db
      .select({
        problemId: schema.problem.id,
        _id: schema.problem.displayId,
        title: schema.problem.title,
        isRequired: schema.problemsetProblem.isRequired,
      })
      .from(schema.problemsetProblem)
      .innerJoin(schema.problem, eq(schema.problemsetProblem.problemId, schema.problem.id))
      .where(eq(schema.problemsetProblem.problemsetId, id))
      .orderBy(asc(schema.problemsetProblem.order), asc(schema.problemsetProblem.id)),
    db
      .select({
        className: sql<string>`${schema.user.className}`,
        joined: count(),
        last: sql<string>`max(${schema.problemsetProgress.joinTime})`,
      })
      .from(schema.problemsetProgress)
      .innerJoin(schema.user, eq(schema.user.id, schema.problemsetProgress.userId))
      .where(
        and(
          eq(schema.problemsetProgress.problemsetId, id),
          studentRole,
          sql`coalesce(${schema.user.className}, '') <> ''`,
        ),
      )
      .groupBy(schema.user.className)
      .orderBy(sql`max(${schema.problemsetProgress.joinTime}) desc`),
  ])
  const sizes = joinedClasses.length
    ? await db
        .select({ className: sql<string>`${schema.user.className}`, value: count() })
        .from(schema.user)
        .where(
          and(
            inArray(
              schema.user.className,
              joinedClasses.map((row) => row.className),
            ),
            studentRole,
            eq(schema.user.isDisabled, false),
          ),
        )
        .groupBy(schema.user.className)
    : []
  const sizeOf = new Map(sizes.map((row) => [row.className, row.value]))
  // 只有零星几个人加入的班（别的班的学生自己点进来的）排到后面去：至少 5 个、三分之一的人加入了
  // 才算「这个班在做」，这样的班按最近一次有人加入排，默认看第一个
  const classes = joinedClasses
    .map((row) => ({
      className: row.className,
      joined: row.joined,
      size: sizeOf.get(row.className) ?? row.joined,
    }))
    .map((row, recency) => ({ row, recency, doing: row.joined >= 5 && row.joined * 3 >= row.size }))
    .sort((a, b) =>
      a.doing !== b.doing
        ? Number(b.doing) - Number(a.doing)
        : a.doing
          ? a.recency - b.recency
          : b.row.joined - a.row.joined,
    )
    .map((item) => item.row)
  const wanted = c.req.query("className")?.trim()
  const className = wanted || classes[0]?.className || null
  const graded = gradedIds(links)
  const empty: ProblemSetClassView = {
    classes,
    className,
    problems: links.map((link) => ({
      id: link.problemId,
      _id: link._id,
      title: link.title,
      isRequired: link.isRequired,
      solved: 0,
    })),
    totalCount: graded.size,
    students: [],
  }
  if (!className || links.length === 0) return success(c, empty)

  const roster = await db
    .select({
      userId: schema.user.id,
      username: schema.user.username,
      realName: schema.userProfile.realName,
      progress: schema.problemsetProgress,
    })
    .from(schema.user)
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .leftJoin(
      schema.problemsetProgress,
      and(
        eq(schema.problemsetProgress.userId, schema.user.id),
        eq(schema.problemsetProgress.problemsetId, id),
      ),
    )
    .where(
      and(eq(schema.user.className, className), studentRole, eq(schema.user.isDisabled, false)),
    )
    .orderBy(asc(schema.user.username))
  if (roster.length === 0) return success(c, empty)
  const userIds = roster.map((row) => row.userId)
  const problemIds = links.map((link) => link.problemId)
  const [wrongRows, beforeRows] = await Promise.all([
    db
      .select({
        userId: schema.submission.userId,
        problemId: schema.submission.problemId,
        value: count(),
      })
      .from(schema.submission)
      .where(
        and(
          eq(schema.submission.problemsetId, id),
          inArray(schema.submission.userId, userIds),
          notInArray(schema.submission.result, NON_FAILURE_RESULTS),
        ),
      )
      .groupBy(schema.submission.userId, schema.submission.problemId),
    // 加入之前就做对过（哪个入口都算）：老师据此知道谁可能是凭记忆默写的
    db
      .select({ userId: schema.submission.userId, problemId: schema.submission.problemId })
      .from(schema.submission)
      .innerJoin(
        schema.problemsetProgress,
        and(
          eq(schema.problemsetProgress.userId, schema.submission.userId),
          eq(schema.problemsetProgress.problemsetId, id),
        ),
      )
      .where(
        and(
          inArray(schema.submission.userId, userIds),
          inArray(schema.submission.problemId, problemIds),
          inArray(schema.submission.result, SOLVED_RESULTS),
          sql`${schema.submission.createTime} < ${schema.problemsetProgress.joinTime}`,
        ),
      )
      .groupBy(schema.submission.userId, schema.submission.problemId),
  ])
  const key = (userId: number, problemId: number) => `${userId}:${problemId}`
  const wrong = new Map(wrongRows.map((row) => [key(row.userId, row.problemId), row.value]))
  const before = new Set(beforeRows.map((row) => key(row.userId, row.problemId)))
  const solvedCount = new Map<number, number>()
  const students = roster.map((row) => {
    const detail = asRecord(row.progress?.progressDetail)
    let completed = 0
    const cells = links.map((link) => {
      const entry = detail[String(link.problemId)]
      const time = entry === undefined ? null : asRecord(entry).submit_time
      if (entry !== undefined) {
        solvedCount.set(link.problemId, (solvedCount.get(link.problemId) ?? 0) + 1)
        if (graded.has(link.problemId)) completed += 1
      }
      return {
        solvedTime: typeof time === "string" ? time : null,
        wrongCount: wrong.get(key(row.userId, link.problemId)) ?? 0,
        solvedBefore: before.has(key(row.userId, link.problemId)),
      }
    })
    return {
      userId: row.userId,
      username: row.username,
      realName: row.realName,
      joinTime: row.progress?.joinTime ?? null,
      completedCount: completed,
      cells,
    }
  })
  return success(c, {
    ...empty,
    problems: empty.problems.map((problem) => ({
      ...problem,
      solved: solvedCount.get(problem.id) ?? 0,
    })),
    students,
  } satisfies ProblemSetClassView)
})

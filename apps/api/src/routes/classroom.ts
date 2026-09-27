import {
  classComparisonRequestSchema,
  STUDENT_ROLES,
  type ClassActivity,
  type ClassActivityProblem,
  type ClassComparison,
  type ClassComparisonResponse,
  type ClassRankItem,
  type ClassUserRank,
} from "@oj2/contract"
import { and, eq, gte, inArray, isNull, like, lte, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, parseBody, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { dayStart, localTime } from "../time"
import { queryInteger, rounded } from "./helpers"

export const classroomRoutes = new Hono<AppEnv>()

interface ClassUser {
  userId: number
  username: string
  className: string
  acceptedNumber: number
  submissionNumber: number
}

/**
 * 入班学生的 AC/提交数。`gradePrefix` 是年级（班号形如 `241` = 24 级 1 班），
 * 走 SQL 的 like 而不是拉全表再在内存里 startsWith —— 班级榜每换一次年级就要跑一遍，
 * 没必要每次都把全校一千多号人搬进进程。年级在调用处已校验为纯数字，不含 like 通配符。
 */
async function loadClassUsers(classNames?: string[], gradePrefix?: string) {
  const filters = [
    eq(schema.user.isDisabled, false),
    inArray(schema.user.adminType, [...STUDENT_ROLES]),
    sql`${schema.user.className} is not null`,
  ]
  if (classNames) filters.push(inArray(schema.user.className, classNames))
  if (gradePrefix) filters.push(like(schema.user.className, `${gradePrefix}%`))
  const rows = await db
    .select({
      userId: schema.user.id,
      username: schema.user.username,
      className: schema.user.className,
      acceptedNumber: schema.userProfile.acceptedNumber,
      submissionNumber: schema.userProfile.submissionNumber,
    })
    .from(schema.user)
    .innerJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(and(...filters))
  return rows.filter((row): row is ClassUser => row.className !== null)
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function quantile(values: number[], p: number) {
  if (values.length <= 1) return values[0] ?? 0
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length + 1) * p - 1
  if (position <= 0) return sorted[0]!
  if (position >= sorted.length - 1) return sorted.at(-1)!
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower]! + (sorted[lower + 1]! - sorted[lower]!) * fraction
}

function sampleStdDev(values: number[]) {
  if (values.length <= 1) return 0
  const average = mean(values)
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  )
}

classroomRoutes.get("/rankings/classes", async (c) => {
  const grade = c.req.query("grade")?.trim()
  if (!grade || !/^\d+$/.test(grade)) return failure(c, 400, "invalid-grade", "grade is required")
  const users = await loadClassUsers(undefined, grade)
  const groups = new Map<string, ClassUser[]>()
  for (const user of users)
    groups.set(user.className, [...(groups.get(user.className) ?? []), user])
  const result = [...groups]
    .map(([className, members]) => {
      const totalAc = members.reduce((sum, member) => sum + member.acceptedNumber, 0)
      const totalSubmission = members.reduce((sum, member) => sum + member.submissionNumber, 0)
      return {
        className,
        userCount: members.length,
        totalAc,
        totalSubmission,
        avgAc: rounded(totalAc / members.length),
        acRate: totalSubmission > 0 ? rounded((totalAc / totalSubmission) * 100) : 0,
      }
    })
    .sort((a, b) => b.totalAc - a.totalAc || a.totalSubmission - b.totalSubmission)
  return success(
    c,
    result.map((item, index) => ({ ...item, rank: index + 1 }) satisfies ClassRankItem),
  )
})

classroomRoutes.get("/me/class-rank", requireAuth, async (c) => {
  const user = c.get("user")!
  if (!user.className) return failure(c, 400, "class-missing", "用户没有班级信息")
  const members = (await loadClassUsers([user.className])).sort(
    (a, b) => b.acceptedNumber - a.acceptedNumber || a.submissionNumber - b.submissionNumber,
  )
  const ranks = members.map((member, index) => ({
    userId: member.userId,
    username: member.username,
    acceptedNumber: member.acceptedNumber,
    submissionNumber: member.submissionNumber,
    rank: index + 1,
  }))
  const myRank = ranks.find((rank) => rank.userId === user.id)?.rank ?? -1
  const showAll = c.req.query("scope") === "all"
  let selected = ranks
  if (showAll) {
    const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
    const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
    selected = ranks.slice(offset, offset + limit)
  } else if (myRank > 0 && ranks.length > 10) {
    const start = Math.min(Math.max(0, myRank - 6), ranks.length - 10)
    selected = ranks.slice(start, start + 10)
  }
  return success(c, {
    className: user.className,
    myRank,
    total: ranks.length,
    ranks: selected,
  } satisfies ClassUserRank)
})

/**
 * 同班同一天有这么多人做过，就算「班里在做」。2025 秋的实测分布是两极的：
 * (班级, 日, 题) 要么只有 1 个人（自己在刷），要么 13 人以上（老师点的题），
 * 5 落在中间的空档里，最小的那几个班（十来个人）也够得着。
 */
const CLASS_ACTIVITY_MIN_USERS = 5
/** 往回找几天：上完课第二天在家补作业、请假回来的学生，都还能看到上一次课做了什么 */
const CLASS_ACTIVITY_LOOKBACK_DAYS = 7
const CLASS_ACTIVITY_LIMIT = 8
/** AST_CHECK_FAILED 也是答案对了，与周榜同口径 */
const SOLVED_RESULTS = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

/**
 * 班里最近一次「一起做」的那几道题。课上老师报题号、全班去找 —— 这是 2025 秋
 * 七成非比赛提交的来路，但界面上原本没有它的入口，没听清题号的只能问同桌。
 *
 * 只取最近的**一天**，不把 7 天摊平：摊平了就是一张越来越长的旧题单，
 * 「现在该做哪道」反而看不出来。题按那天第一次有人提交的时间排，大致就是老师点题的顺序。
 */
classroomRoutes.get("/me/class-activity", requireAuth, async (c) => {
  const user = c.get("user")!
  if (!user.className) {
    return success(c, { className: null, day: null, problems: [] } satisfies ClassActivity)
  }

  const since = dayStart(Date.now() - (CLASS_ACTIVITY_LOOKBACK_DAYS - 1) * 86_400_000)
  const day = sql<string>`to_char(${localTime(schema.submission.createTime)}, 'YYYY-MM-DD')`
  const userCount = sql<number>`count(distinct ${schema.submission.userId})::int`
  const groups = await db
    .select({
      day,
      problemId: schema.submission.problemId,
      firstAt: sql<string>`min(${schema.submission.createTime})`,
      userCount,
      acceptedCount: sql<number>`count(distinct ${schema.submission.userId}) filter (where ${inArray(schema.submission.result, SOLVED_RESULTS)})::int`,
    })
    .from(schema.submission)
    .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
    .where(
      and(
        isNull(schema.submission.contestId),
        gte(schema.submission.createTime, since),
        eq(schema.user.className, user.className),
        eq(schema.user.isDisabled, false),
        inArray(schema.user.adminType, [...STUDENT_ROLES]),
      ),
    )
    .groupBy(day, schema.submission.problemId)
    .having(sql`${userCount} >= ${CLASS_ACTIVITY_MIN_USERS}`)

  const latest = groups.reduce<string | null>(
    (acc, row) => (!acc || row.day > acc ? row.day : acc),
    null,
  )
  const picked = groups
    .filter((row) => row.day === latest)
    .sort((a, b) => a.firstAt.localeCompare(b.firstAt))
    .slice(0, CLASS_ACTIVITY_LIMIT)
  if (!picked.length) {
    return success(c, {
      className: user.className,
      day: null,
      problems: [],
    } satisfies ClassActivity)
  }

  const ids = picked.map((row) => row.problemId)
  const [problems, mine] = await Promise.all([
    // 题目后来被藏起来的就不列了，点进去也是 404
    db
      .select({
        id: schema.problem.id,
        displayId: schema.problem.displayId,
        title: schema.problem.title,
      })
      .from(schema.problem)
      .where(
        and(
          inArray(schema.problem.id, ids),
          eq(schema.problem.visible, true),
          isNull(schema.problem.contestId),
        ),
      ),
    db
      .select({
        problemId: schema.submission.problemId,
        accepted: sql<boolean>`bool_or(${inArray(schema.submission.result, SOLVED_RESULTS)})`,
      })
      .from(schema.submission)
      .where(
        and(
          eq(schema.submission.userId, user.id),
          inArray(schema.submission.problemId, ids),
          isNull(schema.submission.contestId),
        ),
      )
      .groupBy(schema.submission.problemId),
  ])
  const problemById = new Map(problems.map((row) => [row.id, row]))
  const mineById = new Map(mine.map((row) => [row.problemId, row.accepted]))

  return success(c, {
    className: user.className,
    day: latest,
    problems: picked.flatMap((row) => {
      const problem = problemById.get(row.problemId)
      if (!problem) return []
      const accepted = mineById.get(row.problemId)
      return [
        {
          problemDisplayId: problem.displayId,
          title: problem.title,
          userCount: row.userCount,
          acceptedCount: row.acceptedCount,
          myStatus: accepted === undefined ? "none" : accepted ? "accepted" : "tried",
        } satisfies ClassActivityProblem,
      ]
    }),
  } satisfies ClassActivity)
})

classroomRoutes.post("/classes/comparison", async (c) => {
  const parsed = await parseBody(c, classComparisonRequestSchema, "At least one class is required")
  if (!parsed.success) return parsed.response
  const users = await loadClassUsers(parsed.data.classNames)
  const allAc = users.map((user) => user.acceptedNumber)
  const globalQ1 = quantile(allAc, 0.25)
  const globalQ3 = quantile(allAc, 0.75)
  const byClass = new Map<string, ClassUser[]>()
  for (const user of users)
    byClass.set(user.className, [...(byClass.get(user.className) ?? []), user])

  let recentByUser = new Map<number, Set<number>>()
  let recentSubmissionCount = new Map<string, number>()
  const hasTimeRange = Boolean(parsed.data.startTime && parsed.data.endTime)
  if (hasTimeRange) {
    const rows = await db
      .select({
        userId: schema.submission.userId,
        problemId: schema.submission.problemId,
        result: schema.submission.result,
      })
      .from(schema.submission)
      .where(
        and(
          inArray(
            schema.submission.userId,
            users.map((user) => user.userId),
          ),
          gte(schema.submission.createTime, parsed.data.startTime!),
          lte(schema.submission.createTime, parsed.data.endTime!),
        ),
      )
    const userClass = new Map(users.map((user) => [user.userId, user.className]))
    for (const row of rows) {
      const className = userClass.get(row.userId)
      if (!className) continue
      recentSubmissionCount.set(className, (recentSubmissionCount.get(className) ?? 0) + 1)
      if ([JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED].includes(row.result as 0 | 10)) {
        const set = recentByUser.get(row.userId) ?? new Set<number>()
        set.add(row.problemId)
        recentByUser.set(row.userId, set)
      }
    }
  }

  const comparisons = [...byClass].map(([className, members]) => {
    const ac = members.map((member) => member.acceptedNumber).sort((a, b) => b - a)
    const submissions = members.map((member) => member.submissionNumber).sort((a, b) => b - a)
    const userCount = members.length
    const topCount = Math.max(1, Math.ceil(userCount * 0.1))
    const bottomCount = topCount
    const middle = topCount + bottomCount < userCount ? ac.slice(topCount, -bottomCount) : ac
    const totalAc = ac.reduce((sum, value) => sum + value, 0)
    const totalSubmission = submissions.reduce((sum, value) => sum + value, 0)
    const base: ClassComparison = {
      className,
      userCount,
      totalAc,
      totalSubmission,
      avgAc: rounded(mean(ac)),
      medianAc: rounded(median(ac)),
      q1Ac: rounded(quantile(ac, 0.25)),
      q3Ac: rounded(quantile(ac, 0.75)),
      iqr: rounded(quantile(ac, 0.75) - quantile(ac, 0.25)),
      stdDev: rounded(sampleStdDev(ac)),
      top10Avg: rounded(mean(ac.slice(0, topCount))),
      middle80Avg: rounded(mean(middle)),
      bottom10Avg: rounded(mean(ac.slice(-bottomCount))),
      excellentRate: rounded((ac.filter((value) => value >= globalQ3).length / userCount) * 100),
      passRate: rounded((ac.filter((value) => value >= globalQ1).length / userCount) * 100),
      activeRate: rounded((submissions.filter((value) => value > 0).length / userCount) * 100),
      acRate: totalSubmission > 0 ? rounded((totalAc / totalSubmission) * 100) : 0,
      compositeScore: 0,
    }
    if (hasTimeRange) {
      const recent = members
        .map((member) => recentByUser.get(member.userId)?.size ?? 0)
        .sort((a, b) => b - a)
      base.recentTotalAc = recent.reduce((sum, value) => sum + value, 0)
      base.recentTotalSubmission = recentSubmissionCount.get(className) ?? 0
      base.recentAvgAc = rounded(mean(recent))
      base.recentMedianAc = rounded(median(recent))
      base.recentTop10Avg = rounded(
        mean(recent.slice(0, Math.max(1, Math.ceil(recent.length * 0.1)))),
      )
      base.recentActiveCount = recent.filter((value) => value > 0).length
    }
    return base
  })
  const maxMedian = Math.max(1, ...comparisons.map((item) => item.medianAc))
  const maxMiddle = Math.max(1, ...comparisons.map((item) => item.middle80Avg))
  for (const item of comparisons) {
    item.compositeScore = rounded(
      0.4 * ((item.medianAc / maxMedian) * 100) +
        0.15 * ((item.middle80Avg / maxMiddle) * 100) +
        0.2 * item.activeRate +
        0.15 * item.passRate +
        0.1 * item.excellentRate,
      1,
    )
  }
  comparisons.sort((a, b) => b.compositeScore - a.compositeScore || b.medianAc - a.medianAc)
  return success(c, {
    comparisons,
    hasTimeRange,
  } satisfies ClassComparisonResponse)
})

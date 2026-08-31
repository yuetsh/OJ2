import {
  classComparisonRequestSchema,
  classComparisonResponseSchema,
  classComparisonSchema,
  classRankItemSchema,
  classUserRankSchema,
} from "@oj2/contract"
import { and, eq, gte, inArray, like, lte, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
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
    inArray(schema.user.adminType, ["Regular User", "Student Admin"]),
    sql`${schema.user.className} is not null`,
  ]
  if (classNames) filters.push(inArray(schema.user.className, classNames))
  if (gradePrefix) filters.push(like(schema.user.className, `${gradePrefix}%`))
  const rows = await db.select({
    userId: schema.user.id,
    username: schema.user.username,
    className: schema.user.className,
    acceptedNumber: schema.userProfile.acceptedNumber,
    submissionNumber: schema.userProfile.submissionNumber,
  }).from(schema.user).innerJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id)).where(and(...filters))
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
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
}

classroomRoutes.get("/rankings/classes", async (c) => {
  const grade = c.req.query("grade")?.trim()
  if (!grade || !/^\d+$/.test(grade)) return failure(c, 400, "invalid-grade", "grade is required")
  const users = await loadClassUsers(undefined, grade)
  const groups = new Map<string, ClassUser[]>()
  for (const user of users) groups.set(user.className, [...(groups.get(user.className) ?? []), user])
  const result = [...groups].map(([className, members]) => {
    const totalAc = members.reduce((sum, member) => sum + member.acceptedNumber, 0)
    const totalSubmission = members.reduce((sum, member) => sum + member.submissionNumber, 0)
    return {
      className,
      userCount: members.length,
      totalAc,
      totalSubmission,
      avgAc: rounded(totalAc / members.length),
      acRate: totalSubmission > 0 ? rounded(totalAc / totalSubmission * 100) : 0,
    }
  }).sort((a, b) => b.totalAc - a.totalAc || a.totalSubmission - b.totalSubmission)
  return success(c, result.map((item, index) => classRankItemSchema.parse({ ...item, rank: index + 1 })))
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
  return success(c, classUserRankSchema.parse({ className: user.className, myRank, total: ranks.length, ranks: selected }))
})

classroomRoutes.post("/classes/comparison", async (c) => {
  const parsed = classComparisonRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "At least one class is required")
  const users = await loadClassUsers(parsed.data.classNames)
  const allAc = users.map((user) => user.acceptedNumber)
  const globalQ1 = quantile(allAc, 0.25)
  const globalQ3 = quantile(allAc, 0.75)
  const byClass = new Map<string, ClassUser[]>()
  for (const user of users) byClass.set(user.className, [...(byClass.get(user.className) ?? []), user])

  let recentByUser = new Map<number, Set<number>>()
  let recentSubmissionCount = new Map<string, number>()
  const hasTimeRange = Boolean(parsed.data.startTime && parsed.data.endTime)
  if (hasTimeRange) {
    const rows = await db.select({ userId: schema.submission.userId, problemId: schema.submission.problemId, result: schema.submission.result })
      .from(schema.submission).where(and(
        inArray(schema.submission.userId, users.map((user) => user.userId)),
        gte(schema.submission.createTime, parsed.data.startTime!),
        lte(schema.submission.createTime, parsed.data.endTime!),
      ))
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
    const base: Record<string, number | string> = {
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
      excellentRate: rounded(ac.filter((value) => value >= globalQ3).length / userCount * 100),
      passRate: rounded(ac.filter((value) => value >= globalQ1).length / userCount * 100),
      activeRate: rounded(submissions.filter((value) => value > 0).length / userCount * 100),
      acRate: totalSubmission > 0 ? rounded(totalAc / totalSubmission * 100) : 0,
      compositeScore: 0,
    }
    if (hasTimeRange) {
      const recent = members.map((member) => recentByUser.get(member.userId)?.size ?? 0).sort((a, b) => b - a)
      base.recentTotalAc = recent.reduce((sum, value) => sum + value, 0)
      base.recentTotalSubmission = recentSubmissionCount.get(className) ?? 0
      base.recentAvgAc = rounded(mean(recent))
      base.recentMedianAc = rounded(median(recent))
      base.recentTop10Avg = rounded(mean(recent.slice(0, Math.max(1, Math.ceil(recent.length * 0.1)))))
      base.recentActiveCount = recent.filter((value) => value > 0).length
    }
    return base
  })
  const maxMedian = Math.max(1, ...comparisons.map((item) => Number(item.medianAc)))
  const maxMiddle = Math.max(1, ...comparisons.map((item) => Number(item.middle80Avg)))
  for (const item of comparisons) {
    item.compositeScore = rounded(
      0.4 * (Number(item.medianAc) / maxMedian * 100) +
      0.15 * (Number(item.middle80Avg) / maxMiddle * 100) +
      0.2 * Number(item.activeRate) +
      0.15 * Number(item.passRate) +
      0.1 * Number(item.excellentRate),
      1,
    )
  }
  comparisons.sort((a, b) => Number(b.compositeScore) - Number(a.compositeScore) || Number(b.medianAc) - Number(a.medianAc))
  return success(c, classComparisonResponseSchema.parse({
    comparisons: comparisons.map((item) => classComparisonSchema.parse(item)),
    hasTimeRange,
  }))
})

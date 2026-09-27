/**
 * 学情统计：AI 学情分析页（/ai/detail、/ai/duration、/ai/solved）和喂给模型的
 * 数据都从这里算。原来整段放在 routes/ai.ts 里，占了那个文件六成；它们只是查询，
 * 不碰 Context，挪出来 route 文件只剩「鉴权 → 取参 → 调这里 → 回包」。
 */
import {
  type AiDetail,
  type DurationData,
  type Grade,
  type SolvedList,
  type SolvedProblem,
} from "@oj2/contract"
import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  lte,
  min,
  sql,
} from "drizzle-orm"

import type { AuthUser } from "../auth/session"
import { db, schema } from "../db"
import { JudgeStatus, type JudgeStatusValue } from "../judge/status"
import { rounded } from "../routes/helpers"
import { localTime, shiftMonthsByCalendar } from "../time"

export const accepted: JudgeStatusValue[] = [
  JudgeStatus.ACCEPTED,
  JudgeStatus.AST_CHECK_FAILED,
]
const difficultyNames: Record<string, string> = {
  Low: "简单",
  Mid: "中等",
  High: "困难",
}

function grade(rank: number | null, count: number, reference = count): Grade {
  if (!rank || count <= 0) return "C"
  const percentile = ((rank - 1) / count) * 100
  let value: Grade =
    percentile < 10 ? "S" : percentile < 35 ? "A" : percentile < 75 ? "B" : "C"
  if (reference < 10) value = value === "S" ? "A" : value === "A" ? "B" : value
  return value
}

function averageGrade(grades: Grade[]): Grade {
  const weights: Record<string, number> = { S: 4, A: 3, B: 2, C: 1 }
  const values = grades.flatMap((item) => weights[item] ?? [])
  if (!values.length) return ""
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return average >= 3.5
    ? "S"
    : average >= 2.5
      ? "A"
      : average >= 1.5
        ? "B"
        : "C"
}

type FirstAcRow = { problemId: number; first: string | null }

/** 区间内首次 AC 的题，按通过时间升序。limit/offset 给分页用，不传就是全部 */
function firstAcQuery(
  user: AuthUser,
  start: string,
  end: string,
  limit?: number,
  offset?: number,
) {
  const first = min(schema.submission.createTime)
  const query = db
    .select({ problemId: schema.submission.problemId, first })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.userId, user.id),
        inArray(schema.submission.result, accepted),
        gte(schema.submission.createTime, start),
        lte(schema.submission.createTime, end),
      ),
    )
    .groupBy(schema.submission.problemId)
    .orderBy(asc(first))
  return limit === undefined ? query : query.limit(limit).offset(offset ?? 0)
}

/**
 * 把一批「首次 AC」的题算成逐题明细（排名、等级、尝试次数）。
 * 排名只跟这批题有关，所以分页那支只需要给一页的 problemIds，不必把整年算一遍。
 */
export async function buildSolved(
  user: AuthUser,
  start: string,
  end: string,
  firstAc: FirstAcRow[],
) {
  const problemIds = firstAc.map((item) => item.problemId)
  if (!problemIds.length)
    return {
      solved: [],
      problems: [] as {
        problem: typeof schema.problem.$inferSelect
        contestTitle: string | null
      }[],
      scopeIds: null as number[] | null,
    }
  const classUsers = user.className
    ? await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.className, user.className))
    : []
  const scopeIds =
    classUsers.length > 1 ? classUsers.map((item) => item.id) : null
  const [problems, rankRows, periodRows, attemptRows] = await Promise.all([
    db
      .select({ problem: schema.problem, contestTitle: schema.contest.title })
      .from(schema.problem)
      .leftJoin(schema.contest, eq(schema.problem.contestId, schema.contest.id))
      .where(inArray(schema.problem.id, problemIds)),
    db
      .select({
        userId: schema.submission.userId,
        problemId: schema.submission.problemId,
        first: min(schema.submission.createTime),
      })
      .from(schema.submission)
      .where(
        and(
          inArray(schema.submission.result, accepted),
          inArray(schema.submission.problemId, problemIds),
          scopeIds ? inArray(schema.submission.userId, scopeIds) : undefined,
        ),
      )
      .groupBy(schema.submission.userId, schema.submission.problemId),
    db
      .select({
        userId: schema.submission.userId,
        problemId: schema.submission.problemId,
        first: min(schema.submission.createTime),
      })
      .from(schema.submission)
      .where(
        and(
          inArray(schema.submission.result, accepted),
          inArray(schema.submission.problemId, problemIds),
          gte(schema.submission.createTime, start),
          lte(schema.submission.createTime, end),
          scopeIds ? inArray(schema.submission.userId, scopeIds) : undefined,
        ),
      )
      .groupBy(schema.submission.userId, schema.submission.problemId),
    db
      .select({
        problemId: schema.submission.problemId,
        time: schema.submission.createTime,
      })
      .from(schema.submission)
      .where(
        and(
          eq(schema.submission.userId, user.id),
          inArray(schema.submission.problemId, problemIds),
          gte(schema.submission.createTime, start),
          lte(schema.submission.createTime, end),
        ),
      ),
  ])
  const byProblem = new Map(problems.map((item) => [item.problem.id, item]))
  // 到首次通过为止提交了几次：只数首次 AC 那一刻（含）之前的提交
  const firstAcTime = new Map(
    firstAc.flatMap((item) =>
      item.first ? ([[item.problemId, Date.parse(item.first)]] as const) : [],
    ),
  )
  const attemptsByProblem = new Map<number, number>()
  for (const row of attemptRows) {
    const deadline = firstAcTime.get(row.problemId)
    if (deadline === undefined || Date.parse(row.time) > deadline) continue
    attemptsByProblem.set(
      row.problemId,
      (attemptsByProblem.get(row.problemId) ?? 0) + 1,
    )
  }
  function ranks(rows: typeof rankRows, problemId: number) {
    return rows
      .filter((item) => item.problemId === problemId)
      .sort(
        (a, b) =>
          Date.parse(a.first ?? "") - Date.parse(b.first ?? "") ||
          a.userId - b.userId,
      )
  }
  const solved = firstAc
    .flatMap((item) => {
      const problem = byProblem.get(item.problemId)
      if (!problem || !item.first) return []
      const all = ranks(rankRows, item.problemId)
      const period = ranks(periodRows, item.problemId)
      const rank = all.findIndex((row) => row.userId === user.id) + 1 || null
      const periodRank =
        period.findIndex((row) => row.userId === user.id) + 1 || null
      return {
        problem: {
          title: problem.problem.title,
          displayId: problem.problem.displayId,
          contestTitle: problem.contestTitle ?? "",
          contestId: problem.problem.contestId,
        },
        acTime: item.first,
        rank,
        acCount: all.length,
        grade: grade(periodRank, period.length, all.length),
        periodRank,
        periodAcCount: period.length,
        difficulty: difficultyNames[problem.problem.difficulty] ?? "中等",
        attempts: attemptsByProblem.get(item.problemId) ?? 1,
      } satisfies SolvedProblem
    })
    .sort((a, b) => Date.parse(a.acTime) - Date.parse(b.acTime))
  return { solved, problems, scopeIds }
}

/** 分页版：只算这一页的题 */
export async function listSolved(
  user: AuthUser,
  start: string,
  end: string,
  limit: number,
  offset: number,
) {
  const [firstAc, totalRows] = await Promise.all([
    firstAcQuery(user, start, end, limit, offset),
    db
      .select({ value: countDistinct(schema.submission.problemId) })
      .from(schema.submission)
      .where(
        and(
          eq(schema.submission.userId, user.id),
          inArray(schema.submission.result, accepted),
          gte(schema.submission.createTime, start),
          lte(schema.submission.createTime, end),
        ),
      ),
  ])
  const { solved } = await buildSolved(user, start, end, firstAc)
  return {
    results: solved,
    total: totalRows[0]?.value ?? 0,
  } satisfies SolvedList
}

export async function buildDetail(user: AuthUser, start: string, end: string) {
  // 时间活跃度按**全部提交**统计，不是只按 AC。只看 AC 的话，一个学生两个月十来次
  // 通过撒进 7×4 的格子里几乎全是空的，"高峰时段"根本看不出来。
  // 星期和小时都按东八区取，和热力图同口径
  const weekday =
    sql<number>`extract(dow from ${localTime(schema.submission.createTime)})::int`.mapWith(
      Number,
    )
  const period =
    sql<number>`floor(extract(hour from ${localTime(schema.submission.createTime)}) / 6)::int`.mapWith(
      Number,
    )
  const activityRows = await db
    .select({ weekday, period, value: count() })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.userId, user.id),
        gte(schema.submission.createTime, start),
        lte(schema.submission.createTime, end),
      ),
    )
    .groupBy(weekday, period)
  const activity = activityRows.map((row) => ({
    weekday: row.weekday,
    period: row.period,
    count: row.value,
  }))
  // 区间内该用户的全部提交，一次拉回来喂两处：错题类型分布、每题到首次通过的尝试次数。
  // 放在 problemIds 的空判断之前 —— 一道题都没做出来的学生，错题分布照样有意义
  const submissions = await db
    .select({
      problemId: schema.submission.problemId,
      time: schema.submission.createTime,
      result: schema.submission.result,
    })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.userId, user.id),
        gte(schema.submission.createTime, start),
        lte(schema.submission.createTime, end),
      ),
    )
  const settledFail = (result: JudgeStatusValue) =>
    !accepted.includes(result) &&
    result !== JudgeStatus.PENDING &&
    result !== JudgeStatus.JUDGING
  const errorCounts = new Map<number, number>()
  for (const row of submissions) {
    if (!settledFail(row.result)) continue
    errorCounts.set(row.result, (errorCounts.get(row.result) ?? 0) + 1)
  }
  const errors = [...errorCounts]
    .map(([result, count]) => ({ result, count }))
    .sort((a, b) => b.count - a.count || a.result - b.result)
  const firstAc = await firstAcQuery(user, start, end)
  const problemIds = firstAc.map((item) => item.problemId)
  if (!problemIds.length)
    return {
      username: user.username,
      className: user.className,
      start,
      end,
      solvedCount: 0,
      attempts: [],
      flowcharts: [],
      grade: "",
      tags: {},
      difficulty: {},
      contestCount: 0,
      activity,
      errors,
      rankScope: "global",
    } satisfies AiDetail
  const [{ solved, problems, scopeIds }, tagRows, flowRows] = await Promise.all(
    [
      buildSolved(user, start, end, firstAc),
      db
        .select({
          problemId: schema.problemTags.problemId,
          name: schema.problemTag.name,
        })
        .from(schema.problemTags)
        .innerJoin(
          schema.problemTag,
          eq(schema.problemTags.problemtagId, schema.problemTag.id),
        )
        .where(inArray(schema.problemTags.problemId, problemIds)),
      db
        .select({
          flow: schema.flowchartSubmission,
          displayId: schema.problem.displayId,
          title: schema.problem.title,
        })
        .from(schema.flowchartSubmission)
        .innerJoin(
          schema.problem,
          eq(schema.flowchartSubmission.problemId, schema.problem.id),
        )
        .where(
          and(
            eq(schema.flowchartSubmission.userId, user.id),
            eq(schema.flowchartSubmission.status, 2),
            gte(schema.flowchartSubmission.createTime, start),
            lte(schema.flowchartSubmission.createTime, end),
          ),
        ),
    ],
  )
  const tags: Record<string, number> = {}
  for (const tag of tagRows) tags[tag.name] = (tags[tag.name] ?? 0) + 1
  const topTags = Object.fromEntries(
    Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  )
  const difficulty: Record<string, number> = { 简单: 0, 中等: 0, 困难: 0 }
  for (const item of problems) {
    const name = difficultyNames[item.problem.difficulty] ?? "中等"
    difficulty[name] = (difficulty[name] ?? 0) + 1
  }
  const flowGroups = new Map<string, typeof flowRows>()
  for (const flow of flowRows)
    flowGroups.set(flow.displayId, [
      ...(flowGroups.get(flow.displayId) ?? []),
      flow,
    ])
  const flowcharts = [...flowGroups]
    .map(([displayId, rows]) => {
      const scores = rows.flatMap((row) => row.flow.aiScore ?? [])
      // 直接留住得分最高的那一次，等级读它。原来是拿 max 回头 find 分数相等的行 ——
      // ai_score 是 double，相等比较本就不可靠；全是 null 时 max 退成 0，更是谁都匹配不上
      const top = rows.reduce(
        (best, row) =>
          (row.flow.aiScore ?? -1) > (best.flow.aiScore ?? -1) ? row : best,
        rows[0]!,
      )
      return {
        problemId: displayId,
        problemTitle: rows[0]?.title ?? "",
        submissionCount: rows.length,
        bestScore: Math.max(0, top.flow.aiScore ?? 0),
        bestGrade: top.flow.aiGrade ?? "",
        latestSubmissionTime:
          rows
            .map((row) => row.flow.createTime)
            .sort()
            .at(-1) ?? start,
        avgScore: rounded(
          scores.length
            ? scores.reduce((sum, value) => sum + value, 0) / scores.length
            : 0,
          0,
        ),
      }
    })
    .sort((a, b) =>
      b.latestSubmissionTime.localeCompare(a.latestSubmissionTime),
    )
  return {
    username: user.username,
    className: user.className,
    start,
    end,
    flowcharts,
    solvedCount: solved.length,
    attempts: solved.map((item) => item.attempts),
    grade: averageGrade(solved.map((item) => item.grade)),
    tags: topTags,
    difficulty,
    contestCount: new Set(
      solved.flatMap((item) => item.problem.contestId ?? []),
    ).size,
    activity,
    errors,
    rankScope: scopeIds ? "class" : "global",
  } satisfies AiDetail
}

export async function buildDuration(
  user: AuthUser,
  endText: string,
  duration: string,
) {
  const config =
    duration === "months:2"
      ? {
          count: 8,
          unit: "weeks",
          rewind: (date: Date) => new Date(date.getTime() - 9 * 7 * 864e5),
          advance: (date: Date) => new Date(date.getTime() + 7 * 864e5),
        }
      : duration === "months:6"
        ? {
            count: 6,
            unit: "months",
            rewind: (date: Date) => shiftMonthsByCalendar(date, -7),
            advance: (date: Date) => shiftMonthsByCalendar(date, 1),
          }
        : duration === "years:1"
          ? {
              count: 12,
              unit: "months",
              rewind: (date: Date) => shiftMonthsByCalendar(date, -13),
              advance: (date: Date) => shiftMonthsByCalendar(date, 1),
            }
          : {
              count: 4,
              unit: "weeks",
              rewind: (date: Date) => new Date(date.getTime() - 5 * 7 * 864e5),
              advance: (date: Date) => new Date(date.getTime() + 7 * 864e5),
            }
  // 先把 count 个时间桶算出来，再一条查询把整段区间的提交拉回来在内存里分桶。
  // 以前是每个桶两条查询、桶之间还是串行的，一年 12 个桶就是 24 次往返。
  // 相邻桶首尾相接、两端都是闭区间（end_i == start_{i+1}），落在边界上的提交
  // 两个桶都算 —— 这是旧行为，照搬，不要「顺手」改成半开区间。
  let cursor = config.rewind(new Date(endText))
  const buckets: { start: Date; end: Date }[] = []
  for (let index = 0; index < config.count; index++) {
    const start = config.advance(cursor)
    buckets.push({ start, end: config.advance(start) })
    cursor = start
  }
  // 时间戳取 epoch 毫秒回来，比较在 JS 里做，和原来在 SQL 里比 timestamptz 等价，
  // 不受 pg 那个「空格分隔 + +00 偏移」字符串格式能否被 Date.parse 认的影响
  const rows = await db
    .select({
      time: sql<number>`extract(epoch from ${schema.submission.createTime}) * 1000`.mapWith(
        Number,
      ),
      problemId: schema.submission.problemId,
      result: schema.submission.result,
    })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.userId, user.id),
        gte(schema.submission.createTime, buckets[0]!.start.toISOString()),
        lte(schema.submission.createTime, buckets.at(-1)!.end.toISOString()),
      ),
    )
  // 每个桶的等级 = 桶内解出的每道题各算一个等级再取平均，排名按「同班同学在这个桶里
  // 解出该题的先后」。和旧后端 OnlineJudge/ai/views/oj.py:484 一条一条对齐，包括这里
  // 不传 reference（不打小规模折扣）—— 那个折扣只在 /ai/detail 那支用。
  // 迁移时这里被写死成 `solved ? "B" : ""`，DurationChart 上那条等级折线因此恒定在 B。
  const solvedIds = [
    ...new Set(
      rows
        .filter((row) => accepted.includes(row.result))
        .map((row) => row.problemId),
    ),
  ]
  const classUsers = user.className
    ? await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.className, user.className))
    : []
  const scopeIds =
    classUsers.length > 1 ? classUsers.map((item) => item.id) : null
  const peers = solvedIds.length
    ? await db
        .select({
          time: sql<number>`extract(epoch from ${schema.submission.createTime}) * 1000`.mapWith(
            Number,
          ),
          userId: schema.submission.userId,
          problemId: schema.submission.problemId,
        })
        .from(schema.submission)
        .where(
          and(
            inArray(schema.submission.result, accepted),
            inArray(schema.submission.problemId, solvedIds),
            gte(schema.submission.createTime, buckets[0]!.start.toISOString()),
            lte(
              schema.submission.createTime,
              buckets.at(-1)!.end.toISOString(),
            ),
            scopeIds ? inArray(schema.submission.userId, scopeIds) : undefined,
          ),
        )
    : []
  // 一次查回来在内存里按题分组再按桶切，别在循环里发查询：一年 12 个桶 × 几十道题
  const peersByProblem = new Map<number, typeof peers>()
  for (const row of peers)
    peersByProblem.set(row.problemId, [
      ...(peersByProblem.get(row.problemId) ?? []),
      row,
    ])

  function bucketGrade(problemIds: number[], from: number, to: number) {
    return averageGrade(
      problemIds.map((problemId) => {
        const firstAc = new Map<number, number>()
        for (const row of peersByProblem.get(problemId) ?? []) {
          if (row.time < from || row.time > to) continue
          const seen = firstAc.get(row.userId)
          if (seen === undefined || row.time < seen)
            firstAc.set(row.userId, row.time)
        }
        const ordered = [...firstAc].sort((a, b) => a[1] - b[1] || a[0] - b[0])
        const rank = ordered.findIndex(([id]) => id === user.id) + 1 || null
        return grade(rank, ordered.length)
      }),
    )
  }

  return buckets.map((bucket, index) => {
    const from = bucket.start.getTime()
    const to = bucket.end.getTime()
    const inRange = rows.filter((row) => row.time >= from && row.time <= to)
    const acceptedRows = inRange.filter((row) => accepted.includes(row.result))
    const solved = [...new Set(acceptedRows.map((row) => row.problemId))]
    return {
      unit: config.unit,
      index: config.count - 1 - index,
      start: bucket.start.toISOString(),
      end: bucket.end.toISOString(),
      grade: solved.length ? bucketGrade(solved, from, to) : "",
      problemCount: solved.length,
      acceptedCount: acceptedRows.length,
      submissionCount: inRange.length,
    } satisfies DurationData
  })
}

import {
  aiAnalysisRecordSchema,
  aiAnalysisRequestSchema,
  aiDetailSchema,
  aiHintRequestSchema,
  classAnalysisRequestSchema,
  classPkAnalysisRequestSchema,
  durationDataSchema,
  heatmapItemSchema,
  loginSummarySchema,
  solvedProblemSchema,
} from "@oj2/contract"
import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNull, lte, min, ne, sql } from "drizzle-orm"
import { Hono, type Context } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { getPreviousLogin } from "../auth/session"
import { config } from "../config"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { completeChat, streamChat } from "../services/ai"
import { isTeacherOrAbove, objectValue, rounded } from "./helpers"

export const aiRoutes = new Hono<AppEnv>()

const accepted = [0, 10]
const difficultyNames: Record<string, string> = { Low: "简单", Mid: "中等", High: "困难" }

function grade(rank: number | null, count: number, reference = count) {
  if (!rank || count <= 0) return "C"
  const percentile = (rank - 1) / count * 100
  let value = percentile < 10 ? "S" : percentile < 35 ? "A" : percentile < 75 ? "B" : "C"
  if (reference < 10) value = value === "S" ? "A" : value === "A" ? "B" : value
  return value
}

function averageGrade(grades: string[]) {
  const weights: Record<string, number> = { S: 4, A: 3, B: 2, C: 1 }
  const values = grades.flatMap((item) => weights[item] ?? [])
  if (!values.length) return ""
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return average >= 3.5 ? "S" : average >= 2.5 ? "A" : average >= 1.5 ? "B" : "C"
}

async function targetUser(c: Context<AppEnv>) {
  const current = c.get("user")!
  const username = c.req.query("username")
  if (!username || !isTeacherOrAbove(current)) return current
  const [target] = await db.select({
    id: schema.user.id,
    username: schema.user.username,
    email: schema.user.email,
    adminType: schema.user.adminType,
    problemPermission: schema.user.problemPermission,
    isDisabled: schema.user.isDisabled,
    className: schema.user.className,
  }).from(schema.user).where(eq(schema.user.username, username)).limit(1)
  return target ?? null
}

aiRoutes.get("/ai/detail", requireAuth, async (c) => {
  const start = c.req.query("start")
  const end = c.req.query("end")
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return failure(c, 400, "invalid-range", "start and end must be ISO 8601 timestamps")
  }
  const user = await targetUser(c)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  const firstAc = await db.select({ problemId: schema.submission.problemId, first: min(schema.submission.createTime) })
    .from(schema.submission).where(and(
      eq(schema.submission.userId, user.id), inArray(schema.submission.result, accepted),
      gte(schema.submission.createTime, start), lte(schema.submission.createTime, end),
    )).groupBy(schema.submission.problemId)
  const problemIds = firstAc.map((item) => item.problemId)
  if (!problemIds.length) return success(c, aiDetailSchema.parse({
    user: user.username, className: user.className, start, end, solved: [], flowcharts: [], grade: "", tags: {}, difficulty: {}, contestCount: 0,
  }))
  const classUsers = user.className ? await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.className, user.className)) : []
  const scopeIds = classUsers.length > 1 ? classUsers.map((item) => item.id) : null
  const [problems, rankRows, periodRows, tagRows, flowRows] = await Promise.all([
    db.select({ problem: schema.problem, contestTitle: schema.contest.title }).from(schema.problem)
      .leftJoin(schema.contest, eq(schema.problem.contestId, schema.contest.id)).where(inArray(schema.problem.id, problemIds)),
    db.select({ userId: schema.submission.userId, problemId: schema.submission.problemId, first: min(schema.submission.createTime) })
      .from(schema.submission).where(and(inArray(schema.submission.result, accepted), inArray(schema.submission.problemId, problemIds), scopeIds ? inArray(schema.submission.userId, scopeIds) : undefined))
      .groupBy(schema.submission.userId, schema.submission.problemId),
    db.select({ userId: schema.submission.userId, problemId: schema.submission.problemId, first: min(schema.submission.createTime) })
      .from(schema.submission).where(and(inArray(schema.submission.result, accepted), inArray(schema.submission.problemId, problemIds), gte(schema.submission.createTime, start), lte(schema.submission.createTime, end), scopeIds ? inArray(schema.submission.userId, scopeIds) : undefined))
      .groupBy(schema.submission.userId, schema.submission.problemId),
    db.select({ problemId: schema.problemTags.problemId, name: schema.problemTag.name }).from(schema.problemTags)
      .innerJoin(schema.problemTag, eq(schema.problemTags.problemtagId, schema.problemTag.id)).where(inArray(schema.problemTags.problemId, problemIds)),
    db.select({ flow: schema.flowchartSubmission, displayId: schema.problem.displayId, title: schema.problem.title })
      .from(schema.flowchartSubmission).innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
      .where(and(eq(schema.flowchartSubmission.userId, user.id), eq(schema.flowchartSubmission.status, 2), gte(schema.flowchartSubmission.createTime, start), lte(schema.flowchartSubmission.createTime, end))),
  ])
  const byProblem = new Map(problems.map((item) => [item.problem.id, item]))
  function ranks(rows: typeof rankRows, problemId: number) {
    return rows.filter((item) => item.problemId === problemId).sort((a, b) => Date.parse(a.first ?? "") - Date.parse(b.first ?? "") || a.userId - b.userId)
  }
  const solved = firstAc.flatMap((item) => {
    const problem = byProblem.get(item.problemId)
    if (!problem || !item.first) return []
    const all = ranks(rankRows, item.problemId)
    const period = ranks(periodRows, item.problemId)
    const rank = all.findIndex((row) => row.userId === user.id) + 1 || null
    const periodRank = period.findIndex((row) => row.userId === user.id) + 1 || null
    return solvedProblemSchema.parse({
      problem: { title: problem.problem.title, displayId: problem.problem.displayId, contestTitle: problem.contestTitle ?? "", contestId: problem.problem.contestId },
      acTime: item.first, rank, acCount: all.length, grade: grade(periodRank, period.length, all.length), periodRank, periodAcCount: period.length,
      difficulty: difficultyNames[problem.problem.difficulty] ?? "中等",
    })
  }).sort((a, b) => Date.parse(a.acTime) - Date.parse(b.acTime))
  const tags: Record<string, number> = {}
  for (const tag of tagRows) tags[tag.name] = (tags[tag.name] ?? 0) + 1
  const topTags = Object.fromEntries(Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 5))
  const difficulty: Record<string, number> = { 简单: 0, 中等: 0, 困难: 0 }
  for (const item of problems) {
    const name = difficultyNames[item.problem.difficulty] ?? "中等"
    difficulty[name] = (difficulty[name] ?? 0) + 1
  }
  const flowGroups = new Map<string, typeof flowRows>()
  for (const flow of flowRows) flowGroups.set(flow.displayId, [...(flowGroups.get(flow.displayId) ?? []), flow])
  const flowcharts = [...flowGroups].map(([displayId, rows]) => {
    const scores = rows.flatMap((row) => row.flow.aiScore ?? [])
    const best = Math.max(0, ...scores)
    return {
      problemId: displayId,
      problemTitle: rows[0]?.title ?? "",
      submissionCount: rows.length,
      bestScore: best,
      bestGrade: rows.find((row) => row.flow.aiScore === best)?.flow.aiGrade ?? "",
      latestSubmissionTime: rows.map((row) => row.flow.createTime).sort().at(-1) ?? start,
      avgScore: rounded(scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0, 0),
    }
  }).sort((a, b) => b.latestSubmissionTime.localeCompare(a.latestSubmissionTime))
  return success(c, aiDetailSchema.parse({
    user: user.username, className: user.className, start, end, solved, flowcharts,
    grade: averageGrade(solved.map((item) => item.grade)), tags: topTags, difficulty,
    contestCount: new Set(solved.flatMap((item) => item.problem.contestId ?? [])).size,
  }))
})

function shiftMonths(date: Date, months: number) {
  const result = new Date(date)
  const day = result.getDate()
  result.setDate(1)
  result.setMonth(result.getMonth() + months)
  result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()))
  return result
}

aiRoutes.get("/ai/duration", requireAuth, async (c) => {
  const endText = c.req.query("end")
  if (!endText || Number.isNaN(Date.parse(endText))) return failure(c, 400, "invalid-end", "end must be an ISO timestamp")
  const user = await targetUser(c)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  const duration = c.req.query("duration") ?? "months:1"
  const config = duration === "months:2" ? { count: 8, unit: "weeks", rewind: (date: Date) => new Date(date.getTime() - 9 * 7 * 864e5), advance: (date: Date) => new Date(date.getTime() + 7 * 864e5) }
    : duration === "months:6" ? { count: 6, unit: "months", rewind: (date: Date) => shiftMonths(date, -7), advance: (date: Date) => shiftMonths(date, 1) }
      : duration === "years:1" ? { count: 12, unit: "months", rewind: (date: Date) => shiftMonths(date, -13), advance: (date: Date) => shiftMonths(date, 1) }
        : { count: 4, unit: "weeks", rewind: (date: Date) => new Date(date.getTime() - 5 * 7 * 864e5), advance: (date: Date) => new Date(date.getTime() + 7 * 864e5) }
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
  const rows = await db.select({
    time: sql<number>`extract(epoch from ${schema.submission.createTime}) * 1000`.mapWith(Number),
    problemId: schema.submission.problemId,
    result: schema.submission.result,
  }).from(schema.submission).where(and(
    eq(schema.submission.userId, user.id),
    gte(schema.submission.createTime, buckets[0]!.start.toISOString()),
    lte(schema.submission.createTime, buckets.at(-1)!.end.toISOString()),
  ))
  const data = buckets.map((bucket, index) => {
    const from = bucket.start.getTime()
    const to = bucket.end.getTime()
    const inRange = rows.filter((row) => row.time >= from && row.time <= to)
    const solved = new Set(inRange.filter((row) => accepted.includes(row.result)).map((row) => row.problemId)).size
    return durationDataSchema.parse({
      unit: config.unit,
      index: config.count - 1 - index,
      start: bucket.start.toISOString(),
      end: bucket.end.toISOString(),
      grade: solved ? "B" : "",
      problemCount: solved,
      submissionCount: inRange.length,
    })
  })
  return success(c, data)
})

aiRoutes.get("/ai/heatmap", requireAuth, async (c) => {
  const user = await targetUser(c)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  const end = new Date()
  const start = new Date(end.getTime() - 365 * 864e5)
  const date = sql<string>`date(${schema.submission.createTime})::text`
  const rows = await db.select({ date, value: count() }).from(schema.submission)
    .where(and(eq(schema.submission.userId, user.id), gte(schema.submission.createTime, start.toISOString()), lte(schema.submission.createTime, end.toISOString())))
    .groupBy(date).orderBy(date)
  const counts = new Map(rows.map((row) => [row.date, row.value]))
  return success(c, Array.from({ length: 365 }, (_, index) => {
    const day = new Date(start.getTime() + index * 864e5)
    return heatmapItemSchema.parse({ timestamp: new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(), value: counts.get(day.toISOString().slice(0, 10)) ?? 0 })
  }))
})

aiRoutes.get("/ai/login-summary", requireAuth, async (c) => {
  const user = c.get("user")!
  const end = new Date()
  const [userRow] = await db.select({ createTime: schema.user.createTime, lastLogin: schema.user.lastLogin }).from(schema.user).where(eq(schema.user.id, user.id)).limit(1)
  const previous = await getPreviousLogin(c)
  let start = new Date(previous ?? userRow?.lastLogin ?? userRow?.createTime ?? end.getTime() - 7 * 864e5)
  if (start >= end) start = new Date(end.getTime() - 864e5)
  const range = and(gte(schema.submission.createTime, start.toISOString()), lte(schema.submission.createTime, end.toISOString()))
  const [newProblems, submissions, acceptedRows, solvedRows, flowRows] = await Promise.all([
    db.select({ value: count() }).from(schema.problem).where(and(isNull(schema.problem.contestId), eq(schema.problem.visible, true), gte(schema.problem.createTime, start.toISOString()), lte(schema.problem.createTime, end.toISOString()))),
    db.select({ value: count() }).from(schema.submission).where(and(eq(schema.submission.userId, user.id), range)),
    db.select({ value: count() }).from(schema.submission).where(and(eq(schema.submission.userId, user.id), inArray(schema.submission.result, accepted), range)),
    db.select({ value: countDistinct(schema.submission.problemId) }).from(schema.submission).where(and(eq(schema.submission.userId, user.id), inArray(schema.submission.result, accepted), range)),
    db.select({ value: count() }).from(schema.flowchartSubmission).where(and(eq(schema.flowchartSubmission.userId, user.id), gte(schema.flowchartSubmission.createTime, start.toISOString()), lte(schema.flowchartSubmission.createTime, end.toISOString()))),
  ])
  const summary = {
    start: start.toISOString(), end: end.toISOString(), newProblemCount: newProblems[0]?.value ?? 0,
    submissionCount: submissions[0]?.value ?? 0, acceptedCount: acceptedRows[0]?.value ?? 0,
    solvedCount: solvedRows[0]?.value ?? 0, flowchartSubmissionCount: flowRows[0]?.value ?? 0,
  }
  let analysis = ""
  let analysisError: string | undefined
  if (summary.submissionCount >= 3) {
    try {
      analysis = await completeChat("你是 OnlineJudge 的学习助教。请根据统计数据给出简短分析(1-2句)，再给出一行以“结论：”开头的结论。", JSON.stringify(summary))
    } catch (error) {
      analysisError = error instanceof Error ? error.message : String(error)
    }
  }
  return success(c, loginSummarySchema.parse({ summary, analysis, analysisError }))
})

aiRoutes.get("/ai/pinned", requireAuth, async (c) => {
  const [row] = await db.select({ analysis: schema.aiAnalysis, username: schema.user.username }).from(schema.aiAnalysis)
    .innerJoin(schema.user, eq(schema.aiAnalysis.userId, schema.user.id))
    .where(and(eq(schema.aiAnalysis.userId, c.get("user")!.id), eq(schema.aiAnalysis.isPinned, true))).limit(1)
  if (!row) return success(c, null)
  return success(c, aiAnalysisRecordSchema.parse({
    id: row.analysis.id, provider: row.analysis.provider, model: row.analysis.model, data: objectValue(row.analysis.data),
    analysis: row.analysis.analysis, createTime: row.analysis.createTime, isPinned: row.analysis.isPinned, username: row.username,
  }))
})

aiRoutes.post("/ai/analysis", requireAuth, async (c) => {
  const parsed = aiAnalysisRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "details and duration are required")
  const user = c.get("user")!
  const system = "你是一个风趣的编程老师。请根据学生的详细数据和每周数据给出学习建议，最后写一句鼓励的话。使用 Markdown，不要放在代码块中。"
  const prompt = `详细数据: ${JSON.stringify(parsed.data.details)}\n每周或每月数据: ${JSON.stringify(parsed.data.duration)}`
  return streamChat(system, prompt, async (analysis) => {
    await db.insert(schema.aiAnalysis).values({
      provider: "deepseek", model: config.aiModel, data: parsed.data, systemPrompt: system,
      userPrompt: "学习详情与周期数据", analysis, createTime: new Date().toISOString(), userId: user.id, isPinned: false,
    })
  })
})

aiRoutes.post("/ai/hint", requireAuth, async (c) => {
  const parsed = aiHintRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "submissionId is required")
  const [row] = await db.select({ submission: schema.submission, problem: schema.problem }).from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .where(and(eq(schema.submission.id, parsed.data.submissionId), eq(schema.submission.userId, c.get("user")!.id))).limit(1)
  if (!row) return failure(c, 404, "submission-not-found", "Submission not found")
  const answers = Array.isArray(row.problem.answers) ? row.problem.answers.filter((item): item is { language?: unknown; code?: unknown } => Boolean(item && typeof item === "object")) : []
  const selected = answers.find((item) => item.language === row.submission.language) ?? answers[0]
  const reference = typeof selected?.code === "string" ? selected.code : ""
  const system = "你是编程助教。对照参考答案指出学生代码最关键的一个问题，循序渐进地提示，绝不直接给出核心算法或完整解法。输入读取错误可以直接给出正确片段。使用 Markdown，不超过6句话。"
  const prompt = `题目：${row.problem.title}\n描述：${row.problem.description.slice(0, 500)}\n参考答案（不可透露）：${reference.slice(0, 2000)}\n语言：${row.submission.language}\n结果：${row.submission.result}\n错误：${String(objectValue(row.submission.statisticInfo).err_info ?? "无")}\n代码：${row.submission.code.slice(0, 2000)}`
  return streamChat(system, prompt)
})

aiRoutes.post("/ai/class-analysis", requireAuth, async (c) => {
  const parsed = classAnalysisRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Class data is required")
  return streamChat("你是编程教育数据分析专家。根据班级 OJ 数据，从整体水平、参与积极性、均衡性、梯队和改进建议五方面输出中文 Markdown 报告。", JSON.stringify(parsed.data.comparison))
})

aiRoutes.post("/ai/class-pk-analysis", requireAuth, async (c) => {
  if (!isTeacherOrAbove(c.get("user"))) return failure(c, 403, "permission-denied", "Permission denied")
  const parsed = classPkAnalysisRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "At least two classes are required")
  return streamChat("你是编程教育数据分析专家。根据多个班级 OJ 对比数据，从排名、参与度、典型学生水平、均衡性、梯队、提交质量和教学建议七方面输出中文 Markdown 报告。", `${parsed.data.timeRangeLabel}\n${JSON.stringify(parsed.data.comparisons)}`)
})

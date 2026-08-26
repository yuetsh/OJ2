import { randomBytes } from "node:crypto"

import {
  createSubmissionRequestSchema,
  createSubmissionResponseSchema,
  formatCodeRequestSchema,
  formatCodeResponseSchema,
  shareSubmissionRequestSchema,
  submissionDetailSchema,
  submissionListItemSchema,
  submissionListSchema,
  submissionStatisticsSchema,
} from "@oj2/contract"
import { and, count, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"

import {
  optionalAuth,
  requireAuth,
  requireSuperAdmin,
  requireTeacher,
} from "../auth/middleware"
import type { AuthUser } from "../auth/session"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { judgeQueue } from "../queue"
import {
  canAccessContest,
  contestStatus,
  findVisibleContest,
  ipAllowed,
  isContestAdmin,
  requireContestAccess,
  type ContestEnv,
} from "../services/contest"
import { CodeFormatError, formatCode } from "../services/format-code"
import { getBooleanOption } from "../services/options"
import { consumeToken } from "../services/throttling"
import {
  isAdminRole,
  queryInteger,
  rounded,
  stripClassPrefix,
  todayStart,
} from "./helpers"

export const submissionRoutes = new Hono<ContestEnv>()

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function requestIp(c: { req: { header(name: string): string | undefined } }) {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded || c.req.header("x-real-ip") || null
}

submissionRoutes.post("/submissions", requireAuth, async (c) => {
  const parsed = createSubmissionRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  )
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", "Invalid submission payload")
  }
  let contestId: number | null = null
  if (parsed.data.contestId) {
    // 这里用不了 requireContestAccess 中间件：比赛 id 来自请求体，
    // 中间件跑的时候 body 还没解析。全仓只有这一处仍是手工调用，改动时留意别漏掉鉴权。
    const contest = await findVisibleContest(parsed.data.contestId)
    if (!contest) return failure(c, 404, "contest-not-found", "Contest does not exist")
    const access = await canAccessContest(c, contest, "problems")
    if (!access.ok) return failure(c, access.code === "login-required" ? 401 : 403, access.code, access.message)
    if (contestStatus(contest) === "-1") return failure(c, 403, "contest-ended", "The contest has ended")
    if (!isContestAdmin(c.get("user"), contest) && !ipAllowed(requestIp(c), contest.allowedIpRanges)) {
      return failure(c, 403, "ip-not-allowed", "Your IP is not allowed in this contest")
    }
    contestId = contest.id
  }

  // 限流，位置与旧后端 submission/views/oj.py 的 SubmissionAPI.post 一致：
  // 比赛权限校验之后、取题目之前，按用户 id 消耗一个令牌。判题沙箱是有限资源。
  const throttle = await consumeToken("user", String(c.get("user")!.id))
  if (!throttle.allowed) {
    return failure(c, 429, "too-many-submissions", `Please wait ${Math.floor(throttle.wait)} seconds`)
  }

  const [problem] = await db
    .select({
      id: schema.problem.id,
      languages: schema.problem.languages,
    })
    .from(schema.problem)
    .where(
      and(
        eq(schema.problem.id, parsed.data.problemId),
        eq(schema.problem.visible, true),
        contestId === null ? isNull(schema.problem.contestId) : eq(schema.problem.contestId, contestId),
      ),
    )
    .limit(1)

  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!stringArray(problem.languages).includes(parsed.data.language)) {
    return failure(
      c,
      400,
      "language-not-allowed",
      `${parsed.data.language} is not allowed in the problem`,
    )
  }

  const user = c.get("user")!
  const submissionId = randomBytes(16).toString("hex")
  const createTime = new Date().toISOString()
  const ip = requestIp(c)

  await db.insert(schema.submission).values({
    id: submissionId,
    problemId: problem.id,
    createTime,
    userId: user.id,
    username: user.username,
    code: parsed.data.code,
    result: JudgeStatus.PENDING,
    info: {},
    language: parsed.data.language,
    shared: false,
    statisticInfo: {},
    ip,
    contestId,
  })

  try {
    await judgeQueue.add(
      "judge",
      { submissionId, problemId: problem.id },
      { jobId: submissionId },
    )
  } catch (error) {
    await db
      .update(schema.submission)
      .set({ result: JudgeStatus.SYSTEM_ERROR })
      .where(eq(schema.submission.id, submissionId))
    console.error("Failed to enqueue submission", error)
    return failure(c, 502, "queue-unavailable", "Judge queue is unavailable")
  }

  return success(
    c,
    createSubmissionResponseSchema.parse({ submissionId }),
    201,
  )
})

submissionRoutes.get("/submissions/today-count", async (c) => {
  const language = c.req.query("language")
  if (language === "Flowchart") {
    const [row] = await db.select({ value: count() }).from(schema.flowchartSubmission)
      .where(sql`${schema.flowchartSubmission.createTime} >= ${todayStart()}`)
    return success(c, row?.value ?? 0)
  }
  const [row] = await db.select({ value: count() }).from(schema.submission)
    .where(and(isNull(schema.submission.contestId), sql`${schema.submission.createTime} >= ${todayStart()}`))
  return success(c, row?.value ?? 0)
})

const ACCEPTED_RESULTS = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

/**
 * 统计接口共用的时间窗解析。旧后端 `end` 必填、`start` 可选（不给就是「全部时段」）。
 */
function statisticsRange(c: { req: { query(name: string): string | undefined } }) {
  const end = c.req.query("end")?.trim()
  if (!end) return null
  const start = c.req.query("start")?.trim()
  return { start: start || null, end }
}

/**
 * 按题号（展示用的 _id）定位公开题目。找不到时统计接口要报错而不是退化成「全部题目」，
 * 否则教师打错一个字就会看到全站数据还以为是本题的。
 */
async function findPublicProblemByDisplayId(displayId: string) {
  const [row] = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(
      and(
        sql`lower(${schema.problem.displayId}) = lower(${displayId})`,
        isNull(schema.problem.contestId),
        eq(schema.problem.visible, true),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * 用户名模糊匹配到的在册学生，用来算「班级人数」和「谁没做」。
 * 只算未禁用的普通用户 —— 教师和管理员不该出现在完成度分母里。
 */
async function matchedStudents(username: string) {
  return db
    .select({ username: schema.user.username, className: schema.user.className })
    .from(schema.user)
    .where(
      and(
        ilike(schema.user.username, `%${username}%`),
        eq(schema.user.isDisabled, false),
        eq(schema.user.adminType, "Regular User"),
      ),
    )
}

submissionRoutes.get("/submissions/statistics", requireTeacher, async (c) => {
  const range = statisticsRange(c)
  if (!range) return failure(c, 400, "invalid-request", "end is required")

  const filters = [
    isNull(schema.submission.contestId),
    sql`${schema.submission.createTime} <= ${range.end}`,
  ]
  if (range.start) filters.push(sql`${schema.submission.createTime} >= ${range.start}`)

  const displayId = c.req.query("problemId")?.trim()
  if (displayId) {
    const problem = await findPublicProblemByDisplayId(displayId)
    if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
    filters.push(eq(schema.submission.problemId, problem.id))
  }

  const username = c.req.query("username")?.trim()
  if (username) filters.push(ilike(schema.submission.username, `%${username}%`))
  const where = and(...filters)

  const acceptedFilter = sql`count(*) filter (where ${inArray(schema.submission.result, ACCEPTED_RESULTS)})`

  const [[totals], perUser, rosterRows, items] = await Promise.all([
    db
      .select({ total: count(), accepted: acceptedFilter.mapWith(Number) })
      .from(schema.submission)
      .where(where),
    db
      .select({
        username: schema.submission.username,
        submissionCount: count(),
        acceptedCount: acceptedFilter.mapWith(Number),
      })
      .from(schema.submission)
      .where(where)
      .groupBy(schema.submission.username)
      .orderBy(desc(count())),
    // 只有指定了用户名才有「班级人数」这个概念；不指定时分母无意义，旧后端也返回 0
    username ? matchedStudents(username) : Promise.resolve([]),
    db
      .select({
        username: schema.submission.username,
        id: schema.submission.id,
        result: schema.submission.result,
      })
      .from(schema.submission)
      .where(where)
      .orderBy(desc(schema.submission.createTime)),
  ])

  const submissionCount = totals?.total ?? 0
  const acceptedCount = totals?.accepted ?? 0

  const itemsByUser = new Map<string, { id: string; result: number }[]>()
  for (const item of items) {
    const bucket = itemsByUser.get(item.username)
    if (bucket) bucket.push({ id: item.id, result: item.result })
    else itemsByUser.set(item.username, [{ id: item.id, result: item.result }])
  }

  const submittedUsernames = new Set(perUser.map((row) => row.username))
  const classNames = new Map<string, string | null>()
  if (submittedUsernames.size) {
    const rows = await db
      .select({ username: schema.user.username, className: schema.user.className })
      .from(schema.user)
      .where(inArray(schema.user.username, [...submittedUsernames]))
    for (const row of rows) classNames.set(row.username, row.className)
  }

  // 只列出有正确提交的人。做了但一次没对的学生落在「未完成」那一栏
  const data = perUser
    .filter((row) => row.acceptedCount > 0)
    .map((row) => ({
      username: row.username,
      className: classNames.get(row.username) ?? null,
      submissionCount: row.submissionCount,
      acceptedCount: row.acceptedCount,
      correctRate: rounded((row.acceptedCount / row.submissionCount) * 100),
      submissionItems: itemsByUser.get(row.username) ?? [],
    }))

  const dataUnaccepted = rosterRows
    .filter((row) => !submittedUsernames.has(row.username))
    .map((row) => ({
      username: row.username,
      realName: stripClassPrefix(row.username, row.className),
    }))

  // 顺序照搬旧后端：先用原始 person_count 算完成度，再修正 person_count。
  // 修正是为了兜住「学生已删号但提交记录还在」——那时完成人数会大于花名册人数。
  let personCount = rosterRows.length
  let personRate = 0
  if (personCount) {
    personRate = Math.min(100, rounded((data.length / personCount) * 100))
    if (personCount < data.length) personCount = data.length
  }

  return success(
    c,
    submissionStatisticsSchema.parse({
      submissionCount,
      acceptedCount,
      correctRate: submissionCount ? rounded((acceptedCount / submissionCount) * 100) : 0,
      personCount,
      personRate,
      data,
      dataUnaccepted,
    }),
  )
})

submissionRoutes.post("/submissions/:id/rejudge", requireSuperAdmin, async (c) => {
  const [row] = await db
    .select({ id: schema.submission.id, problemId: schema.submission.problemId })
    .from(schema.submission)
    .where(and(eq(schema.submission.id, c.req.param("id")), isNull(schema.submission.contestId)))
    .limit(1)
  if (!row) return failure(c, 404, "submission-not-found", "Submission does not exist")

  await db
    .update(schema.submission)
    .set({ statisticInfo: {}, result: JudgeStatus.PENDING })
    .where(eq(schema.submission.id, row.id))

  // jobId 必须带时间戳。队列保留最近 100 个已完成任务，沿用 submissionId 做 jobId 的话
  // BullMQ 会认为这个任务已经存在，重判静默变成空操作。与 flowcharts/:id/retry 同一处理。
  await judgeQueue.add(
    "judge",
    { submissionId: row.id, problemId: row.problemId },
    { jobId: `${row.id}:rejudge:${Date.now()}` },
  )
  return success(c, null)
})

submissionRoutes.post("/code/format", requireAuth, async (c) => {
  const parsed = formatCodeRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid format payload")
  try {
    const code = await formatCode(parsed.data.code, parsed.data.language)
    return success(c, formatCodeResponseSchema.parse({ code }))
  } catch (error) {
    if (error instanceof CodeFormatError) {
      return failure(c, error.kind === "syntax" ? 400 : 500, error.kind === "syntax" ? "format-error" : "format-tool-error", error.message)
    }
    throw error
  }
})

// 参数按「实际用到的字段」声明，而不是整行 $inferSelect：列表接口只 select 需要的列，
// 传不进完整行。完整行在结构上满足这两个窄类型，详情接口照旧调用不受影响。
function canViewSubmission(
  user: AuthUser | null,
  row: { userId: number; shared: boolean },
  problem: { createdById: number; shareSubmission: boolean },
  contest: typeof schema.contest.$inferSelect | null,
  allowShared = true,
) {
  if (!user) return false
  if (row.userId === user.id || isAdminRole(user) || problem.createdById === user.id) return true
  if (!allowShared) return false
  if (contest && contestStatus(contest) !== "-1") return false
  return problem.shareSubmission || row.shared
}

/**
 * 提交列表只取序列化用得到的列。取 `submission.*` / `problem.*` 会把
 * submission.code（学生源码）、info、ip 和 problem 的 description / input_description /
 * output_description / hint / samples / answers / flowchart_data / sql_display 一并拉回来，
 * 这些字段列表一个都不用，纯属白传。
 */
const submissionListColumns = {
  submission: {
    id: schema.submission.id,
    createTime: schema.submission.createTime,
    userId: schema.submission.userId,
    username: schema.submission.username,
    result: schema.submission.result,
    language: schema.submission.language,
    shared: schema.submission.shared,
    statisticInfo: schema.submission.statisticInfo,
  },
  problem: {
    displayId: schema.problem.displayId,
    title: schema.problem.title,
    shareSubmission: schema.problem.shareSubmission,
    createdById: schema.problem.createdById,
  },
} as const

async function submissionDetail(id: string, user: AuthUser) {
  const [row] = await db.select({ submission: schema.submission, problem: schema.problem, contest: schema.contest })
    .from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .leftJoin(schema.contest, eq(schema.submission.contestId, schema.contest.id))
    .where(eq(schema.submission.id, id)).limit(1)
  if (!row || !canViewSubmission(user, row.submission, row.problem, row.contest)) return null
  // info（含每个测试点的 test_case 编号与 output_md5）与 ip 只给管理员，对齐旧后端：
  // submission/views/oj.py 用 is_admin_role() 在 SubmissionModelSerializer 与
  // SubmissionSafeModelSerializer(exclude=("info", "contest", "ip")) 之间二选一，
  // 把关的是角色，不是「是不是自己的提交」。
  const full = isAdminRole(user)
  return submissionDetailSchema.parse({
    id: row.submission.id,
    createTime: row.submission.createTime,
    userId: row.submission.userId,
    username: row.submission.username,
    code: row.submission.code,
    result: row.submission.result,
    info: full ? row.submission.info : {},
    language: row.submission.language,
    shared: row.submission.shared,
    statisticInfo: objectValue(row.submission.statisticInfo),
    ip: full ? row.submission.ip : null,
    // contest 也在旧后端的排除名单里（exclude 的三个字段是 info / contest / ip），
    // 首轮修复只处理了 info 与 ip，这里补齐。
    contestId: full ? row.submission.contestId : null,
    problemId: row.submission.problemId,
    // problem 表本来就 join 了，不额外查库
    problemDisplayId: row.problem.displayId,
    showLink: true,
    canUnshare: canViewSubmission(user, row.submission, row.problem, row.contest, false),
  })
}

submissionRoutes.get("/submissions", optionalAuth, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const user = c.get("user")
  // 「非管理员即受限」，不能写成「是普通用户才受限」——
  // 后者对匿名用户（user 为 null）会短路，匿名反而能看到全部提交，权限大于登录学生。
  if (!(await getBooleanOption("submission_list_show_all", true)) && !isAdminRole(user)) {
    return success(c, submissionListSchema.parse({ results: [], total: 0 }))
  }
  const filters = [isNull(schema.submission.contestId)]
  const displayId = c.req.query("problemId")?.trim()
  const username = c.req.query("username")?.trim()
  const result = c.req.query("result")
  const language = c.req.query("language")?.trim()
  if (displayId) filters.push(sql`lower(${schema.problem.displayId}) = lower(${displayId})`)
  if (c.req.query("myself") === "1" && user) filters.push(eq(schema.submission.userId, user.id))
  else if (username) filters.push(ilike(schema.submission.username, `%${username}%`))
  if (result !== undefined && result !== "" && Number.isInteger(Number(result))) filters.push(eq(schema.submission.result, Number(result)))
  if (language) filters.push(eq(schema.submission.language, language))
  if (c.req.query("today") === "1") filters.push(sql`${schema.submission.createTime} >= ${todayStart()}`)
  const where = and(...filters)
  // count 不 join problem：problem 只有按题号筛选时才出现在 where 里，无条件 join 会让
  // 计划器把 count 退化成 seq scan（生产快照实测 7.5ms → 78ms）。
  const totalQuery = displayId
    ? db.select({ value: count() }).from(schema.submission)
        .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id)).where(where)
    : db.select({ value: count() }).from(schema.submission).where(where)
  const [totalRows, rows] = await Promise.all([
    totalQuery,
    db.select(submissionListColumns).from(schema.submission)
      .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id)).where(where)
      .orderBy(desc(schema.submission.createTime)).limit(limit).offset(offset),
  ])
  return success(c, submissionListSchema.parse({
    results: rows.map(({ submission, problem }) => submissionListItemSchema.parse({
      id: submission.id,
      problem: problem.displayId,
      problemTitle: problem.title,
      showLink: user ? canViewSubmission(user, submission, problem, null) : false,
      createTime: submission.createTime,
      userId: submission.userId,
      username: submission.username,
      result: submission.result,
      language: submission.language,
      shared: submission.shared,
      statisticInfo: objectValue(submission.statisticInfo),
    })),
    total: totalRows[0]?.value ?? 0,
  }))
})

submissionRoutes.get("/contests/:contestId/submissions", optionalAuth, requireContestAccess("submissions", "contestId"), async (c) => {
  const contest = c.get("contest")!
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const filters = [eq(schema.submission.contestId, contest.id)]
  const user = c.get("user")
  const displayId = c.req.query("problemId")?.trim()
  const username = c.req.query("username")?.trim()
  const result = c.req.query("result")
  if (displayId) filters.push(sql`lower(${schema.problem.displayId}) = lower(${displayId})`)
  if (c.req.query("myself") === "1" && user) filters.push(eq(schema.submission.userId, user.id))
  else if (username) filters.push(ilike(schema.submission.username, `%${username}%`))
  if (result !== undefined && result !== "" && Number.isInteger(Number(result))) filters.push(eq(schema.submission.result, Number(result)))
  if (contestStatus(contest) !== "1") filters.push(sql`${schema.submission.createTime} >= ${contest.startTime}`)
  const where = and(...filters)
  // count 不 join problem：problem 只有按题号筛选时才出现在 where 里，无条件 join 会让
  // 计划器把 count 退化成 seq scan（生产快照实测 7.5ms → 78ms）。
  const totalQuery = displayId
    ? db.select({ value: count() }).from(schema.submission)
        .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id)).where(where)
    : db.select({ value: count() }).from(schema.submission).where(where)
  const [totalRows, rows] = await Promise.all([
    totalQuery,
    db.select(submissionListColumns).from(schema.submission)
      .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id)).where(where)
      .orderBy(desc(schema.submission.createTime)).limit(limit).offset(offset),
  ])
  return success(c, submissionListSchema.parse({
    results: rows.map(({ submission, problem }) => submissionListItemSchema.parse({
      id: submission.id,
      problem: problem.displayId,
      problemTitle: problem.title,
      showLink: user ? canViewSubmission(user, submission, problem, contest) : false,
      createTime: submission.createTime,
      userId: submission.userId,
      username: submission.username,
      result: submission.result,
      language: submission.language,
      shared: submission.shared,
      statisticInfo: objectValue(submission.statisticInfo),
    })),
    total: totalRows[0]?.value ?? 0,
  }))
})

submissionRoutes.get("/submissions/:id", requireAuth, async (c) => {
  const user = c.get("user")!
  const data = await submissionDetail(c.req.param("id"), user)
  if (!data) {
    return failure(c, 404, "submission-not-found", "Submission does not exist")
  }
  return success(c, data)
})

submissionRoutes.put("/submissions/:id", requireAuth, async (c) => {
  const parsed = shareSubmissionRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid share payload")
  const [row] = await db.select({ submission: schema.submission, problem: schema.problem, contest: schema.contest })
    .from(schema.submission).innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .leftJoin(schema.contest, eq(schema.submission.contestId, schema.contest.id))
    .where(eq(schema.submission.id, c.req.param("id"))).limit(1)
  if (!row || !canViewSubmission(c.get("user")!, row.submission, row.problem, row.contest, false)) {
    return failure(c, 404, "submission-not-found", "Submission does not exist")
  }
  if (row.contest && contestStatus(row.contest) === "0") {
    return failure(c, 403, "contest-underway", "Can not share submission now")
  }
  await db.update(schema.submission).set({ shared: parsed.data.shared }).where(eq(schema.submission.id, row.submission.id))
  return success(c, null)
})

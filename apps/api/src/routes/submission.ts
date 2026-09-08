import { randomBytes } from "node:crypto"

import {
  createSubmissionRequestSchema,
  createSubmissionResponseSchema,
  formatCodeRequestSchema,
  formatCodeResponseSchema,
  submissionDetailSchema,
  submissionListItemSchema,
  submissionListSchema,
  submissionStatisticsItemsSchema,
  submissionStatisticsSchema,
} from "@oj2/contract"
import { and, count, desc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
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
import { JudgeStatus, UNJUDGED_RESULTS } from "../judge/status"
import { judgeQueue } from "../queue"
import {
  canAccessContest,
  contestStatus,
  findAccessibleContest,
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
    const contest = await findAccessibleContest(c.get("user"), parsed.data.contestId)
    if (!contest) return failure(c, 404, "contest-not-found", "Contest does not exist")
    const access = await canAccessContest(c, contest, "problems")
    if (!access.ok) return failure(c, access.code === "login-required" ? 401 : 403, access.code, access.message)
    if (contestStatus(contest) === "-1") return failure(c, 403, "contest-ended", "The contest has ended")
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

  // 来源题单：前端只在 /problemset/:id/problem/:pid 那个入口带上它，落库纯粹是为了
  // 在提交列表里标出「这条是刷题单刷出来的」。校验只确认这道题确实在那个题单里 ——
  // 不查 visible / status，因为藏起来的题单里还困着已加入的学生（他们照样在做题），
  // 也不查有没有加入：没加入照样能从题单页点进题目，标记来源不该比入口本身更严。
  // 对不上就当没带，提交照收：来源标记错了顶多列表少个标签，不值得挡下一次提交。
  let problemsetId: number | null = null
  if (contestId === null && parsed.data.problemSetId) {
    const [link] = await db.select({ id: schema.problemsetProblem.id })
      .from(schema.problemsetProblem)
      .where(and(
        eq(schema.problemsetProblem.problemsetId, parsed.data.problemSetId),
        eq(schema.problemsetProblem.problemId, problem.id),
      ))
      .limit(1)
    if (link) problemsetId = parsed.data.problemSetId
  }

  const user = c.get("user")!
  const submissionId = randomBytes(16).toString("hex")
  const createTime = new Date().toISOString()

  await db.insert(schema.submission).values({
    id: submissionId,
    problemId: problem.id,
    problemsetId,
    createTime,
    userId: user.id,
    username: user.username,
    code: parsed.data.code,
    result: JudgeStatus.PENDING,
    info: {},
    language: parsed.data.language,
    statisticInfo: {},
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

/** 正确率。分母是判完的条数，一条都还没判完时给 0 而不是 NaN */
function judgedRate(accepted: number, judged: number) {
  return judged > 0 ? rounded((accepted / judged) * 100) : 0
}

/**
 * 统计接口共用的时间窗解析。旧后端 `end` 必填、`start` 可选（不给就是「全部时段」）。
 */
function statisticsRange(c: { req: { query(name: string): string | undefined } }) {
  const end = c.req.query("end")?.trim()
  if (!end) return null
  const start = c.req.query("start")?.trim()
  return { start: start || null, end }
}

/** 一次最多查几道题。课堂上一节课布置三五道，20 是留足了余量的上限 */
const STATISTICS_MAX_PROBLEMS = 20

/**
 * 题号框允许一次填几道：`1001,1005,1010`。中英文逗号、空格、分号都当分隔符 ——
 * 老师在投影前手敲，不该因为打了个全角逗号就查不出来。
 */
function parseDisplayIds(raw: string) {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const part of raw.split(/[,，;；\s]+/)) {
    const id = part.trim()
    if (!id) continue
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(id)
  }
  return ids
}

/**
 * 按题号（展示用的 _id）定位公开题目。**有一个找不到就整体报错**，不退化成「全部题目」——
 * 否则教师打错一个字就会看到全站数据还以为是这几道题的。
 */
async function findPublicProblemsByDisplayIds(displayIds: string[]) {
  const lowered = displayIds.map((id) => id.toLowerCase())
  const rows = await db
    .select({ id: schema.problem.id, displayId: schema.problem.displayId })
    .from(schema.problem)
    .where(
      and(
        inArray(sql`lower(${schema.problem.displayId})`, lowered),
        isNull(schema.problem.contestId),
        eq(schema.problem.visible, true),
      ),
    )
  const found = new Set(rows.map((row) => row.displayId.toLowerCase()))
  const missing = displayIds.find((id) => !found.has(id.toLowerCase()))
  return { ids: rows.map((row) => row.id), missing: missing ?? null }
}

/**
 * 展开行一次只看一个人（表格的 updateExpandedRowKeys 只留最后一个 key），所以明细
 * **按需拉**，不再随统计一起下发。
 *
 * 原来是随 data 一起给所有人各带一份：生产快照实测，「全部时段 + 不填条件」要搬
 * 49108 行（最早那版不截断是 105631 行），而其中真正被人看到的最多一个人的那几十条。
 */
const STATISTICS_ITEMS_LIMIT = 200

/** 错误摘要截断长度。编译错误能刷几十行，弹层里放不下，也没必要 */
const FAILURE_MESSAGE_LIMIT = 400

/**
 * 「交了没对」那一栏点开要看的：这个人**最近一条**提交错在哪。
 *
 * 有了它，老师看到「张三 12次」之后不用再切到提交列表、翻到这个人、点开代码 ——
 * 点一下名字就知道是编译错了还是答案错了、报的什么。err_info 是判题机塞进
 * statistic_info 的那一段，提交详情页读的也是它。
 */
async function lastFailureByUser(where: SQL | undefined, usernames: string[]) {
  const byUser = new Map<
    string,
    { id: string; problem: string; result: number; error: string | null }
  >()
  if (!usernames.length) return byUser

  // 不给 submission 起别名：where 里的条件是 drizzle 拼的，引用的是 "submission"."x"
  const rows = await db.execute<{
    username: string
    id: string
    problem: string
    result: number
    error: string | null
  }>(sql`
    select username, id, problem, result, error from (
      select
        ${schema.submission.username} as username,
        ${schema.submission.id} as id,
        ${schema.problem.displayId} as problem,
        ${schema.submission.result} as result,
        left(${schema.submission.statisticInfo}->>'err_info', ${FAILURE_MESSAGE_LIMIT}) as error,
        row_number() over (
          partition by ${schema.submission.username}
          order by ${schema.submission.createTime} desc
        ) as rn
      from ${schema.submission}
      join ${schema.problem} on ${schema.problem.id} = ${schema.submission.problemId}
      where ${and(where, inArray(schema.submission.username, usernames))}
    ) t
    where rn = 1
  `)

  for (const row of rows) {
    byUser.set(row.username, {
      id: row.id,
      problem: row.problem,
      result: row.result,
      error: row.error,
    })
  }
  return byUser
}

/**
 * 「答案对了，但没按要求的语法写」的题数（AST_CHECK_FAILED）。
 *
 * 只算**最后也没改对**的：同一道题上既有 AST_CHECK_FAILED 又有 ACCEPTED，说明学生后来
 * 改成要求的写法了，不该再拿这个提醒老师。所以要先按「人 × 题」聚一层，不能直接
 * `count(distinct problem_id) filter (result = 10)`。
 *
 * 口径本身不动 —— AST_CHECK_FAILED 仍然算通过（答案确实对了，全站一致）。这里只是
 * 让教师看得见「这几个人是绕过要求做出来的」，教学上那不算达标。
 */
async function astOnlyByUser(where: SQL | undefined, usernames: string[]) {
  const byUser = new Map<string, number>()
  if (!usernames.length) return byUser

  const rows = await db.execute<{ username: string; n: number }>(sql`
    select username, count(*)::int as n from (
      select
        ${schema.submission.username} as username,
        bool_or(${schema.submission.result} = ${JudgeStatus.AST_CHECK_FAILED}) as has_ast,
        bool_or(${schema.submission.result} = ${JudgeStatus.ACCEPTED}) as has_ac
      from ${schema.submission}
      where ${and(where, inArray(schema.submission.username, usernames))}
      group by ${schema.submission.username}, ${schema.submission.problemId}
    ) t
    where has_ast and not has_ac
    group by username
  `)
  for (const row of rows) byUser.set(row.username, row.n)
  return byUser
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

/**
 * 两个统计接口共用的范围：时间窗 + 题号。**用户名不在里面** —— 统计那边是
 * ilike 模糊匹配（填 ks251 要匹配整个班），明细那边必须精确到人，口径不同。
 */
type StatisticsScope =
  | { ok: true; filters: SQL[]; problemCount: number }
  | { ok: false; status: 400 | 404; code: string; message: string }

async function statisticsScope(c: {
  req: { query(name: string): string | undefined }
}): Promise<StatisticsScope> {
  const range = statisticsRange(c)
  if (!range) {
    return { ok: false, status: 400, code: "invalid-request", message: "end is required" }
  }

  const filters = [
    isNull(schema.submission.contestId),
    sql`${schema.submission.createTime} <= ${range.end}`,
  ]
  if (range.start) filters.push(sql`${schema.submission.createTime} >= ${range.start}`)

  const displayIds = parseDisplayIds(c.req.query("problemId") ?? "")
  if (displayIds.length > STATISTICS_MAX_PROBLEMS) {
    return {
      ok: false,
      status: 400,
      code: "invalid-request",
      message: `At most ${STATISTICS_MAX_PROBLEMS} problems`,
    }
  }
  if (displayIds.length) {
    const { ids, missing } = await findPublicProblemsByDisplayIds(displayIds)
    if (missing) {
      return {
        ok: false,
        status: 404,
        code: "problem-not-found",
        message: `Problem ${missing} does not exist`,
      }
    }
    filters.push(inArray(schema.submission.problemId, ids))
  }

  return { ok: true, filters, problemCount: displayIds.length }
}

submissionRoutes.get("/submissions/statistics", requireTeacher, async (c) => {
  const scope = await statisticsScope(c)
  if (!scope.ok) return failure(c, scope.status, scope.code, scope.message)
  const filters = scope.filters

  const username = c.req.query("username")?.trim()
  if (username) filters.push(ilike(schema.submission.username, `%${username}%`))
  const where = and(...filters)

  const acceptedFilter = sql`count(*) filter (where ${inArray(schema.submission.result, ACCEPTED_RESULTS)})`
  // 判题中的条数。要单独数出来，正确率的分母才能把它们摘掉
  const judgingFilter = sql`count(*) filter (where ${inArray(schema.submission.result, UNJUDGED_RESULTS)})`
  /**
   * **解决的题数**，不是通过的提交条数。同一道题重复 AC（改完再交一次仍然对）
   * 在这里只算一道 —— 表格那一列叫「已解决」，数条数就名不副实了。
   * 指定了题号时它最多是 1，不指定时才看得出差别（老师查「这节课全班」就是这种）。
   */
  const solvedFilter = sql`count(distinct ${schema.submission.problemId}) filter (where ${inArray(schema.submission.result, ACCEPTED_RESULTS)})`

  const [[totals], perUser, rosterRows] = await Promise.all([
    db
      .select({
        total: count(),
        accepted: acceptedFilter.mapWith(Number),
        judging: judgingFilter.mapWith(Number),
      })
      .from(schema.submission)
      .where(where),
    db
      .select({
        username: schema.submission.username,
        submissionCount: count(),
        acceptedCount: acceptedFilter.mapWith(Number),
        solvedCount: solvedFilter.mapWith(Number),
        judgingCount: judgingFilter.mapWith(Number),
      })
      .from(schema.submission)
      .where(where)
      .groupBy(schema.submission.username)
      .orderBy(desc(count())),
    // 只有指定了用户名才有「班级人数」这个概念；不指定时分母无意义，旧后端也返回 0
    username ? matchedStudents(username) : Promise.resolve([]),
  ])

  const submissionCount = totals?.total ?? 0
  const acceptedCount = totals?.accepted ?? 0
  const judgingCount = totals?.judging ?? 0
  // 正确率的分母是**判完的条数**，不是总条数
  const judgedCount = submissionCount - judgingCount

  /**
   * 「做完了」的判定。**指定了几道题，就要几道都解决**（这是教师选的口径：
   * 「今天布置三道，谁全做完了」）—— 做出两道差一道的人落在「交了没全对」那一栏，
   * 那里带着 `solvedCount`，老师看得出他差几道。
   *
   * 只填一道题时 `solvedCount >= 1` 和原来的 `acceptedCount > 0` 完全等价；
   * 不填题号时无所谓「全部」，退回「至少做出一道」。
   */
  const requiredSolved = scope.problemCount
  const isDone = (row: { solvedCount: number; acceptedCount: number }) =>
    requiredSolved > 0 ? row.solvedCount >= requiredSolved : row.acceptedCount > 0

  // 表格列的是做完了的人。没做完的（一条没交 / 交了没全对）在「未完成」那一栏
  const acceptedUsers = perUser.filter(isDone)
  // 要等 acceptedUsers 定下来才能查，所以进不了上面那个 Promise.all
  const astOnlyByUserMap = await astOnlyByUser(
    where,
    acceptedUsers.map((row) => row.username),
  )

  const submittedUsernames = new Set(perUser.map((row) => row.username))
  const classNames = new Map<string, string | null>()
  if (submittedUsernames.size) {
    const rows = await db
      .select({ username: schema.user.username, className: schema.user.className })
      .from(schema.user)
      .where(inArray(schema.user.username, [...submittedUsernames]))
    for (const row of rows) classNames.set(row.username, row.className)
  }

  const data = acceptedUsers.map((row) => ({
    username: row.username,
    className: classNames.get(row.username) ?? null,
    submissionCount: row.submissionCount,
    acceptedCount: row.acceptedCount,
    solvedCount: row.solvedCount,
    astOnlyCount: astOnlyByUserMap.get(row.username) ?? 0,
    judgingCount: row.judgingCount,
    correctRate: judgedRate(row.acceptedCount, row.submissionCount - row.judgingCount),
  }))

  const dataUnaccepted = rosterRows
    .filter((row) => !submittedUsernames.has(row.username))
    .map((row) => ({
      username: row.username,
      realName: stripClassPrefix(row.username, row.className),
    }))

  // 交了但一次没对的。**按花名册取**，和 dataUnaccepted 同一个范围 ——
  // 不指定用户名时没有花名册，这一栏也就跟着为空，不会冒出一堆别的班的人。
  const rosterNames = new Map(rosterRows.map((row) => [row.username, row.className]))
  // 交了但没做完的：包括一道都没对的，也包括三道里做出两道的
  const attemptedRows = perUser.filter(
    (row) => !isDone(row) && rosterNames.has(row.username),
  )
  const failureByUser = await lastFailureByUser(
    where,
    attemptedRows.map((row) => row.username),
  )
  const dataAttempted = attemptedRows.map((row) => ({
    username: row.username,
    realName: stripClassPrefix(row.username, rosterNames.get(row.username) ?? null),
    submissionCount: row.submissionCount,
    solvedCount: row.solvedCount,
    lastFailure: failureByUser.get(row.username) ?? null,
  }))

  // 「学生已删号但提交记录还在」时完成人数会大于花名册人数，分母兜到完成人数为止。
  // 旧后端在这之前还先算了一个 person_rate 一起下发，前端从来没读过它（完成度是
  // 前端自己按「减掉请假人数之后的分母」重算的），所以这条链路上只留 person_count。
  let personCount = rosterRows.length
  if (personCount && personCount < data.length) personCount = data.length

  return success(
    c,
    submissionStatisticsSchema.parse({
      submissionCount,
      acceptedCount,
      judgingCount,
      correctRate: judgedRate(acceptedCount, judgedCount),
      personCount,
      data,
      dataUnaccepted,
      dataAttempted,
    }),
  )
})

/**
 * 统计面板展开一行时拉这个人的提交明细。
 *
 * 用户名这里是**精确匹配**，不是统计接口那种 ilike —— 那边填 `ks251` 要圈出整个班，
 * 这边是「点开的这一行是谁」。时间窗和题号沿用同一个 scope，不然展开行看到的
 * 会是另一个范围的数据。
 */
submissionRoutes.get("/submissions/statistics/items", requireTeacher, async (c) => {
  const username = c.req.query("username")?.trim()
  if (!username) return failure(c, 400, "invalid-request", "username is required")

  const scope = await statisticsScope(c)
  if (!scope.ok) return failure(c, scope.status, scope.code, scope.message)

  // 多取一条，好知道是不是被截断了
  const rows = await db
    .select({ id: schema.submission.id, result: schema.submission.result })
    .from(schema.submission)
    .where(and(...scope.filters, eq(schema.submission.username, username)))
    .orderBy(desc(schema.submission.createTime), desc(schema.submission.id))
    .limit(STATISTICS_ITEMS_LIMIT + 1)

  const truncated = rows.length > STATISTICS_ITEMS_LIMIT
  return success(
    c,
    submissionStatisticsItemsSchema.parse({
      items: rows.slice(0, STATISTICS_ITEMS_LIMIT),
      truncated,
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

/**
 * 题单防作弊闸门：查出这些题目里，哪些题的旧提交要对该用户藏起来，返回 problemId → 加入时间。
 *
 * 对齐旧后端 `submission/serializers.py:12` 的 `bulk_fetch_problemset_progress`。学生加入含
 * 某道题的题单后，他在加入之前留下的 AC 代码还摆在提交列表里，复制粘贴就能把题单刷完。
 * 备份快照里 1734 人次、188 名学生进过这个窗口（占已解题次的 22.5%），不是边角情况。
 *
 * 解锁的三条路全写在 where 里，任一成立就查不出来、也就不遮挡：
 *   - 已经在题单里做出这道题（progress_detail 里有这道题的 key）
 *   - 题单过了截止时间（end_time；为空表示不设期限，只能靠做出来解锁）
 *   - 题单被归档（status 不是 active）
 *
 * 一道题可能同时落在多个已加入的题单里，取最晚的 join_time——「存在任一题单要求遮挡就遮挡」
 * 等价于「提交时间早于最晚的那次加入」。旧后端这里用 `.first()` 取任意一条，一题多题单时
 * 行为不确定，换成聚合顺手定死。
 */
async function problemSetJoinTimes(userId: number, problemIds: number[]) {
  const joinTimes = new Map<number, string>()
  if (problemIds.length === 0) return joinTimes
  const rows = await db
    .select({
      problemId: schema.problemsetProblem.problemId,
      // ::text 是为了拿回和 mode:"string" 列同样形状的字符串——聚合表达式不走列的类型映射，
      // 不加这个 cast 驱动会把 timestamptz 解析成 Date，下游的 Date.parse 就接不住了
      joinTime: sql<string>`max(${schema.problemsetProgress.joinTime})::text`,
    })
    .from(schema.problemsetProgress)
    .innerJoin(schema.problemset, eq(schema.problemset.id, schema.problemsetProgress.problemsetId))
    .innerJoin(schema.problemsetProblem, eq(schema.problemsetProblem.problemsetId, schema.problemset.id))
    .where(and(
      eq(schema.problemsetProgress.userId, userId),
      inArray(schema.problemsetProblem.problemId, problemIds),
      eq(schema.problemset.status, "active"),
      or(isNull(schema.problemset.endTime), gt(schema.problemset.endTime, sql`now()`)),
      sql`not jsonb_exists(${schema.problemsetProgress.progressDetail}, ${schema.problemsetProblem.problemId}::text)`,
    ))
    .groupBy(schema.problemsetProblem.problemId)
  for (const row of rows) joinTimes.set(row.problemId, row.joinTime)
  return joinTimes
}

// 参数按「实际用到的字段」声明，而不是整行 $inferSelect：列表接口只 select 需要的列，
// 传不进完整行。完整行在结构上满足这两个窄类型，详情接口照旧调用不受影响。
function canViewSubmission(
  user: AuthUser | null,
  row: { userId: number; problemId: number; createTime: string },
  problem: { createdById: number },
  contest: typeof schema.contest.$inferSelect | null,
  problemSetJoinTime?: Map<number, string>,
) {
  if (!user) return false
  // 题单防作弊，见 problemSetJoinTimes。只对学生自己的提交生效，管理员不受限，对齐旧后端
  // `get_show_link` 里的 `obj.user_id == self.user.id and self.user.is_regular_user()`。
  if (row.userId === user.id && !isAdminRole(user)) {
    const joinTime = problemSetJoinTime?.get(row.problemId)
    if (joinTime !== undefined && Date.parse(row.createTime) < Date.parse(joinTime)) return false
  }
  // 比赛没结束时，学生管理员不吃「管理员看得到所有人代码」这条捷径：他自己也在排行榜里
  // （contest.ts 的 rank 把 Student Admin 算作参赛者），既参赛又能读别人的提交就是开卷。
  // 老师和超管不受影响 —— 他们不参赛。旧后端这里是 `not user.is_regular_user()`，
  // 学生管理员同样放行，所以这条是 OJ2 相对旧栈**收紧**的一处，不是修回归。
  //
  // 只掐角色捷径，不掐 `problem.createdById === user.id`：那是这道题的作者本人，
  // 他早就知道答案了，挡他没有意义。
  const elevated = isAdminRole(user)
    && !(contest && contestStatus(contest) !== "-1" && user.adminType === "Student Admin")
  // 这三条就是全部：别人的代码谁都看不到，比赛内外一样。
  // 分享功能（problem.share_submission 题目级 / submission.shared 单条）已经删掉，
  // 原来结尾的 `return problem.shareSubmission || row.shared` 随之消失；它上面那条
  // 「比赛未结束一律不给」也一并去掉 —— 走到那里的必然不是本人/管理员/作者，
  // 现在无论比赛与否都是 false，留着是重复的。
  return row.userId === user.id || elevated || problem.createdById === user.id
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
    // 题单闸门要按题定位，序列化本身用不到它
    problemId: schema.submission.problemId,
    username: schema.submission.username,
    result: schema.submission.result,
    language: schema.submission.language,
    statisticInfo: schema.submission.statisticInfo,
    // 只取 id，题单标题按页单独查一次（见 /submissions）——把 problemset 一起 join 进来
    // 会动到下面那条调过的分页查询，而每页最多两三个不同的题单，PK 查一次更便宜
    problemsetId: schema.submission.problemsetId,
  },
  problem: {
    displayId: schema.problem.displayId,
    title: schema.problem.title,
    createdById: schema.problem.createdById,
  },
} as const

async function submissionDetail(id: string, user: AuthUser) {
  const [row] = await db.select({ submission: schema.submission, problem: schema.problem, contest: schema.contest })
    .from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .leftJoin(schema.contest, eq(schema.submission.contestId, schema.contest.id))
    .where(eq(schema.submission.id, id)).limit(1)
  if (!row) return null
  // 详情也要过闸门。旧后端只挡了列表里的链接，`SubmissionAPI.get`（views/oj.py:103）
  // 光走 check_user_permission——知道 submission id 直接访问照样拿得到代码，遮挡是虚的。
  const joinTimes = isAdminRole(user) || row.submission.userId !== user.id
    ? undefined
    : await problemSetJoinTimes(user.id, [row.submission.problemId])
  if (!canViewSubmission(user, row.submission, row.problem, row.contest, joinTimes)) return null
  // info（含每个测试点的 test_case 编号与 output_md5）只给管理员，对齐旧后端：
  // submission/views/oj.py 用 is_admin_role() 在 SubmissionModelSerializer 与
  // SubmissionSafeModelSerializer 之间二选一，把关的是角色，不是「是不是自己的提交」。
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
    statisticInfo: objectValue(row.submission.statisticInfo),
    // contest 也在旧后端的排除名单里，同样只给管理员
    contestId: full ? row.submission.contestId : null,
    problemId: row.submission.problemId,
    // problem 表本来就 join 了，不额外查库
    problemDisplayId: row.problem.displayId,
    showLink: true,
  })
}

/**
 * 提交列表取数据。深翻页不走 `LIMIT n OFFSET m`——Postgres 对 OFFSET 没有捷径，前 m 行
 * 必须真的产出再丢掉，而丢弃发生在 join 之后，每一行都白回了一次表。生产快照（10.4 万条
 * 公开提交）上最后一页实测 1258ms、碰了 95347 个 buffer。而且越早的页越慢：平时没人翻，
 * 那些数据页从来不在 shared_buffers 里，全是冷读。
 *
 * 拆成两步就便宜得多：
 *   1. 只 select create_time / id —— 正好是 submission_public_create_time_id_idx 的两列，
 *      跳过 m 行走 Index Only Scan，Heap Fetches 为 0，纯在索引页里数数；
 *   2. 拿这一行当游标做 keyset 回查，只回表取 limit 行。
 * 同一页实测降到约 9ms、885 个 buffer。代价变成 O(m) 个**索引条目**而不是堆页，按快照里
 * 的索引密度外推，涨到 100 万条时最深一页仍在几十毫秒量级。
 *
 * 排序必须带 id：create_time 只有毫秒精度（`new Date().toISOString()`），光靠它不是全序，
 * 游标用 `<=` 回查时同毫秒的上一页末行会重复出现在下一页页首。索引已按 (create_time DESC,
 * id DESC) 建好，带上 id 不会多出 Sort 节点。
 *
 * 两种情况退回普通 offset：offset 为 0 时没有可跳过的行，白搭一次往返；按题号筛选时条件
 * 在 problem 表上，第一步得跟着 join、index-only 就没了——而那时结果集只剩几百条，
 * offset 本来也不慢。
 */
async function paginateSubmissionRows(
  where: SQL | undefined,
  limit: number,
  offset: number,
  filtersNeedProblem: boolean,
) {
  const order = [desc(schema.submission.createTime), desc(schema.submission.id)] as const
  const page = (cursor?: SQL) =>
    db
      .select(submissionListColumns)
      .from(schema.submission)
      .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
      .where(cursor ? and(where, cursor) : where)
      .orderBy(...order)

  if (offset === 0 || filtersNeedProblem) return page().limit(limit).offset(offset)

  const [boundary] = await db
    .select({ createTime: schema.submission.createTime, id: schema.submission.id })
    .from(schema.submission)
    .where(where)
    .orderBy(...order)
    .limit(1)
    .offset(offset)
  // offset 越过了结果集尾巴，这一页本来就该是空的
  if (!boundary) return []

  return page(
    sql`(${schema.submission.createTime}, ${schema.submission.id}) <= (${boundary.createTime}::timestamptz, ${boundary.id}::text)`,
  ).limit(limit)
}

/**
 * 这一页里出现过的来源题单，id → 标题。传进来的数组允许带 null 和重复值。
 * 一页最多 250 行、实际能落到的题单数是个位数，按主键 IN 查一次就完了。
 */
async function problemsetTitleMap(ids: Array<number | null>) {
  const unique = [...new Set(ids.filter((id): id is number => id !== null))]
  if (unique.length === 0) return new Map<number, string>()
  const rows = await db.select({ id: schema.problemset.id, title: schema.problemset.title })
    .from(schema.problemset)
    .where(inArray(schema.problemset.id, unique))
  return new Map(rows.map((row) => [row.id, row.title]))
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
    paginateSubmissionRows(where, limit, offset, Boolean(displayId)),
  ])
  // 闸门只对学生自己的提交生效，所以只拿这一页里属于他自己的题目去查，一页一次查询
  const [joinTimes, problemsetTitles] = await Promise.all([
    user && !isAdminRole(user)
      ? problemSetJoinTimes(user.id, [...new Set(
          rows.filter((row) => row.submission.userId === user.id).map((row) => row.submission.problemId),
        )])
      : undefined,
    // 来源题单的标题。一页里不同题单最多几个，按主键查一次就够
    problemsetTitleMap(rows.map((row) => row.submission.problemsetId)),
  ])
  return success(c, submissionListSchema.parse({
    results: rows.map(({ submission, problem }) => submissionListItemSchema.parse({
      id: submission.id,
      problem: problem.displayId,
      problemTitle: problem.title,
      showLink: user ? canViewSubmission(user, submission, problem, null, joinTimes) : false,
      createTime: submission.createTime,
      userId: submission.userId,
      username: submission.username,
      result: submission.result,
      language: submission.language,
      statisticInfo: objectValue(submission.statisticInfo),
      // 题单被删掉之后外键把 problemset_id 置了空，这里自然就没标记了
      problemSet: submission.problemsetId !== null && problemsetTitles.has(submission.problemsetId)
        ? { id: submission.problemsetId, title: problemsetTitles.get(submission.problemsetId)! }
        : null,
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
  // 这里不挂题单防作弊闸门（对比公开列表）：题单里的题必定是非比赛题——加题时卡了
  // `isNull(problem.contestId)`（admin/problemset.ts:232）——而这条列表只出比赛提交，
  // 两边交集恒空，挂上去就是每页白跑一次查询，而比赛进行中这条列表是被刷得最狠的。
  // 旧后端 ContestSubmissionListAPI 照抄了 bulk_fetch，那边同样是死代码。
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
      statisticInfo: objectValue(submission.statisticInfo),
      // 比赛提交没有来源题单：题单只收非比赛题（admin/problemset.ts 加题时卡了
      // isNull(problem.contestId)），提交接口那边也只在 contestId 为空时才认这个字段
      problemSet: null,
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

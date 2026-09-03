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
  const ip = requestIp(c)

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
  row: { userId: number; shared: boolean; problemId: number; createTime: string },
  problem: { createdById: number; shareSubmission: boolean },
  contest: typeof schema.contest.$inferSelect | null,
  allowShared = true,
  problemSetJoinTime?: Map<number, string>,
) {
  if (!user) return false
  // 题单防作弊，见 problemSetJoinTimes。只对学生自己的提交生效，管理员不受限，对齐旧后端
  // `get_show_link` 里的 `obj.user_id == self.user.id and self.user.is_regular_user()`。
  //
  // 只挡「看代码」这一路，不挡 allowShared=false 的那一路：后者是分享/取消分享的归属校验，
  // 与作弊无关，挡了会让学生连自己旧提交的分享开关都动不了。
  if (allowShared && row.userId === user.id && !isAdminRole(user)) {
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
  if (row.userId === user.id || elevated || problem.createdById === user.id) return true
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
    // 题单闸门要按题定位，序列化本身用不到它
    problemId: schema.submission.problemId,
    username: schema.submission.username,
    result: schema.submission.result,
    language: schema.submission.language,
    shared: schema.submission.shared,
    statisticInfo: schema.submission.statisticInfo,
    // 只取 id，题单标题按页单独查一次（见 /submissions）——把 problemset 一起 join 进来
    // 会动到下面那条调过的分页查询，而每页最多两三个不同的题单，PK 查一次更便宜
    problemsetId: schema.submission.problemsetId,
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
  if (!row) return null
  // 详情也要过闸门。旧后端只挡了列表里的链接，`SubmissionAPI.get`（views/oj.py:103）
  // 光走 check_user_permission——知道 submission id 直接访问照样拿得到代码，遮挡是虚的。
  const joinTimes = isAdminRole(user) || row.submission.userId !== user.id
    ? undefined
    : await problemSetJoinTimes(user.id, [row.submission.problemId])
  if (!canViewSubmission(user, row.submission, row.problem, row.contest, true, joinTimes)) return null
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
      showLink: user ? canViewSubmission(user, submission, problem, null, true, joinTimes) : false,
      createTime: submission.createTime,
      userId: submission.userId,
      username: submission.username,
      result: submission.result,
      language: submission.language,
      shared: submission.shared,
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
      shared: submission.shared,
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

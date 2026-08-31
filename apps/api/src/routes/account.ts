import { randomBytes } from "node:crypto"
import { extname, resolve } from "node:path"

import {
  activityRankItemSchema,
  metricsSchema,
  problemRankSchema,
  myRankSchema,
  rankProfileSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  userRankSchema,
} from "@oj2/contract"
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  min,
  or,
  sql,
} from "drizzle-orm"
import { Hono } from "hono"

import { hashPassword } from "../auth/password"
import { optionalAuth, requireAuth, type AppEnv } from "../auth/middleware"
import { config } from "../config"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { getBooleanOption } from "../services/options"
import { getUserProfileById } from "../services/profile"
import { objectValue, queryInteger, sampleUser } from "./helpers"

export const accountRoutes = new Hono<AppEnv>()

accountRoutes.post("/users", async (c) => {
  const parsed = registerRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid registration payload")
  if (!(await getBooleanOption("allow_register", true))) {
    return failure(c, 403, "registration-disabled", "Register function has been disabled by admin")
  }

  const username = parsed.data.username.toLowerCase()
  const email = parsed.data.email.toLowerCase()
  const [duplicate] = await db
    .select({ username: schema.user.username, email: schema.user.email })
    .from(schema.user)
    .where(or(sql`lower(${schema.user.username}) = ${username}`, sql`lower(${schema.user.email}) = ${email}`))
    .limit(1)
  if (duplicate?.username.toLowerCase() === username) {
    return failure(c, 409, "username-exists", "Username already exists")
  }
  if (duplicate?.email?.toLowerCase() === email) {
    return failure(c, 409, "email-exists", "Email already exists")
  }

  const now = new Date().toISOString()
  const password = await hashPassword(parsed.data.password)
  await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.user).values({
      username,
      email,
      password,
      rawPassword: parsed.data.password.slice(0, 20),
      lastLogin: null,
      createTime: now,
      adminType: "Regular User",
      authToken: null,
      openApi: false,
      openApiAppkey: null,
      isDisabled: false,
      problemPermission: "None",
      sessionKeys: [],
      className: null,
    }).returning({ id: schema.user.id })
    if (!created) throw new Error("User insert did not return an id")
    await tx.insert(schema.userProfile).values({
      userId: created.id,
      acmProblemsStatus: {},
      avatar: `${config.avatarUriPrefix}/default.png`,
      mood: null,
      acceptedNumber: 0,
      submissionNumber: 0,
      realName: null,
    })
  })
  return success(c, { ok: true }, 201)
})

accountRoutes.get("/profiles/:username", optionalAuth, async (c) => {
  // 对齐旧后端 account/views/oj.py 的 UserProfileAPI.get 首行：
  // `if not user.is_authenticated: return self.success()` —— 匿名一律返回空，
  // 否则用户名可经 /rankings/users 公开枚举，进而无 cookie 批量收集全校学生的邮箱与最后登录时间。
  if (!c.get("user")) return success(c, null)
  const [target] = await db.select({ id: schema.user.id }).from(schema.user)
    .where(and(sql`lower(${schema.user.username}) = lower(${c.req.param("username")})`, eq(schema.user.isDisabled, false))).limit(1)
  if (!target) return failure(c, 404, "user-not-found", "User does not exist")
  const profile = await getUserProfileById(target.id, c.get("user")?.id === target.id)
  if (!profile) return failure(c, 404, "profile-not-found", "User profile does not exist")
  return success(c, profile)
})

accountRoutes.put("/me/profile", requireAuth, async (c) => {
  const parsed = updateProfileRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid profile payload")
  const values = Object.fromEntries(
    Object.entries(parsed.data).map(([key, value]) => [key, value === "" ? null : value]),
  )
  await db.update(schema.userProfile).set(values).where(eq(schema.userProfile.userId, c.get("user")!.id))
  const profile = await getUserProfileById(c.get("user")!.id, true)
  if (!profile) return failure(c, 404, "profile-not-found", "User profile does not exist")
  return success(c, profile)
})

accountRoutes.post("/me/avatar", requireAuth, async (c) => {
  const body: Record<string, string | File> = await c.req.parseBody().catch(() => ({}))
  const image = body.image
  if (!(image instanceof File)) return failure(c, 400, "invalid-file", "Invalid file content")
  if (image.size > 2 * 1024 * 1024) return failure(c, 400, "file-too-large", "Picture is too large")
  const extension = extname(image.name).toLowerCase()
  if (![".gif", ".jpg", ".jpeg", ".bmp", ".png"].includes(extension)) {
    return failure(c, 400, "unsupported-file", "Unsupported file format")
  }
  const filename = `${randomBytes(10).toString("hex")}${extension}`
  const directory = resolve(config.avatarDirectory)
  await Bun.$`mkdir -p ${directory}`.quiet()
  await Bun.write(resolve(directory, filename), image)
  const avatar = `${config.avatarUriPrefix}/${filename}`
  await db.update(schema.userProfile).set({ avatar }).where(eq(schema.userProfile.userId, c.get("user")!.id))
  return success(c, { avatar })
})

accountRoutes.get("/users/:id/metrics", async (c) => {
  const userId = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [row] = await db.select({ total: count(), first: min(schema.submission.createTime), latest: sql<string>`max(${schema.submission.createTime})` })
    .from(schema.submission)
    .where(and(eq(schema.submission.userId, userId), isNull(schema.submission.contestId)))
  if (!row?.total || !row.first || !row.latest) return failure(c, 404, "no-submissions", "暂无提交")
  return success(c, metricsSchema.parse({ now: new Date().toISOString(), first: row.first, latest: row.latest }))
})

/**
 * 全服榜单的大小。**写死在服务端，不接受调用方传** —— 上限是这个端点的属性，
 * 不是调用方的选择。
 *
 * 之前它是个 `top` 查询参数，三个调用方各传各的（100 / 10 / 0），
 * 而 top 又会覆盖 limit 与 offset，total 却按全量人数算 —— 于是分页器算出几十页、
 * 页页内容相同（36e4ac2）。「全服 Top10」不需要另一个上限，取 limit=10&offset=0 即可；
 * 后台那个「不限量」的用法搬去了 /admin/rankings/users。
 */
const LEADERBOARD_SIZE = 100

/** 入榜人群：正常状态的学生与学生管理员。教师和超管不参与排名。 */
const leaderboardWhere = and(
  inArray(schema.user.adminType, ["Regular User", "Student Admin"]),
  eq(schema.user.isDisabled, false),
)

/**
 * 榜单排序：AC 多的在前 → 同 AC 时提交少的在前 → 再同就按 id。
 *
 * 第三档不是凑数：前两个键完全相同的学生在真实数据里成片存在（都是 0/0），
 * 没有稳定的兜底键时 postgres 每次返回的顺序可以不同，翻页会看到重复或漏掉的人。
 */
const leaderboardOrder = [
  desc(schema.userProfile.acceptedNumber),
  asc(schema.userProfile.submissionNumber),
  asc(schema.user.id),
]

accountRoutes.get("/rankings/users", optionalAuth, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: LEADERBOARD_SIZE })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })

  // 榜单封顶 100 名，所以这一页最多还能取几条只取决于 offset，**不取决于总人数** ——
  // 真人不够时数据库自己会少返回。不拿 total 当上限，三段查询就能并发发出去，
  // 端点延迟从「四个来回相加」变成「最慢的那个」。越界页一条不剩，直接不发 SQL。
  const pageLimit = Math.max(0, Math.min(limit, LEADERBOARD_SIZE - offset))

  const [totalRow, rows, me] = await Promise.all([
    db.select({ value: count() }).from(schema.userProfile)
      .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id))
      .where(leaderboardWhere).then(([row]) => row),
    pageLimit === 0 ? [] : db
      .select({ profile: schema.userProfile, user: schema.user }).from(schema.userProfile)
      .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id))
      .where(leaderboardWhere).orderBy(...leaderboardOrder)
      .limit(pageLimit).offset(offset),
    myLeaderboardRank(c.get("user")?.id),
  ])

  return success(c, userRankSchema.parse({
    results: rows.map(serializeRankRow),
    total: Math.min(totalRow?.value ?? 0, LEADERBOARD_SIZE),
    me,
  }))
})

function serializeRankRow({ profile, user }: {
  profile: typeof schema.userProfile.$inferSelect
  user: typeof schema.user.$inferSelect
}) {
  return rankProfileSchema.parse({
    id: profile.id,
    user: sampleUser(user, profile.realName),
    acceptedNumber: profile.acceptedNumber,
    submissionNumber: profile.submissionNumber,
    mood: profile.mood,
  })
}

/**
 * 「我」的全服名次，登录且身份入榜时才有。
 *
 * 名次 = 排在我前面的人数 + 1，三个排序键**逐级**比较，与列表的 orderBy 逐字对应 ——
 * 少比一级就会出现「显示第 7 名、实际排在表格第 9 行」这种对不上的情况。
 * 三个键全等才算并列，此时名次相同。
 */
async function myLeaderboardRank(userId: number | undefined) {
  if (!userId) return null
  const [mine] = await db
    .select({ profile: schema.userProfile, user: schema.user }).from(schema.userProfile)
    .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id))
    .where(and(leaderboardWhere, eq(schema.user.id, userId))).limit(1)
  if (!mine) return null

  const { acceptedNumber, submissionNumber } = mine.profile
  const [ahead] = await db.select({ value: count() }).from(schema.userProfile)
    .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id))
    .where(and(leaderboardWhere, or(
      gt(schema.userProfile.acceptedNumber, acceptedNumber),
      and(
        eq(schema.userProfile.acceptedNumber, acceptedNumber),
        lt(schema.userProfile.submissionNumber, submissionNumber),
      ),
      and(
        eq(schema.userProfile.acceptedNumber, acceptedNumber),
        eq(schema.userProfile.submissionNumber, submissionNumber),
        lt(schema.user.id, userId),
      ),
    )))

  return myRankSchema.parse({
    ...serializeRankRow(mine),
    rank: (ahead?.value ?? 0) + 1,
  })
}

accountRoutes.get("/rankings/activity", async (c) => {
  const start = c.req.query("start")
  if (!start || Number.isNaN(Date.parse(start))) return failure(c, 400, "invalid-start", "start time is required")
  const rows = await db.select({ username: schema.submission.username, value: countDistinct(schema.submission.problemId) })
    .from(schema.submission)
    .innerJoin(schema.user, eq(schema.submission.userId, schema.user.id))
    .where(and(
      isNull(schema.submission.contestId),
      gte(schema.submission.createTime, start),
      inArray(schema.submission.result, [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]),
      eq(schema.user.isDisabled, false),
      sql`${schema.user.adminType} <> 'Super Admin'`,
    ))
    .groupBy(schema.submission.username).orderBy(desc(countDistinct(schema.submission.problemId))).limit(10)
  return success(c, rows.map((row) => activityRankItemSchema.parse({ username: row.username, count: row.value })))
})

accountRoutes.get("/problems/:displayId/rank", requireAuth, async (c) => {
  const user = c.get("user")!
  const [problem] = await db.select({ id: schema.problem.id }).from(schema.problem)
    .where(and(sql`lower(${schema.problem.displayId}) = lower(${c.req.param("displayId")})`, isNull(schema.problem.contestId), eq(schema.problem.visible, true))).limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  const accepted = and(eq(schema.submission.problemId, problem.id), inArray(schema.submission.result, [0, 10]))
  const [all] = await db.select({ value: countDistinct(schema.submission.userId) }).from(schema.submission).where(accepted)
  const className = user.className ?? ""
  const classWhere = className
    ? and(accepted, inArray(schema.submission.userId, db.select({ id: schema.user.id }).from(schema.user).where(and(eq(schema.user.className, className), eq(schema.user.isDisabled, false)))))
    : accepted
  const [classCount] = className
    ? await db.select({ value: countDistinct(schema.submission.userId) }).from(schema.submission).where(classWhere)
    : [{ value: 0 }]
  const [first] = await db.select({ value: min(schema.submission.createTime) }).from(schema.submission)
    .where(and(classWhere, eq(schema.submission.userId, user.id)))
  let rank = -1
  if (first?.value) {
    const [rankRow] = await db.select({ value: count() }).from(schema.submission).where(and(classWhere, lte(schema.submission.createTime, first.value)))
    rank = rankRow?.value ?? -1
  }
  return success(c, problemRankSchema.parse({ className, rank, classAcCount: classCount?.value ?? 0, allAcCount: all?.value ?? 0 }))
})

/**
 * 把 `user_profile.acm_problems_status` 里缓存的题目编号刷成当前值 ——
 * 教师改了题目的 `_id`（后台「修改题目编号」）之后，学生个人主页上的那份缓存会变旧。
 *
 * **目前没有任何前端在调用它**，两代前端都只定义了函数、没有调用点。保留是因为
 * 它是唯一能修这份缓存的入口；要接 UI 的话，从这里开始。
 *
 * 旧后端 `ProfileProblemDisplayIDRefreshAPI` 这段是坏的：它用
 * `dict(zip(ids, display_ids))` 把「dict 键顺序」和「查询返回顺序」硬凑成对，
 * 题目一旦被隐藏或删除，display_ids 就比 ids 短 —— 轻则把编号张冠李戴写进库，
 * 重则 `id_map[k]` KeyError。这里改成按 id 建 Map、查不到就不动。
 */
accountRoutes.post("/me/problem-display-ids/refresh", requireAuth, async (c) => {
  const user = c.get("user")!
  const [profile] = await db.select({ value: schema.userProfile.acmProblemsStatus }).from(schema.userProfile)
    .where(eq(schema.userProfile.userId, user.id)).limit(1)
  const status = objectValue(profile?.value)
  const problems = objectValue(status.problems)
  const ids = Object.keys(problems).map(Number).filter(Number.isInteger)
  if (ids.length > 0) {
    const rows = await db.select({ id: schema.problem.id, displayId: schema.problem.displayId }).from(schema.problem)
      .where(and(inArray(schema.problem.id, ids), eq(schema.problem.visible, true)))
    const displayIds = new Map(rows.map((row) => [String(row.id), row.displayId]))
    for (const [id, value] of Object.entries(problems)) {
      const item = objectValue(value)
      const displayId = displayIds.get(id)
      if (displayId) item._id = displayId
      problems[id] = item
    }
    status.problems = problems
    await db.update(schema.userProfile).set({ acmProblemsStatus: status }).where(eq(schema.userProfile.userId, user.id))
  }
  return success(c, null)
})

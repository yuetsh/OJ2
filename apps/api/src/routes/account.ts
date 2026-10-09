import { randomBytes } from "node:crypto"
import { resolve } from "node:path"

import {
  registerRequestSchema,
  STUDENT_ROLES,
  updateProfileRequestSchema,
  type KnowledgeLevel,
  type KnowledgeMap,
  type Metrics,
  type ProblemRank,
  type WeeklyRank,
  type WeeklyRankItem,
} from "@oj2/contract"
import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  max,
  min,
  notExists,
  or,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Hono } from "hono"

import { hashPassword } from "../auth/password"
import { optionalAuth, requireAuth, type AppEnv } from "../auth/middleware"
import { config } from "../config"
import { db, schema } from "../db"
import { failure, parseBody, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { getBooleanOption } from "../services/options"
import { sniffImageExtension } from "../services/image"
import { getUserProfileById } from "../services/profile"
import { clientIp, countAttempt, lockoutRemaining, type AttemptRule } from "../services/throttling"
import { localTime, weekStart } from "../time"
import { asRecord, queryInteger, sampleUser } from "./helpers"

export const accountRoutes = new Hono<AppEnv>()

/**
 * 注册限流：按 IP 每小时 100 个号，只数成功的。拦的是脚本批量造号；
 * 机房一个班共用一个出口 IP，一节课全班现场注册也够用。
 */
const REGISTER_PER_IP: AttemptRule = { limit: 100, windowSeconds: 60 * 60 }

accountRoutes.post("/users", async (c) => {
  const parsed = await parseBody(c, registerRequestSchema, "Invalid registration payload")
  if (!parsed.success) return parsed.response
  if (!(await getBooleanOption("allow_register", true))) {
    return failure(c, 403, "registration-disabled", "Register function has been disabled by admin")
  }

  const registerKey = `register:ip:${clientIp(c)}`
  const wait = await lockoutRemaining(registerKey, REGISTER_PER_IP)
  if (wait !== null) {
    return failure(
      c,
      429,
      "too-many-registrations",
      `Too many registrations, please wait ${wait} seconds`,
    )
  }

  const username = parsed.data.username.toLowerCase()
  const email = parsed.data.email.toLowerCase()
  const [duplicate] = await db
    .select({ username: schema.user.username, email: schema.user.email })
    .from(schema.user)
    .where(
      or(
        sql`lower(${schema.user.username}) = ${username}`,
        sql`lower(${schema.user.email}) = ${email}`,
      ),
    )
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
    const [created] = await tx
      .insert(schema.user)
      .values({
        username,
        email,
        password,
        rawPassword: parsed.data.password.slice(0, 20),
        lastLogin: null,
        createTime: now,
        adminType: "Regular User",
        isDisabled: false,
        problemPermission: "None",
        className: null,
      })
      .returning({ id: schema.user.id })
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
  await countAttempt(registerKey, REGISTER_PER_IP)
  return success(c, { ok: true }, 201)
})

accountRoutes.get("/profiles/:username", optionalAuth, async (c) => {
  // 对齐旧后端 account/views/oj.py 的 UserProfileAPI.get 首行：
  // `if not user.is_authenticated: return self.success()` —— 匿名一律返回空，
  // 否则用户名可经排名接口（/rankings/board）公开枚举，进而无 cookie 批量收集全校学生的邮箱与最后登录时间。
  if (!c.get("user")) return success(c, null)
  const [target] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(
      and(
        sql`lower(${schema.user.username}) = lower(${c.req.param("username")})`,
        eq(schema.user.isDisabled, false),
      ),
    )
    .limit(1)
  if (!target) return failure(c, 404, "user-not-found", "User does not exist")
  const profile = await getUserProfileById(target.id, c.get("user")?.id === target.id)
  if (!profile) return failure(c, 404, "profile-not-found", "User profile does not exist")
  return success(c, profile)
})

accountRoutes.put("/me/profile", requireAuth, async (c) => {
  const parsed = await parseBody(c, updateProfileRequestSchema, "Invalid profile payload")
  if (!parsed.success) return parsed.response
  const values = Object.fromEntries(
    Object.entries(parsed.data).map(([key, value]) => [key, value === "" ? null : value]),
  )
  await db
    .update(schema.userProfile)
    .set(values)
    .where(eq(schema.userProfile.userId, c.get("user")!.id))
  const profile = await getUserProfileById(c.get("user")!.id, true)
  if (!profile) return failure(c, 404, "profile-not-found", "User profile does not exist")
  return success(c, profile)
})

accountRoutes.post("/me/avatar", requireAuth, async (c) => {
  const body: Record<string, string | File> = await c.req.parseBody().catch(() => ({}))
  const image = body.image
  if (!(image instanceof File)) return failure(c, 400, "invalid-file", "Invalid file content")
  if (image.size > 2 * 1024 * 1024) return failure(c, 400, "file-too-large", "Picture is too large")
  const extension = await sniffImageExtension(image)
  if (!extension) {
    return failure(c, 400, "unsupported-file", "Unsupported file format")
  }
  const filename = `${randomBytes(10).toString("hex")}${extension}`
  const directory = resolve(config.avatarDirectory)
  await Bun.$`mkdir -p ${directory}`.quiet()
  await Bun.write(resolve(directory, filename), image)
  const avatar = `${config.avatarUriPrefix}/${filename}`
  await db
    .update(schema.userProfile)
    .set({ avatar })
    .where(eq(schema.userProfile.userId, c.get("user")!.id))
  return success(c, { avatar })
})

accountRoutes.get("/users/:id/metrics", async (c) => {
  const userId = queryInteger(c.req.param("id"), 0, { min: 1 })
  // 比赛提交也算：首末提交时间、学习天数都连比赛一起统计
  const [row] = await db
    .select({
      first: min(schema.submission.createTime),
      latest: max(schema.submission.createTime),
      activeDays: countDistinct(sql`date(${localTime(schema.submission.createTime)})`),
    })
    .from(schema.submission)
    .where(eq(schema.submission.userId, userId))
  if (!row?.first || !row.latest) return failure(c, 404, "no-submissions", "暂无提交")
  return success(c, {
    now: new Date().toISOString(),
    first: row.first,
    latest: row.latest,
    activeDays: row.activeDays,
  } satisfies Metrics)
})

/**
 * 首页周榜的榜面大小。周榜解决的是「这一周谁在往前走」—— 每周一清零，所以榜面短一点更像「这周的头名」，
 * 长了反而又变成一张追不上的总表。榜外的人靠 `me` 单独看到自己的名次。
 */
const WEEKLY_BOARD_SIZE = 10

/** 算「解决」的两个状态：AST_CHECK_FAILED 也是答案对了，与排名页（routes/ranking.ts）同口径 */
const ACCEPTED_RESULTS = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

/**
 * 本周进步榜：按**本周首次 AC 的题目数**排名，每周一 0:00（东八区）清零。
 *
 * 「首次 AC」是靠 NOT EXISTS 排掉本周之前已经通过过的 (user, problem) 对，不是简单
 * 数本周 AC 的去重题数 —— 后者把老题重交一遍也算成绩，一分钟能刷满一屏。
 * 相关子查询的四个条件正好是 `submission_public_metrics_idx`
 * （user_id, problem_id, result, create_time，WHERE contest_id IS NULL）的全部列，
 * 而且外层已经把行数收在「本周的 AC」这一小撮上，不会退化成按人全表回查。
 */
accountRoutes.get("/rankings/weekly", optionalAuth, async (c) => {
  const user = c.get("user")
  const scope = c.req.query("scope") === "class" ? "class" : "global"
  const className = scope === "class" ? (user?.className ?? null) : null
  if (scope === "class" && !className) return failure(c, 400, "class-missing", "用户没有班级信息")

  const start = weekStart()

  // 入榜人群与排名页一致（routes/ranking.ts 的 rankedStudents）：正常状态的学生与学生管理员，
  // 老师设成不计入排名的不算
  const audience = and(
    inArray(schema.user.adminType, [...STUDENT_ROLES]),
    eq(schema.user.isDisabled, false),
    isNull(schema.user.rankHiddenAt),
    className ? eq(schema.user.className, className) : undefined,
  )
  const thisWeek = and(
    isNull(schema.submission.contestId),
    gte(schema.submission.createTime, start),
    audience,
  )

  const earlier = alias(schema.submission, "earlier")
  const [solvedRows, submittedRows] = await Promise.all([
    db
      .select({
        userId: schema.submission.userId,
        username: schema.user.username,
        value: countDistinct(schema.submission.problemId),
      })
      .from(schema.submission)
      .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
      .where(
        and(
          thisWeek,
          inArray(schema.submission.result, ACCEPTED_RESULTS),
          notExists(
            db
              .select({ one: sql`1` })
              .from(earlier)
              .where(
                and(
                  eq(earlier.userId, schema.submission.userId),
                  eq(earlier.problemId, schema.submission.problemId),
                  isNull(earlier.contestId),
                  inArray(earlier.result, ACCEPTED_RESULTS),
                  lt(earlier.createTime, start),
                ),
              ),
          ),
        ),
      )
      .groupBy(schema.submission.userId, schema.user.username),
    db
      .select({ userId: schema.submission.userId, value: count() })
      .from(schema.submission)
      .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
      .where(thisWeek)
      .groupBy(schema.submission.userId),
  ])

  const submissions = new Map(submittedRows.map((row) => [row.userId, row.value]))
  /**
   * 排序键与全服榜同构：解决多的在前 → 同解决数时提交少的在前 → 再同按 id。
   * 第三档同样不是凑数，周榜上「都是 1 题」的学生成片存在，没有稳定兜底键时
   * postgres 每次返回的顺序可以不同，刷新一下名次就变了。
   */
  const ranked = solvedRows
    .sort(
      (a, b) =>
        b.value - a.value ||
        (submissions.get(a.userId) ?? 0) - (submissions.get(b.userId) ?? 0) ||
        a.userId - b.userId,
    )
    .map(
      (row, index) =>
        ({
          user: sampleUser({ id: row.userId, username: row.username }, null),
          solvedCount: row.value,
          submissionCount: submissions.get(row.userId) ?? 0,
          rank: index + 1,
        }) satisfies WeeklyRankItem,
    )

  return success(c, {
    start,
    scope,
    className,
    total: ranked.length,
    results: ranked.slice(0, WEEKLY_BOARD_SIZE),
    me: ranked.find((row) => row.user.id === user?.id) ?? null,
  } satisfies WeeklyRank)
})

/** 题数少于这个的知识点不参与升级：3 道题的知识点做完就「精通」，没有意义 */
const KNOWLEDGE_MIN_PROBLEMS = 10
/** 同班这么多比例的人点亮过，才算「班里在学」，才会出现在「还没碰过」里 */
const KNOWLEDGE_CLASS_TOUCHED_RATIO = 0.3

/**
 * 四档门槛：入门 1 道、会了 3 道、熟练 = 题数的 40%（最多 10）、精通 = 75%（最多 20）。
 * 按题量缩放是因为知识点之间差得很远（循环结构 107 道、数组 15 道）。
 *
 * 拿 2025 秋回测过：中位数的学生一学期升 5 档，前 25% 升 9 档；加上「入门」这一档之前，
 * 26% 的学生一档都没升，其中一半做对过带标签的题、只是没到 3 道。
 */
function levelThresholds(problemCount: number) {
  return [
    1,
    3,
    Math.max(4, Math.min(10, Math.round(problemCount * 0.4))),
    Math.max(5, Math.min(20, Math.round(problemCount * 0.75))),
  ]
}

function levelOf(solved: number, thresholds: number[]) {
  return thresholds.filter((threshold) => solved >= threshold).length
}

/**
 * 我的知识点地图。「做对」按题目算（同一题只算一次），不含比赛提交，
 * 题目只算公开的题库题 —— 和 problemCount 同一个口径，不然会出现 12/10。
 */
accountRoutes.get("/me/knowledge", requireAuth, async (c) => {
  const user = c.get("user")!
  const tags = await db
    .select({
      id: schema.problemTag.id,
      name: schema.problemTag.name,
      problemCount: count(),
    })
    .from(schema.problemTag)
    .innerJoin(schema.problemTags, eq(schema.problemTags.problemtagId, schema.problemTag.id))
    .innerJoin(schema.problem, eq(schema.problem.id, schema.problemTags.problemId))
    .where(
      and(
        eq(schema.problemTag.category, "knowledge"),
        eq(schema.problem.visible, true),
        isNull(schema.problem.contestId),
      ),
    )
    .groupBy(schema.problemTag.id, schema.problemTag.name)
    .having(sql`count(*) >= ${KNOWLEDGE_MIN_PROBLEMS}`)
  const tagIds = tags.map((tag) => tag.id)
  if (!tagIds.length) return success(c, { tags: [], classTouched: [] } satisfies KnowledgeMap)

  const firstAccepted = db
    .select({
      problemId: schema.submission.problemId,
      firstAt: min(schema.submission.createTime).as("first_at"),
    })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.userId, user.id),
        isNull(schema.submission.contestId),
        inArray(schema.submission.result, ACCEPTED_RESULTS),
      ),
    )
    .groupBy(schema.submission.problemId)
    .as("first_accepted")

  const start = weekStart()
  const [mine, classTouchedRows, classSize] = await Promise.all([
    db
      .select({
        tagId: schema.problemTags.problemtagId,
        solved: count(),
        solvedBeforeWeek: sql<number>`count(*) filter (where ${firstAccepted.firstAt} < ${start})::int`,
      })
      .from(firstAccepted)
      .innerJoin(schema.problemTags, eq(schema.problemTags.problemId, firstAccepted.problemId))
      .innerJoin(schema.problem, eq(schema.problem.id, firstAccepted.problemId))
      .where(
        and(
          inArray(schema.problemTags.problemtagId, tagIds),
          eq(schema.problem.visible, true),
          isNull(schema.problem.contestId),
        ),
      )
      .groupBy(schema.problemTags.problemtagId),
    user.className
      ? db
          .select({
            tagId: schema.problemTags.problemtagId,
            users: countDistinct(schema.submission.userId),
          })
          .from(schema.submission)
          .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
          .innerJoin(
            schema.problemTags,
            eq(schema.problemTags.problemId, schema.submission.problemId),
          )
          .where(
            and(
              eq(schema.user.className, user.className),
              eq(schema.user.isDisabled, false),
              inArray(schema.user.adminType, [...STUDENT_ROLES]),
              isNull(schema.submission.contestId),
              inArray(schema.submission.result, ACCEPTED_RESULTS),
              inArray(schema.problemTags.problemtagId, tagIds),
            ),
          )
          .groupBy(schema.problemTags.problemtagId)
      : [],
    user.className
      ? db
          .select({ total: count() })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.className, user.className),
              eq(schema.user.isDisabled, false),
              inArray(schema.user.adminType, [...STUDENT_ROLES]),
            ),
          )
      : [],
  ])

  const mineByTag = new Map(mine.map((row) => [row.tagId, row]))
  const total = classSize[0]?.total ?? 0
  const touchedIds = new Set(
    classTouchedRows
      .filter((row) => total > 0 && row.users / total >= KNOWLEDGE_CLASS_TOUCHED_RATIO)
      .map((row) => row.tagId),
  )

  return success(c, {
    tags: tags
      .sort((a, b) => b.problemCount - a.problemCount)
      .map((tag) => {
        const thresholds = levelThresholds(tag.problemCount)
        const solved = mineByTag.get(tag.id)?.solved ?? 0
        const level = levelOf(solved, thresholds)
        return {
          name: tag.name,
          problemCount: tag.problemCount,
          solved,
          level,
          levelAtWeekStart: levelOf(mineByTag.get(tag.id)?.solvedBeforeWeek ?? 0, thresholds),
          nextAt: thresholds[level] ?? null,
        } satisfies KnowledgeLevel
      }),
    classTouched: tags.filter((tag) => touchedIds.has(tag.id)).map((tag) => tag.name),
  } satisfies KnowledgeMap)
})

accountRoutes.get("/problems/:displayId/rank", requireAuth, async (c) => {
  const user = c.get("user")!
  const [problem] = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(
      and(
        sql`lower(${schema.problem.displayId}) = lower(${c.req.param("displayId")})`,
        isNull(schema.problem.contestId),
        eq(schema.problem.visible, true),
      ),
    )
    .limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  const accepted = and(
    eq(schema.submission.problemId, problem.id),
    inArray(schema.submission.result, [0, 10]),
  )
  const [all] = await db
    .select({ value: countDistinct(schema.submission.userId) })
    .from(schema.submission)
    .where(accepted)
  const className = user.className ?? ""
  const classWhere = className
    ? and(
        accepted,
        inArray(
          schema.submission.userId,
          db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(and(eq(schema.user.className, className), eq(schema.user.isDisabled, false))),
        ),
      )
    : accepted
  const [classCount] = className
    ? await db
        .select({ value: countDistinct(schema.submission.userId) })
        .from(schema.submission)
        .where(classWhere)
    : [{ value: 0 }]
  const [first] = await db
    .select({ value: min(schema.submission.createTime) })
    .from(schema.submission)
    .where(and(classWhere, eq(schema.submission.userId, user.id)))
  let rank = -1
  if (first?.value) {
    const [rankRow] = await db
      .select({ value: count() })
      .from(schema.submission)
      .where(and(classWhere, lte(schema.submission.createTime, first.value)))
    rank = rankRow?.value ?? -1
  }
  return success(c, {
    className,
    rank,
    classAcCount: classCount?.value ?? 0,
    allAcCount: all?.value ?? 0,
  } satisfies ProblemRank)
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
  const [profile] = await db
    .select({ value: schema.userProfile.acmProblemsStatus })
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, user.id))
    .limit(1)
  const status = asRecord(profile?.value)
  const problems = asRecord(status.problems)
  const ids = Object.keys(problems).map(Number).filter(Number.isInteger)
  if (ids.length > 0) {
    const rows = await db
      .select({ id: schema.problem.id, displayId: schema.problem.displayId })
      .from(schema.problem)
      .where(and(inArray(schema.problem.id, ids), eq(schema.problem.visible, true)))
    const displayIds = new Map(rows.map((row) => [String(row.id), row.displayId]))
    for (const [id, value] of Object.entries(problems)) {
      const item = asRecord(value)
      const displayId = displayIds.get(id)
      if (displayId) item._id = displayId
      problems[id] = item
    }
    status.problems = problems
    await db
      .update(schema.userProfile)
      .set({ acmProblemsStatus: status })
      .where(eq(schema.userProfile.userId, user.id))
  }
  return success(c, null)
})

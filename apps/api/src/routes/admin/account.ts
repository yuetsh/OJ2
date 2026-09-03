import {
  STUDENT_ROLES,
  adminTypeSchema,
  adminUserListSchema,
  adminUserRankSchema,
  adminUserSchema,
  deleteUsersRequestSchema,
  importUsersRequestSchema,
  rankProfileSchema,
  resetPasswordResponseSchema,
  updateUserRequestSchema,
  type AdminType,
  type ProblemPermission,
} from "@oj2/contract"
import { randomInt } from "node:crypto"
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm"
import { Hono } from "hono"

import { hashPassword } from "../../auth/password"
import { requireSuperAdmin, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { queryInteger, sampleUser } from "../helpers"
import { publishSessionRevoked } from "../../events"

export const adminAccountRoutes = new Hono<AppEnv>()

const CLASS_NAME_MIN_DIGITS = 3
const CLASS_NAME_MAX_DIGITS = 4

/**
 * `ks251XXX` / `ks2510XX` → `251` / `2510`。不以 `ks+数字` 开头的（管理员、教师账号）返回 null。
 *
 * 位数不对**直接报错，不猜** —— 猜错会把 className 存歪，而剥前缀显示姓名、班级下拉、
 * 统计页都依赖它准确。先用 `\d+` 抓全再判位数，不能直接用固定位数的正则匹配：
 * 那样 `ks251001` 会「匹配成功」并悄悄取前 4 位，正是要避免的猜测。
 * 对齐旧 `account/views/admin.py:get_class_name`。
 */
function classNameOf(username: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const matched = /^ks(\d+)/.exec(username)
  if (!matched) return { ok: true, value: null }
  const digits = matched[1]!
  if (digits.length < CLASS_NAME_MIN_DIGITS || digits.length > CLASS_NAME_MAX_DIGITS) {
    return {
      ok: false,
      message: `用户名 ${username} 的班级号 ${digits} 是 ${digits.length} 位，必须是 ${CLASS_NAME_MIN_DIGITS}~${CLASS_NAME_MAX_DIGITS} 位数字`,
    }
  }
  return { ok: true, value: digits }
}

/**
 * 旧 UserAdminAPI.put 按 admin_type 归一 problem_permission：
 * 超管恒为 All、普通用户恒为 None、两种管理员取传入值或兜底 Own。
 * 不这么做的话，把一个超管降级成普通用户后，他还留着 All 的题目权限。
 */
function normalizePermission(adminType: AdminType, requested: ProblemPermission): ProblemPermission {
  if (adminType === "Super Admin") return "All"
  if (adminType === "Regular User") return "None"
  return requested || "Own"
}

function serialize(row: {
  user: typeof schema.user.$inferSelect
  realName: string | null
}) {
  return adminUserSchema.parse({
    id: row.user.id,
    username: row.user.username,
    email: row.user.email,
    adminType: row.user.adminType,
    problemPermission: row.user.problemPermission,
    realName: row.realName,
    createTime: row.user.createTime,
    lastLogin: row.user.lastLogin,
    isDisabled: row.user.isDisabled,
    rawPassword: row.user.rawPassword,
    className: row.user.className,
  })
}

function selectUser(id: number) {
  return db.select({ user: schema.user, realName: schema.userProfile.realName })
    .from(schema.user)
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.user.id, id)).limit(1)
}

/**
 * 后台的用户排名：老师按班级前缀翻学生，**不设 100 名上限**。
 *
 * 这份逻辑原来是公开榜单 `/rankings/users` 的 `top=0` 分支，搬过来是因为那意味着
 * 任何匿名请求都能 `?top=0&limit=250` 翻走全校学生名单和个性签名 ——
 * 而 `/profiles/:username` 恰恰为了收紧枚举面才做了「匿名一律返回空」。
 *
 * 排序口径与公开榜单一致（见 routes/account.ts 的 leaderboardOrder）：
 * AC 降序 → 提交数升序 → id 升序，第三档保证翻页稳定。
 */
adminAccountRoutes.get("/rankings/users", requireSuperAdmin, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const keyword = c.req.query("keyword")?.trim()
  const where = and(
    inArray(schema.user.adminType, [...STUDENT_ROLES]),
    eq(schema.user.isDisabled, false),
    keyword ? ilike(schema.user.username, `%${keyword}%`) : undefined,
  )

  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.userProfile)
      .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id)).where(where),
    db.select({ profile: schema.userProfile, user: schema.user }).from(schema.userProfile)
      .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id)).where(where)
      .orderBy(
        desc(schema.userProfile.acceptedNumber),
        asc(schema.userProfile.submissionNumber),
        asc(schema.user.id),
      )
      .limit(limit).offset(offset),
  ])

  return success(c, adminUserRankSchema.parse({
    results: rows.map(({ profile, user }) => rankProfileSchema.parse({
      id: profile.id,
      user: sampleUser(user, profile.realName),
      acceptedNumber: profile.acceptedNumber,
      submissionNumber: profile.submissionNumber,
      mood: profile.mood,
    })),
    total: totalRows[0]?.value ?? 0,
  }))
})

adminAccountRoutes.get("/users", requireSuperAdmin, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const filters = []
  const type = c.req.query("type")?.trim()
  const keyword = c.req.query("keyword")?.trim()
  if (type) {
    // 以前这里直接把 query 塞进 eq()，传个不存在的角色名只会静默返回空列表。
    // 列加了 $type 之后编译器会拦下来，顺势改成校验：前端的下拉只有这四个值。
    const parsedType = adminTypeSchema.safeParse(type)
    if (!parsedType.success) return failure(c, 400, "invalid-request", "角色筛选值不合法")
    filters.push(eq(schema.user.adminType, parsedType.data))
  }
  if (keyword) {
    filters.push(or(
      ilike(schema.user.username, `%${keyword}%`),
      ilike(schema.userProfile.realName, `%${keyword}%`),
      ilike(schema.user.email, `%${keyword}%`),
    )!)
  }
  const where = filters.length ? and(...filters) : undefined
  // 「最近登录」排序要把从未登录的排在最后，否则一堆 null 顶在最前面，这个排序就没用了
  const order = c.req.query("orderBy") === "-lastLogin"
    ? [sql`${schema.user.lastLogin} desc nulls last`]
    : [desc(schema.user.createTime)]

  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.user)
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id)).where(where),
    db.select({ user: schema.user, realName: schema.userProfile.realName }).from(schema.user)
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id)).where(where)
      .orderBy(...order, asc(schema.user.id)).limit(limit).offset(offset),
  ])
  return success(c, adminUserListSchema.parse({
    results: rows.map(serialize),
    total: totalRows[0]?.value ?? 0,
  }))
})

adminAccountRoutes.get("/users/:id", requireSuperAdmin, async (c) => {
  const [row] = await selectUser(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!row) return failure(c, 404, "user-not-found", "User does not exist")
  return success(c, serialize(row))
})

adminAccountRoutes.put("/users/:id", requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = updateUserRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const data = parsed.data
  const [existing] = await selectUser(id)
  if (!existing) return failure(c, 404, "user-not-found", "User does not exist")

  const username = data.username.toLowerCase()
  const email = data.email.toLowerCase()
  const className = classNameOf(username)
  if (!className.ok) return failure(c, 400, "invalid-class-name", className.message)

  const [dupUsername] = await db.select({ id: schema.user.id }).from(schema.user)
    .where(and(eq(schema.user.username, username), ne(schema.user.id, id))).limit(1)
  if (dupUsername) return failure(c, 409, "username-exists", "Username already exists")
  const [dupEmail] = await db.select({ id: schema.user.id }).from(schema.user)
    .where(and(eq(schema.user.email, email), ne(schema.user.id, id))).limit(1)
  if (dupEmail) return failure(c, 409, "email-exists", "Email already exists")

  const patch: Partial<typeof schema.user.$inferInsert> = {
    username,
    email,
    className: className.value,
    adminType: data.adminType,
    isDisabled: data.isDisabled,
    problemPermission: normalizePermission(data.adminType, data.problemPermission),
  }
  if (data.password) {
    // 与旧 User.set_password 一致：哈希与明文一起写。明文是有意保留的运营需求，
    // 老师要能查学生密码，见设计文档 7.1.1。
    patch.password = await hashPassword(data.password)
    patch.rawPassword = data.password
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.user).set(patch).where(eq(schema.user.id, id))
    // submission.username 是冗余列（判题历史按用户名查），改名后必须一起改，否则历史提交查不到
    if (existing.user.username !== username) {
      await tx.update(schema.submission).set({ username })
        .where(eq(schema.submission.username, existing.user.username))
    }
    await tx.update(schema.userProfile).set({ realName: data.realName })
      .where(eq(schema.userProfile.userId, id))
  })

  // 禁用只改数据库这一列，不动 Redis 里的会话 —— 那个学生挂着的 WebSocket
  // 靠会话巡检永远发现不了（token 还是好的），只能在这里主动断
  if (data.isDisabled && !existing.user.isDisabled) {
    await publishSessionRevoked({ userId: id }, "account-disabled")
  }

  const [row] = await selectUser(id)
  return success(c, serialize(row!))
})

adminAccountRoutes.post("/users", requireSuperAdmin, async (c) => {
  const parsed = importUsersRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const rows = parsed.data.users
  type Prepared = { username: string; password: string; raw: string; email: string; realName: string; className: string | null }

  // 先把不花钱的校验全做完，再动 argon2。班级号错、用户名重复这两种情况占了失败的绝大多数
  // （老师习惯把同一份名单粘两次），先算哈希的话要白等一整个班的 argon2 才看到报错。
  const prepared: Prepared[] = []
  for (const [username, password, email, realName] of rows) {
    const className = classNameOf(username)
    if (!className.ok) return failure(c, 400, "invalid-class-name", className.message)
    prepared.push({ username, password: "", raw: password, email, realName, className: className.value })
  }

  const existing = await db.select({ username: schema.user.username }).from(schema.user)
    .where(inArray(schema.user.username, prepared.map((item) => item.username)))
  if (existing.length) {
    return failure(c, 409, "username-exists", `用户名已存在：${existing.map((row) => row.username).join("、")}`)
  }

  // argon2id 是**故意**做慢的，串行 await 的话一个班要转好几秒。但也不能 Promise.all
  // 全量：每次哈希占 m=19MiB（见 auth/password.ts 的 ARGON2_OPTIONS），一个年级 300 人
  // 同时开就是 5.7GB，而 oj-api 的 mem_limit 只有 512m（docker/compose.debian.yml）。
  // 固定 4 路并发，瞬时峰值 76MiB 封顶。
  const HASH_CONCURRENCY = 4
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, prepared.length) }, async () => {
    while (cursor < prepared.length) {
      const item = prepared[cursor++]!
      item.password = await hashPassword(item.raw)
    }
  }))

  // 整批要么全进要么全不进 —— 导入是粘一整个班的名单，进了一半再重试会撞已存在
  const created = await db.transaction(async (tx) => {
    const users = await tx.insert(schema.user).values(prepared.map((item) => ({
      username: item.username,
      password: item.password,
      rawPassword: item.raw,
      email: item.email,
      className: item.className,
      adminType: "Regular User" as const,
      problemPermission: "None" as const,
      createTime: new Date().toISOString(),
      isDisabled: false,
    }))).returning({ id: schema.user.id, username: schema.user.username })
    const byName = new Map(users.map((row) => [row.username, row.id]))
    await tx.insert(schema.userProfile).values(prepared.map((item) => ({
      userId: byName.get(item.username)!,
      realName: item.realName,
      // avatar 是 notNull 且无默认值，必须显式给；路径与旧 UserProfile.avatar 的默认值一致
      avatar: "/public/avatar/default.png",
      acmProblemsStatus: {},
      submissionNumber: 0,
      acceptedNumber: 0,
    })))
    return users.length
  })
  return success(c, { imported: created }, 201)
})

adminAccountRoutes.delete("/users", requireSuperAdmin, async (c) => {
  const parsed = deleteUsersRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "ids is required")
  const me = c.get("user")!.id
  if (parsed.data.ids.includes(me)) {
    return failure(c, 400, "cannot-delete-self", "Current user can not be deleted")
  }
  // 用户是被引用最广的一张表（提交、题目、比赛、公告……），级联删除牵连太大，
  // 旧后端靠 Django 的应用层级联硬删。这里不复刻那个行为，改为让数据库拦下来：
  // 撞外键说明该用户还有历史数据，应当禁用而不是删除。
  //
  // 所以 0010 那一批 CASCADE **有意跳过了 user 的绝大多数外键**：成就、表情、题单进度、
  // AI 分析、站内信全都继续拦着。只有 user_profile 和 user_stat 走 CASCADE ——
  // 一个是一对一附属、一个是可重算的统计缓存，都不构成「这人做过什么」的证据。
  // 别顺手把这里也改成全 CASCADE：submission.user_id 压根没有外键（Django 那边就是个
  // 裸 IntegerField），全连坐的结果是成就没了、提交却留成孤儿行，一半删一半留。
  try {
    const deleted = await db.delete(schema.user).where(inArray(schema.user.id, parsed.data.ids))
      .returning({ id: schema.user.id })
    return success(c, { deleted: deleted.length })
  } catch {
    return failure(c, 409, "user-in-use", "该用户还有提交、题目等历史数据，无法删除；请改为禁用账号")
  }
})

adminAccountRoutes.post("/users/:id/reset-password", requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [existing] = await db.select({ id: schema.user.id }).from(schema.user)
    .where(eq(schema.user.id, id)).limit(1)
  if (!existing) return failure(c, 404, "user-not-found", "User does not exist")
  // 6 位随机数字、不含 0，与旧后端一致：学生要照着念、要手输，0 和 O 分不清
  const password = Array.from({ length: 6 }, () => "123456789"[randomInt(9)]).join("")
  await db.update(schema.user).set({
    password: await hashPassword(password),
    rawPassword: password,
  }).where(eq(schema.user.id, id))
  return success(c, resetPasswordResponseSchema.parse({ password }))
})

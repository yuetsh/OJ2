import {
  adminTypeSchema,
  deleteUsersRequestSchema,
  importUsersRequestSchema,
  STUDENT_ROLES,
  updateUserRequestSchema,
  type AdminType,
  type AdminUser,
  type AdminUserList,
  type AdminUserRank,
  type ProblemPermission,
  type RankProfile,
  type ResetPasswordResponse,
} from "@oj2/contract"
import { randomInt } from "node:crypto"
import { z } from "zod"
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm"
import { Hono } from "hono"

import { hashPassword } from "../../auth/password"
import { isUserOnline, onlineUserIds } from "../../auth/presence"
import { revokeUserSessions } from "../../auth/session"
import { requireSuperAdmin, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { queryInteger, sampleUser } from "../helpers"

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
}, isOnline: boolean) {
  return {
    id: row.user.id,
    username: row.user.username,
    email: row.user.email,
    adminType: row.user.adminType,
    problemPermission: row.user.problemPermission,
    realName: row.realName,
    createTime: row.user.createTime,
    lastLogin: row.user.lastLogin,
    isDisabled: row.user.isDisabled,
    isOnline,
    rawPassword: row.user.rawPassword,
    className: row.user.className,
  } satisfies AdminUser
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

  return success(c, {
    results: rows.map(({ profile, user }) => ({
      id: profile.id,
      user: sampleUser(user, profile.realName),
      acceptedNumber: profile.acceptedNumber,
      submissionNumber: profile.submissionNumber,
      mood: profile.mood,
      // 这张榜不下发在线状态（null = 「调用方不该知道」，见契约里 isOnline 的注释）。
      // 原来是靠 schema 的 .default(null) 填出来的，改成显式写死。
      isOnline: null,
    } satisfies RankProfile)),
    total: totalRows[0]?.value ?? 0,
  } satisfies AdminUserRank)
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
  // 在线状态每行都要下发（列表里显示），所以不管怎么排都先取一次
  const online = await onlineUserIds()
  const orderBy = c.req.query("orderBy")
  // 「最近登录」排序要把从未登录的排在最后，否则一堆 null 顶在最前面，这个排序就没用了
  //
  // 「在线优先」没有对应的库表列 —— 在线只存在于 Redis，所以把在线的 id 捞出来
  // 在 SQL 里分两档；档内仍按最近登录排，这样一屏离线用户之间还是有意义的顺序。
  // 没人在线时那个 case 恒等于 1，直接省掉（inArray 拿空数组也不合法）。
  const order = orderBy === "-online"
    ? [
        ...(online.size
          ? [sql`case when ${inArray(schema.user.id, [...online])} then 0 else 1 end`]
          : []),
        sql`${schema.user.lastLogin} desc nulls last`,
      ]
    : orderBy === "-lastLogin"
      ? [sql`${schema.user.lastLogin} desc nulls last`]
      : [desc(schema.user.createTime)]

  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.user)
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id)).where(where),
    db.select({ user: schema.user, realName: schema.userProfile.realName }).from(schema.user)
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id)).where(where)
      .orderBy(...order, asc(schema.user.id)).limit(limit).offset(offset),
  ])
  return success(c, {
    results: rows.map((row) => serialize(row, online.has(row.user.id))),
    total: totalRows[0]?.value ?? 0,
  } satisfies AdminUserList)
})

adminAccountRoutes.get("/users/:id", requireSuperAdmin, async (c) => {
  const [row] = await selectUser(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!row) return failure(c, 404, "user-not-found", "User does not exist")
  return success(c, serialize(row, await isUserOnline(row.user.id)))
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

  const username = data.username.trim().toLowerCase()
  const email = data.email.trim().toLowerCase()
  const className = classNameOf(username)
  if (!className.ok) return failure(c, 400, "invalid-class-name", className.message)

  const [dupUsername] = await db.select({ id: schema.user.id }).from(schema.user)
    .where(and(eq(schema.user.username, username), ne(schema.user.id, id))).limit(1)
  if (dupUsername) return failure(c, 409, "username-exists", "Username already exists")
  // 比 lower(email)：存量数据里有大小写混着的邮箱，按原值比会漏掉冲突
  const [dupEmail] = await db.select({ id: schema.user.id }).from(schema.user)
    .where(and(sql`lower(${schema.user.email}) = ${email}`, ne(schema.user.id, id))).limit(1)
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
    /**
     * submission.username 是冗余列，改名后跟着改。
     *
     * 条件按 **user_id** 而不是「等于旧用户名」：后者只改得动「当前正好还等于旧名」
     * 的行，一个已经漂移过的账号再改一次名，更早那批仍然改不动 —— 生产库里 726 条
     * 挂着旧名字的提交就是旧栈时代这么留下的，之后每次改名都从它身边绕过去。
     * 按 user_id 写是幂等的，顺带把这个人的历史行一次性拉平。
     *
     * 读路径本身已经不依赖这一列了（列表和统计都从 user 表取当前名字），
     * 这里保持同步是为了「已删号回退显示」和按名字搜索那两条路。
     */
    if (existing.user.username !== username) {
      await tx.update(schema.submission).set({ username })
        .where(eq(schema.submission.userId, id))
    }
    await tx.update(schema.userProfile).set({ realName: data.realName })
      .where(eq(schema.userProfile.userId, id))
  })

  // 禁用只改数据库这一列，会话在 Redis 里还好好的 —— 那个学生挂着的 WebSocket
  // 靠会话巡检永远发现不了（token 还是好的），只能在这里主动断。
  //
  // 改密码同样要吊销：不删旧会话的话，「给被盗用的账号改个密码」这个动作对已经
  // 登着的那一方毫无作用，他能一直用到会话自然过期。两件事都发生时按禁用报，
  // 学生看到的提示更贴近实际。
  if (data.isDisabled && !existing.user.isDisabled) {
    await revokeUserSessions(id, "account-disabled")
  } else if (data.password) {
    await revokeUserSessions(id, "session-ended")
  }

  const [row] = await selectUser(id)
  return success(c, serialize(row!, await isUserOnline(id)))
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
  //
  // 用户名和邮箱都归一成小写：登录是 `lower(username) = lower(?)` 比的，注册和
  // PUT /users/:id 也都存小写。只有这条导入路径原样存，于是 `ks251Ab` 能绕过下面的
  // 查重建出第二个账号，两个人登录时撞成同一条记录。
  const prepared: Prepared[] = []
  for (const [username, password, email, realName] of rows) {
    const name = username.toLowerCase()
    const className = classNameOf(name)
    if (!className.ok) return failure(c, 400, "invalid-class-name", className.message)
    const mail = email.trim().toLowerCase()
    // 邮箱在本站是唯一的（注册和 PUT /users/:id 两条路都查重），唯独导入这条以前
    // 什么都不查 —— 而前端生成的占位邮箱按「班级+批内序号」拼，同一个班导第二批
    // 必然重号。存进去不会报错（库里没有唯一约束），但这两个账号从此**编辑不了**：
    // PUT 一保存就撞自己的查重回 409，老师只看到「Email already exists」。
    if (!z.email().max(64).safeParse(mail).success) {
      return failure(c, 400, "invalid-email", `用户 ${name} 的邮箱 ${mail || "（空）"} 不是合法邮箱`)
    }
    prepared.push({ username: name, password: "", raw: password, email: mail, realName, className: className.value })
  }

  const dupInBatch = (values: string[]) => {
    const seen = new Set<string>()
    return [...new Set(values.filter((value) => seen.size === seen.add(value).size))]
  }
  const batchNames = dupInBatch(prepared.map((item) => item.username))
  if (batchNames.length) {
    return failure(c, 409, "username-exists", `这批名单里用户名重复：${batchNames.join("、")}`)
  }
  const batchMails = dupInBatch(prepared.map((item) => item.email))
  if (batchMails.length) {
    return failure(c, 409, "email-exists", `这批名单里邮箱重复：${batchMails.join("、")}`)
  }

  const existing = await db.select({ username: schema.user.username, email: schema.user.email })
    .from(schema.user)
    .where(or(
      inArray(schema.user.username, prepared.map((item) => item.username)),
      inArray(sql`lower(${schema.user.email})`, prepared.map((item) => item.email)),
    ))
  const takenNames = new Set(prepared.map((item) => item.username))
  const clashNames = existing.filter((row) => takenNames.has(row.username)).map((row) => row.username)
  if (clashNames.length) {
    return failure(c, 409, "username-exists", `用户名已存在：${clashNames.join("、")}`)
  }
  const takenMails = new Set(prepared.map((item) => item.email))
  const clashMails = existing
    .map((row) => row.email?.toLowerCase())
    .filter((mail): mail is string => !!mail && takenMails.has(mail))
  if (clashMails.length) {
    return failure(c, 409, "email-exists", `邮箱已被占用：${[...new Set(clashMails)].join("、")}`)
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

/**
 * 外键冲突（PostgresError 23503）。要顺着 cause 链找 —— drizzle 0.45 把驱动的错误
 * 包进 DrizzleQueryError，`error.code` 在最外层是 undefined，只看外层会把所有
 * 删除失败都当成系统故障报 500。
 */
function isForeignKeyViolation(error: unknown) {
  for (let current = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === "23503") return true
  }
  return false
}

/** 「这人还有提交」的信号。提交那张表没有外键，拦不住，只能自己查出来再把事务掀了 */
class UserHasSubmissionsError extends Error {}

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
    const deleted = await db.transaction(async (tx) => {
      /**
       * 外键拦得住成就、题单进度、比赛排名这些，**唯独提交拦不住** ——
       * `submission.user_id` 没有外键（Django 那边就是个裸 IntegerField，上面已经
       * 说了为什么不补）。所以下面那句报错里写的「还有提交」一直是空头支票：
       * 只交过题、没拿过成就没进过题单的学生照样删得掉，提交留在库里成了孤儿 ——
       * 用户没了、`submission.user_id` 还指着一个不存在的 id。生产快照实测：
       * 28 个已删账号留下 935 条这样的提交。
       *
       * 补一次查询把它拦下来，口径和外键那批一致：有历史数据就该禁用，不该删。
       * 和 delete 放同一个事务里，免得中间正好交了一发。
       */
      const [withSubmission] = await tx
        .select({ userId: schema.submission.userId })
        .from(schema.submission)
        .where(inArray(schema.submission.userId, parsed.data.ids))
        .limit(1)
      if (withSubmission) throw new UserHasSubmissionsError()

      return tx.delete(schema.user).where(inArray(schema.user.id, parsed.data.ids))
        .returning({ id: schema.user.id })
    })
    return success(c, { deleted: deleted.length })
  } catch (error) {
    // 只有外键冲突（23503）和上面那条提交检查才是「这人还有历史数据」。以前这里是裸
    // catch，连接断了、语句超时也照报这句，超管会照着提示去禁用账号，真正的故障一直没人看见
    if (!(error instanceof UserHasSubmissionsError) && !isForeignKeyViolation(error)) throw error
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
  // 旧密码登出来的会话立刻作废，理由同 PUT /users/:id
  await revokeUserSessions(id, "session-ended")
  return success(c, { password } satisfies ResetPasswordResponse)
})

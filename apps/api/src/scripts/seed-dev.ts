import { eq, sql } from "drizzle-orm"

import { hashPassword } from "../auth/password"
import { db, schema } from "../db"

/**
 * 本机开发用的账号。**只能对本地库跑** —— 它会重置账号密码并把明文写进
 * raw_password，其中一个还是超管。对着生产库跑一次就是把超管密码改掉，
 * 所以这里按 DATABASE_URL 的主机名拦一道，需要绕过时显式设 OJ2_SEED_FORCE=true。
 */
const url = process.env.DATABASE_URL ?? "postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge"
const host = (() => {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
})()
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""])
if (!LOCAL_HOSTS.has(host) && process.env.OJ2_SEED_FORCE !== "true") {
  console.error(
    `[seed:dev] DATABASE_URL 指向 ${host}，不是本机。这个脚本会重置账号密码` +
      `（含一个超管）并写明文 raw_password，拒绝执行。\n` +
      `           确实要对这个库跑，设 OJ2_SEED_FORCE=true。`,
  )
  process.exit(1)
}

const now = new Date().toISOString()

// 阶段 1 是带着显式 id 导入的，PostgreSQL 的序列没跟着走，先对齐
await db.execute(
  sql`select setval(pg_get_serial_sequence('"user"', 'id'), coalesce(max(${schema.user.id}), 1), true) from ${schema.user}`,
)

interface SeedAccount {
  username: string
  password: string
  adminType: "Regular User" | "Super Admin"
  problemPermission: "None" | "All"
  realName: string
}

/**
 * 建号或就地更新。**user_profile 那一行不能省** —— 缺了它 `/api/me` 返回
 * profile-not-found，前端的 getMyProfile 抛异常、localStorage 的 authed 存不
 * 进去，于是所有 /admin 路由被守卫弹回首页，而且不报错。本机的 devadmin 原来
 * 就缺 profile 和 email，后台页面一律进不去，排查了很久才找到这里。
 */
async function seed(account: SeedAccount) {
  // 走 hashPassword，和线上五个写入点同一条路
  const passwordHash = await hashPassword(account.password)
  const email = `${account.username}@example.test`
  const [user] = await db
    .insert(schema.user)
    .values({
      username: account.username,
      password: passwordHash,
      rawPassword: account.password,
      email,
      createTime: now,
      adminType: account.adminType,
      problemPermission: account.problemPermission,
      isDisabled: false,
    })
    .onConflictDoUpdate({
      target: schema.user.username,
      set: {
        password: passwordHash,
        rawPassword: account.password,
        email,
        adminType: account.adminType,
        problemPermission: account.problemPermission,
        isDisabled: false,
      },
    })
    .returning({ id: schema.user.id, username: schema.user.username })

  if (!user) throw new Error(`Failed to seed ${account.username}`)

  const [profile] = await db
    .select({ id: schema.userProfile.id })
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, user.id))
    .limit(1)

  if (!profile) {
    await db.insert(schema.userProfile).values({
      userId: user.id,
      acmProblemsStatus: { problems: {}, contest_problems: {} },
      avatar: "/public/avatar/default.png",
      realName: account.realName,
    })
  }

  console.log(`  ${account.adminType.padEnd(13)} ${user.username} / ${account.password}`)
}

console.log("Seeded development logins:")
await seed({
  username: process.env.OJ2_DEV_USERNAME ?? "student",
  password: process.env.OJ2_DEV_PASSWORD ?? "student123",
  adminType: "Regular User",
  problemPermission: "None",
  realName: "开发用学生",
})
await seed({
  username: process.env.OJ2_DEV_ADMIN_USERNAME ?? "devadmin",
  password: process.env.OJ2_DEV_ADMIN_PASSWORD ?? "devadmin123",
  adminType: "Super Admin",
  problemPermission: "All",
  realName: "开发用超管",
})
process.exit(0)

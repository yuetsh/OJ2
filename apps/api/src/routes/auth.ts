import { loginRequestSchema } from "@oj2/contract"
import { eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, type AppEnv } from "../auth/middleware"
import { createSession, destroySession } from "../auth/session"
import { publishSessionRevoked } from "../events"
import { hashPassword, verifyPassword } from "../auth/password"
import { db, schema } from "../db"
import { failure, parseBody, success } from "../http"
import { getUserProfileById } from "../services/profile"
import {
  clientIp,
  countAttempt,
  lockoutRemaining,
  resetAttempts,
  type AttemptRule,
} from "../services/throttling"

export const authRoutes = new Hono<AppEnv>()

/**
 * 登录防爆破，两道都只数失败：
 *
 * - **按用户名**：盯着一个账号猜。学生的初始密码弱、`/classes/:name/usernames` 又能
 *   公开列出整班用户名，这是最现实的攻击。15 分钟 10 次，登录成功清零。
 *   代价是别人能故意输错把某个学生锁 15 分钟 —— 比被猜中密码好得多。
 * - **按 IP**：换着用户名猜（每个号只试几次常见密码，绕开上一道）。机房一个班共用一个
 *   出口 IP，所以放得很宽，而且成功**不清零**，否则攻击者拿自己的号登一次就能重置。
 */
const LOGIN_PER_USERNAME: AttemptRule = { limit: 10, windowSeconds: 15 * 60 }
const LOGIN_PER_IP: AttemptRule = { limit: 100, windowSeconds: 15 * 60 }

authRoutes.post("/auth/login", async (c) => {
  const parsed = await parseBody(c, loginRequestSchema, "Username and password are required")
  if (!parsed.success) return parsed.response

  const usernameKey = `login:user:${parsed.data.username.toLowerCase()}`
  const ipKey = `login:ip:${clientIp(c)}`
  const wait =
    (await lockoutRemaining(usernameKey, LOGIN_PER_USERNAME)) ??
    (await lockoutRemaining(ipKey, LOGIN_PER_IP))
  if (wait !== null) {
    return failure(
      c,
      429,
      "too-many-login-attempts",
      `Too many failed attempts, please wait ${wait} seconds`,
    )
  }
  const loginFailed = async () => {
    await Promise.all([
      countAttempt(usernameKey, LOGIN_PER_USERNAME),
      countAttempt(ipKey, LOGIN_PER_IP),
    ])
    return failure(c, 401, "invalid-credentials", "Invalid username or password")
  }

  const [user] = await db
    .select()
    .from(schema.user)
    .where(sql`lower(${schema.user.username}) = lower(${parsed.data.username})`)
    .limit(1)

  if (!user) return loginFailed()
  if (user.isDisabled) {
    return failure(c, 403, "account-disabled", "Your account has been disabled")
  }

  const password = await verifyPassword(parsed.data.password, user.password)
  if (!password.valid) return loginFailed()
  await resetAttempts(usernameKey)

  const now = new Date().toISOString()
  const update: { lastLogin: string; password?: string } = { lastLogin: now }
  // 存量 pbkdf2 顺手升级成 argon2。生产库 1710 个账号都是 Django 写的 pbkdf2，
  // 靠这里随登录逐个迁移；没登录过的照旧由 verifyPassword 的 pbkdf2 分支兜着。
  if (password.needsUpgrade) {
    update.password = await hashPassword(parsed.data.password)
  }
  await db.update(schema.user).set(update).where(eq(schema.user.id, user.id))
  await createSession(c, user.id, user.lastLogin)

  return success(c, { ok: true })
})

authRoutes.delete("/auth/session", async (c) => {
  const token = await destroySession(c)
  // 同一个浏览器的其他标签页还挂着 WebSocket，页面上仍显示着登录态。推一条让它们
  // 立刻清掉，不用等最多 60 秒的会话巡检。
  // 按 token 而不是按用户：这个人在别的设备上的登录是另一张会话，不该被牵连。
  if (token) await publishSessionRevoked({ token }, "session-ended")
  return success(c, null)
})

authRoutes.get("/me", optionalAuth, async (c) => {
  const authUser = c.get("user")
  if (!authUser) return success(c, null)

  const data = await getUserProfileById(authUser.id, true)
  if (!data) return failure(c, 404, "profile-not-found", "User profile does not exist")
  return success(c, data)
})

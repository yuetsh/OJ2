import { loginRequestSchema } from "@oj2/contract"
import { eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, type AppEnv } from "../auth/middleware"
import { config } from "../config"
import { createSession, destroySession } from "../auth/session"
import { hashPassword, verifyPassword } from "../auth/password"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { getUserProfileById } from "../services/profile"

export const authRoutes = new Hono<AppEnv>()

authRoutes.post("/auth/login", async (c) => {
  const parsed = loginRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  )
  if (!parsed.success) {
    return failure(
      c,
      400,
      "invalid-request",
      "Username and password are required",
    )
  }

  const [user] = await db
    .select()
    .from(schema.user)
    .where(sql`lower(${schema.user.username}) = lower(${parsed.data.username})`)
    .limit(1)

  if (!user) {
    return failure(
      c,
      401,
      "invalid-credentials",
      "Invalid username or password",
    )
  }
  if (user.isDisabled) {
    return failure(c, 403, "account-disabled", "Your account has been disabled")
  }

  const password = await verifyPassword(parsed.data.password, user.password)
  if (!password.valid) {
    return failure(
      c,
      401,
      "invalid-credentials",
      "Invalid username or password",
    )
  }

  const now = new Date().toISOString()
  const update: { lastLogin: string; password?: string } = { lastLogin: now }
  // 存量 pbkdf2 顺手升级成 argon2。**只在总开关打开时做** —— 升过的账号回不去
  // 旧站，见 config.passwordHashUpgrade。开关关着时 hashPassword 写的也是 pbkdf2，
  // 所以这里不升级、别处不写 argon2，回滚路径才是完整的。
  if (password.needsUpgrade && config.passwordHashUpgrade) {
    update.password = await hashPassword(parsed.data.password)
  }
  await db.update(schema.user).set(update).where(eq(schema.user.id, user.id))
  await createSession(c, user.id, user.lastLogin)

  return success(c, { ok: true })
})

authRoutes.delete("/auth/session", async (c) => {
  await destroySession(c)
  return success(c, null)
})

authRoutes.get("/me", optionalAuth, async (c) => {
  const authUser = c.get("user")
  if (!authUser) return success(c, null)

  const data = await getUserProfileById(authUser.id, true)
  if (!data)
    return failure(c, 404, "profile-not-found", "User profile does not exist")
  return success(c, data)
})

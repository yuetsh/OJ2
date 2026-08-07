import {
  loginRequestSchema,
  sessionUserSchema,
  userProfileSchema,
} from "@oj2/contract"
import { and, eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, type AppEnv } from "../auth/middleware"
import { createSession, destroySession } from "../auth/session"
import { verifyPassword } from "../auth/password"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { getUserProfileById } from "../services/profile"

export const authRoutes = new Hono<AppEnv>()

authRoutes.post("/auth/login", async (c) => {
  const parsed = loginRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", "Username and password are required")
  }

  const [user] = await db
    .select()
    .from(schema.user)
    .where(
      sql`lower(${schema.user.username}) = lower(${parsed.data.username})`,
    )
    .limit(1)

  if (!user) {
    return failure(c, 401, "invalid-credentials", "Invalid username or password")
  }
  if (user.isDisabled) {
    return failure(c, 403, "account-disabled", "Your account has been disabled")
  }

  const password = await verifyPassword(parsed.data.password, user.password)
  if (!password.valid) {
    return failure(c, 401, "invalid-credentials", "Invalid username or password")
  }

  const now = new Date().toISOString()
  const update: { lastLogin: string; password?: string } = { lastLogin: now }
  if (password.needsUpgrade) {
    update.password = await Bun.password.hash(parsed.data.password, {
      algorithm: "argon2id",
    })
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
  if (!data) return failure(c, 404, "profile-not-found", "User profile does not exist")
  return success(c, data)
})

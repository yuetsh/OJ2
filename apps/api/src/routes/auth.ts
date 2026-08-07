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
  await createSession(c, user.id)

  return success(c, { ok: true })
})

authRoutes.delete("/auth/session", async (c) => {
  await destroySession(c)
  return success(c, null)
})

authRoutes.get("/me", optionalAuth, async (c) => {
  const authUser = c.get("user")
  if (!authUser) return success(c, null)

  const [row] = await db
    .select({
      profile: schema.userProfile,
      user: schema.user,
    })
    .from(schema.userProfile)
    .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id))
    .where(
      and(
        eq(schema.user.id, authUser.id),
        eq(schema.user.isDisabled, false),
      ),
    )
    .limit(1)

  if (!row) return failure(c, 404, "profile-not-found", "User profile does not exist")

  const data = userProfileSchema.parse({
    id: row.profile.id,
    user: sessionUserSchema.parse({
      id: row.user.id,
      username: row.user.username,
      email: row.user.email,
      adminType: row.user.adminType,
      problemPermission: row.user.problemPermission,
      createTime: row.user.createTime,
      lastLogin: row.user.lastLogin,
      openApi: row.user.openApi,
      isDisabled: row.user.isDisabled,
      className: row.user.className,
    }),
    realName: row.profile.realName,
    acmProblemsStatus: row.profile.acmProblemsStatus,
    avatar: row.profile.avatar,
    blog: row.profile.blog,
    mood: row.profile.mood,
    github: row.profile.github,
    school: row.profile.school,
    major: row.profile.major,
    language: row.profile.language,
    acceptedNumber: row.profile.acceptedNumber,
    submissionNumber: row.profile.submissionNumber,
  })

  return success(c, data)
})

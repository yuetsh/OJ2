import { eq, sql } from "drizzle-orm"

import { db, schema } from "../db"

const username = process.env.OJ2_DEV_USERNAME ?? "student"
const password = process.env.OJ2_DEV_PASSWORD ?? "student123"
const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" })
const now = new Date().toISOString()

// Phase 1 imports rows with explicit ids, so PostgreSQL's sequence has not moved.
await db.execute(
  sql`select setval(pg_get_serial_sequence('"user"', 'id'), coalesce(max(${schema.user.id}), 1), true) from ${schema.user}`,
)

const [user] = await db
  .insert(schema.user)
  .values({
    username,
    password: passwordHash,
    rawPassword: password,
    email: `${username}@example.test`,
    createTime: now,
    adminType: "Regular User",
    problemPermission: "None",
    openApi: false,
    isDisabled: false,
    sessionKeys: [],
  })
  .onConflictDoUpdate({
    target: schema.user.username,
    set: {
      password: passwordHash,
      rawPassword: password,
      email: `${username}@example.test`,
      isDisabled: false,
    },
  })
  .returning({ id: schema.user.id, username: schema.user.username })

if (!user) throw new Error("Failed to seed development user")

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
    realName: "Phase 2 Student",
  })
}

console.log(`Seeded development login: ${user.username} / ${password}`)
process.exit(0)

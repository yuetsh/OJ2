import {
  achievementListSchema,
  achievementSchema,
  achievementSummarySchema,
  markAchievementsReadSchema,
  pendingAchievementSchema,
} from "@oj2/contract"
import { and, asc, count, desc, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { objectValue } from "./helpers"

export const achievementRoutes = new Hono<AppEnv>()

async function resolveUser(requested: string | undefined, currentId: number) {
  if (!requested) {
    const [current] = await db.select({ id: schema.user.id, username: schema.user.username }).from(schema.user)
      .where(eq(schema.user.id, currentId)).limit(1)
    return current ?? null
  }
  const [target] = await db.select({ id: schema.user.id, username: schema.user.username }).from(schema.user)
    .where(and(eq(schema.user.username, requested), eq(schema.user.isDisabled, false))).limit(1)
  return target ?? null
}

function pendingData(row: { achievement: typeof schema.achievement.$inferSelect }) {
  return pendingAchievementSchema.parse({
    id: row.achievement.id,
    name: row.achievement.name,
    description: row.achievement.description,
    icon: row.achievement.icon,
    rarity: row.achievement.rarity,
  })
}

achievementRoutes.get("/achievements", requireAuth, async (c) => {
  const target = await resolveUser(c.req.query("username"), c.get("user")!.id)
  if (!target) return failure(c, 404, "user-not-found", "用户不存在")
  const [achievements, unlockedRows, statRows, activeRows] = await Promise.all([
    db.select().from(schema.achievement).where(eq(schema.achievement.visible, true)).orderBy(asc(schema.achievement.order), asc(schema.achievement.id)),
    db.select().from(schema.userAchievement).where(eq(schema.userAchievement.userId, target.id)),
    db.select({ metrics: schema.userStat.metrics }).from(schema.userStat).where(eq(schema.userStat.userId, target.id)).limit(1),
    db.select({ value: count() }).from(schema.user).where(eq(schema.user.isDisabled, false)),
  ])
  const unlocked = new Map(unlockedRows.map((row) => [row.achievementId, row]))
  const metrics = objectValue(statRows[0]?.metrics)
  const active = activeRows[0]?.value ?? 0
  const result = achievements.map((achievement) => {
    const record = unlocked.get(achievement.id)
    const masked = achievement.hidden && !record
    const progress = metrics[achievement.metric]
    return achievementSchema.parse({
      id: achievement.id,
      name: masked ? "???" : achievement.name,
      description: masked ? "达成条件保密" : achievement.description,
      icon: masked ? "noto:red-question-mark" : achievement.icon,
      rarity: achievement.rarity,
      hidden: achievement.hidden,
      metric: masked ? null : achievement.metric,
      operator: masked ? null : achievement.operator,
      threshold: masked ? null : achievement.threshold,
      unlocked: Boolean(record),
      unlockTime: record?.unlockTime ?? null,
      backfilled: record?.backfilled ?? false,
      progress: masked ? null : typeof progress === "number" ? progress : 0,
      unlockRate: active > 0 ? Math.round(achievement.unlockCount / active * 1000) / 10 : 0,
    })
  })
  return success(c, achievementListSchema.parse({ username: target.username, achievements: result }))
})

achievementRoutes.get("/achievements/summary", requireAuth, async (c) => {
  const target = await resolveUser(c.req.query("username"), c.get("user")!.id)
  if (!target) return failure(c, 404, "user-not-found", "用户不存在")
  const [achievements, unlockedRows] = await Promise.all([
    db.select({ id: schema.achievement.id, rarity: schema.achievement.rarity }).from(schema.achievement).where(eq(schema.achievement.visible, true)),
    db.select({ record: schema.userAchievement, achievement: schema.achievement }).from(schema.userAchievement)
      .innerJoin(schema.achievement, eq(schema.userAchievement.achievementId, schema.achievement.id))
      .where(and(eq(schema.userAchievement.userId, target.id), eq(schema.achievement.visible, true))).orderBy(desc(schema.userAchievement.unlockTime)),
  ])
  const labels = { bronze: "青铜", silver: "白银", gold: "黄金", platinum: "白金" }
  const rarities = ["bronze", "silver", "gold", "platinum"] as const
  const total = achievements.length
  const unlocked = unlockedRows.length
  return success(c, achievementSummarySchema.parse({
    username: target.username,
    total,
    unlocked,
    percent: total > 0 ? Math.round(unlocked / total * 1000) / 10 : 0,
    rarity: rarities.map((rarity) => ({
      rarity,
      label: labels[rarity],
      total: achievements.filter((item) => item.rarity === rarity).length,
      unlocked: unlockedRows.filter((item) => item.achievement.rarity === rarity).length,
    })),
    recent: unlockedRows.slice(0, 10).map(pendingData),
  }))
})

achievementRoutes.get("/achievements/pending", requireAuth, async (c) => {
  const rows = await db.select({ record: schema.userAchievement, achievement: schema.achievement })
    .from(schema.userAchievement).innerJoin(schema.achievement, eq(schema.userAchievement.achievementId, schema.achievement.id))
    .where(and(eq(schema.userAchievement.userId, c.get("user")!.id), eq(schema.userAchievement.notified, false), eq(schema.achievement.visible, true)))
    .orderBy(asc(schema.userAchievement.unlockTime))
  return success(c, rows.map(pendingData))
})

achievementRoutes.post("/achievements/pending/read", requireAuth, async (c) => {
  const parsed = markAchievementsReadSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid achievement ids")
  if (parsed.data.ids.length > 0) {
    await db.update(schema.userAchievement).set({ notified: true }).where(and(
      eq(schema.userAchievement.userId, c.get("user")!.id),
      inArray(schema.userAchievement.achievementId, parsed.data.ids),
    ))
  }
  return success(c, null)
})

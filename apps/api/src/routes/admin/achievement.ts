import {
  achievementMetricSchema,
  adminAchievementSchema,
  createAchievementRequestSchema,
  updateAchievementRequestSchema,
} from "@oj2/contract"
import { asc, eq } from "drizzle-orm"
import { Hono } from "hono"

import { requireSuperAdmin, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { ACHIEVEMENT_METRICS, findMetric, metricName } from "../../services/achievement-metrics"
import { rescanAchievement } from "../../services/achievements"
import { queryInteger } from "../helpers"

export const adminAchievementRoutes = new Hono<AppEnv>()

function serialize(row: typeof schema.achievement.$inferSelect) {
  return adminAchievementSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    rarity: row.rarity,
    hidden: row.hidden,
    metric: row.metric,
    metricName: metricName(row.metric),
    operator: row.operator,
    threshold: row.threshold,
    visible: row.visible,
    unlockCount: row.unlockCount,
    order: row.order,
    createTime: row.createTime,
  })
}

/** 下拉框的可选项就是代码里注册了什么，见 services/achievement-metrics.ts 的说明 */
adminAchievementRoutes.get("/achievement-metrics", requireSuperAdmin, (c) =>
  success(c, ACHIEVEMENT_METRICS.map((item) => achievementMetricSchema.parse(item))))

adminAchievementRoutes.get("/achievements", requireSuperAdmin, async (c) => {
  const rows = await db.select().from(schema.achievement)
    .orderBy(asc(schema.achievement.order), asc(schema.achievement.id))
  return success(c, rows.map(serialize))
})

adminAchievementRoutes.get("/achievements/:id", requireSuperAdmin, async (c) => {
  const [row] = await db.select().from(schema.achievement)
    .where(eq(schema.achievement.id, queryInteger(c.req.param("id"), 0, { min: 1 }))).limit(1)
  if (!row) return failure(c, 404, "achievement-not-found", "成就不存在")
  return success(c, serialize(row))
})

adminAchievementRoutes.post("/achievements", requireSuperAdmin, async (c) => {
  const parsed = createAchievementRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  if (!findMetric(parsed.data.metric)) return failure(c, 400, "invalid-metric", "指标不存在")

  const [created] = await db.insert(schema.achievement).values({
    ...parsed.data,
    unlockCount: 0,
    createTime: new Date().toISOString(),
  }).returning()

  // 新建的成就要补发给已达标的存量用户，否则「AC 满 10 题」这种成就
  // 只有从今往后的提交才算，老用户永远拿不到
  await rescanAchievement(created!.id)
  const [row] = await db.select().from(schema.achievement).where(eq(schema.achievement.id, created!.id)).limit(1)
  return success(c, serialize(row!), 201)
})

adminAchievementRoutes.put("/achievements/:id", requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = updateAchievementRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "参数错误")
  }
  if (!findMetric(parsed.data.metric)) return failure(c, 400, "invalid-metric", "指标不存在")

  const [before] = await db.select().from(schema.achievement).where(eq(schema.achievement.id, id)).limit(1)
  if (!before) return failure(c, 404, "achievement-not-found", "成就不存在")

  const [after] = await db.update(schema.achievement).set(parsed.data)
    .where(eq(schema.achievement.id, id)).returning()

  // 只要「谁能达成」这件事可能变了就补发，不去精细判断是否放宽。补发幂等（唯一键 + 冲突忽略），
  // 多跑一次只花一次扫描；漏跑却是学生已达标却拿不到，两个方向代价不对称。
  // 判据必须包含 metric（换了维度）和 visible（草稿期已达标的人），
  // 只看 operator/threshold 会漏掉这两种。
  const changed =
    before.metric !== after!.metric ||
    before.operator !== after!.operator ||
    before.threshold !== after!.threshold ||
    before.visible !== after!.visible
  if (after!.visible && changed) await rescanAchievement(id)

  const [row] = await db.select().from(schema.achievement).where(eq(schema.achievement.id, id)).limit(1)
  return success(c, serialize(row!))
})

adminAchievementRoutes.delete("/achievements/:id", requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  // user_achievement 的外键同样是 NO ACTION（Django 的级联在应用层），先清子表
  const deleted = await db.transaction(async (tx) => {
    await tx.delete(schema.userAchievement).where(eq(schema.userAchievement.achievementId, id))
    return tx.delete(schema.achievement).where(eq(schema.achievement.id, id))
      .returning({ id: schema.achievement.id })
  })
  if (deleted.length === 0) return failure(c, 404, "achievement-not-found", "成就不存在")
  return success(c, null)
})

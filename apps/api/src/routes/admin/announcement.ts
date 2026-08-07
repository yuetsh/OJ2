import {
  adminAnnouncementListSchema,
  adminAnnouncementSchema,
  createAnnouncementRequestSchema,
  updateAnnouncementRequestSchema,
} from "@oj2/contract"
import { count, desc, eq } from "drizzle-orm"
import { Hono } from "hono"

import { requireSuperAdmin, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { queryInteger, sampleUser } from "../helpers"

export const adminAnnouncementRoutes = new Hono<AppEnv>()

function serialize(row: {
  announcement: typeof schema.announcement.$inferSelect
  user: typeof schema.user.$inferSelect
  realName: string | null
}) {
  return adminAnnouncementSchema.parse({
    id: row.announcement.id,
    title: row.announcement.title,
    tag: row.announcement.tag,
    content: row.announcement.content,
    visible: row.announcement.visible,
    top: row.announcement.top,
    createdBy: sampleUser(row.user, row.realName),
    createTime: row.announcement.createTime,
    lastUpdateTime: row.announcement.lastUpdateTime,
  })
}

function selectOne(id: number) {
  return db
    .select({ announcement: schema.announcement, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.announcement)
    .innerJoin(schema.user, eq(schema.announcement.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.announcement.id, id))
    .limit(1)
}

adminAnnouncementRoutes.get("/announcements", requireSuperAdmin, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.announcement),
    db.select({ announcement: schema.announcement, user: schema.user, realName: schema.userProfile.realName })
      .from(schema.announcement)
      .innerJoin(schema.user, eq(schema.announcement.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .orderBy(desc(schema.announcement.createTime))
      .limit(limit)
      .offset(offset),
  ])
  return success(c, adminAnnouncementListSchema.parse({
    // 列表 schema omit 掉了 content，Zod 会 strip 掉多出来的键，这里不必手工再挑一遍
    results: rows.map(serialize),
    total: totalRows[0]?.value ?? 0,
  }))
})

adminAnnouncementRoutes.post("/announcements", requireSuperAdmin, async (c) => {
  const parsed = createAnnouncementRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const now = new Date().toISOString()
  const [created] = await db.insert(schema.announcement).values({
    ...parsed.data,
    createTime: now,
    lastUpdateTime: now,
    createdById: c.get("user")!.id,
  }).returning({ id: schema.announcement.id })
  const [row] = await selectOne(created!.id)
  return success(c, serialize(row!), 201)
})

adminAnnouncementRoutes.get("/announcements/:id", requireSuperAdmin, async (c) => {
  const [row] = await selectOne(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!row) return failure(c, 404, "announcement-not-found", "Announcement does not exist")
  return success(c, serialize(row))
})

adminAnnouncementRoutes.put("/announcements/:id", requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = updateAnnouncementRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const updated = await db.update(schema.announcement)
    .set({ ...parsed.data, lastUpdateTime: new Date().toISOString() })
    .where(eq(schema.announcement.id, id))
    .returning({ id: schema.announcement.id })
  if (updated.length === 0) {
    return failure(c, 404, "announcement-not-found", "Announcement does not exist")
  }
  const [row] = await selectOne(id)
  return success(c, serialize(row!))
})

adminAnnouncementRoutes.delete("/announcements/:id", requireSuperAdmin, async (c) => {
  // 旧后端删不存在的公告也返回成功（filter().delete() 不报错）。这里改成 404：
  // 后台是人手点删除，静默成功会让人以为删掉了，刷新后它还在。
  const deleted = await db.delete(schema.announcement)
    .where(eq(schema.announcement.id, queryInteger(c.req.param("id"), 0, { min: 1 })))
    .returning({ id: schema.announcement.id })
  if (deleted.length === 0) {
    return failure(c, 404, "announcement-not-found", "Announcement does not exist")
  }
  return success(c, null)
})

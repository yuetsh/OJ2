import {
  adminExerciseSchema,
  adminTutorialGroupsSchema,
  adminTutorialSchema,
  createExerciseRequestSchema,
  createTutorialRequestSchema,
  setTutorialVisibilityRequestSchema,
  updateExerciseRequestSchema,
  updateTutorialRequestSchema,
} from "@oj2/contract"
import { asc, desc, eq } from "drizzle-orm"
import { Hono } from "hono"

import { requireSuperAdmin, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { objectValue, queryInteger, sampleUser } from "../helpers"

export const adminTutorialRoutes = new Hono<AppEnv>()

function serializeTutorial(row: {
  tutorial: typeof schema.tutorial.$inferSelect
  user: typeof schema.user.$inferSelect
  realName: string | null
}) {
  return adminTutorialSchema.parse({
    id: row.tutorial.id,
    title: row.tutorial.title,
    content: row.tutorial.content,
    code: row.tutorial.code,
    isPublic: row.tutorial.isPublic,
    order: row.tutorial.order,
    type: row.tutorial.type,
    createdBy: sampleUser(row.user, row.realName),
    createdAt: row.tutorial.createdAt,
    updatedAt: row.tutorial.updatedAt,
  })
}

function selectTutorial(id: number) {
  return db
    .select({ tutorial: schema.tutorial, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.tutorial)
    .innerJoin(schema.user, eq(schema.tutorial.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.tutorial.id, id))
    .limit(1)
}

adminTutorialRoutes.get("/tutorials", requireSuperAdmin, async (c) => {
  const rows = await db
    .select({ tutorial: schema.tutorial, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.tutorial)
    .innerJoin(schema.user, eq(schema.tutorial.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .orderBy(asc(schema.tutorial.order), desc(schema.tutorial.createdAt))
  const all = rows.map(serializeTutorial)
  // 分组返回，形状对齐旧 TutorialAdminAPI.get；列表 schema omit 掉了 content/code，Zod 会 strip
  return success(c, adminTutorialGroupsSchema.parse({
    python: all.filter((item) => item.type === "python"),
    c: all.filter((item) => item.type === "c"),
  }))
})

adminTutorialRoutes.post("/tutorials", requireSuperAdmin, async (c) => {
  const parsed = createTutorialRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const now = new Date().toISOString()
  const [created] = await db.insert(schema.tutorial).values({
    ...parsed.data,
    createdAt: now,
    updatedAt: now,
    createdById: c.get("user")!.id,
  }).returning({ id: schema.tutorial.id })
  const [row] = await selectTutorial(created!.id)
  return success(c, serializeTutorial(row!), 201)
})

adminTutorialRoutes.get("/tutorials/:id", requireSuperAdmin, async (c) => {
  const [row] = await selectTutorial(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!row) return failure(c, 404, "tutorial-not-found", "Tutorial does not exist")
  return success(c, serializeTutorial(row))
})

adminTutorialRoutes.put("/tutorials/:id", requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = updateTutorialRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const updated = await db.update(schema.tutorial)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(schema.tutorial.id, id)).returning({ id: schema.tutorial.id })
  if (updated.length === 0) return failure(c, 404, "tutorial-not-found", "Tutorial does not exist")
  const [row] = await selectTutorial(id)
  return success(c, serializeTutorial(row!))
})

adminTutorialRoutes.put("/tutorials/:id/visibility", requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = setTutorialVisibilityRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "isPublic is required")
  // 只改可见性，不动 updatedAt —— 上下架不是内容修改，改了会打乱按更新时间排序的直觉
  const updated = await db.update(schema.tutorial)
    .set({ isPublic: parsed.data.isPublic })
    .where(eq(schema.tutorial.id, id)).returning({ id: schema.tutorial.id })
  if (updated.length === 0) return failure(c, 404, "tutorial-not-found", "Tutorial does not exist")
  const [row] = await selectTutorial(id)
  return success(c, serializeTutorial(row!))
})

adminTutorialRoutes.delete("/tutorials/:id", requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  // 练习与学习留痕都随教程一起没：exercise.tutorial_id 与 tutorial_progress.tutorial_id
  // 都是库级 CASCADE。**加子表时要回来想一遍该 CASCADE 还是该拦住**，
  // 别默认新表会自己连坐 —— 0010 只改了当时存在的那批外键。
  const deleted = await db.delete(schema.tutorial).where(eq(schema.tutorial.id, id))
    .returning({ id: schema.tutorial.id })
  if (deleted.length === 0) return failure(c, 404, "tutorial-not-found", "Tutorial does not exist")
  return success(c, null)
})

// ---------------------------------------------------------------- 练习

function serializeExercise(row: typeof schema.exercise.$inferSelect) {
  return adminExerciseSchema.parse({
    id: row.id,
    type: row.type,
    data: objectValue(row.data),
    order: row.order,
  })
}

// 练习挂在教程下，路径嵌套 —— 旧后端是 ?tutorial_id= 查询参数，
// 但它本来就是一对多的从属关系，嵌套路径更贴事实，也省掉「忘了传 tutorial_id」这类错误
adminTutorialRoutes.get("/tutorials/:id/exercises", requireSuperAdmin, async (c) => {
  const rows = await db.select().from(schema.exercise)
    .where(eq(schema.exercise.tutorialId, queryInteger(c.req.param("id"), 0, { min: 1 })))
    .orderBy(asc(schema.exercise.order), asc(schema.exercise.id))
  return success(c, rows.map(serializeExercise))
})

adminTutorialRoutes.post("/exercises", requireSuperAdmin, async (c) => {
  const parsed = createExerciseRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const [tutorial] = await db.select({ id: schema.tutorial.id }).from(schema.tutorial)
    .where(eq(schema.tutorial.id, parsed.data.tutorialId)).limit(1)
  if (!tutorial) return failure(c, 404, "tutorial-not-found", "Tutorial does not exist")
  const [created] = await db.insert(schema.exercise).values({
    tutorialId: parsed.data.tutorialId,
    type: parsed.data.type,
    data: parsed.data.data,
    order: parsed.data.order,
    createdAt: new Date().toISOString(),
  }).returning()
  return success(c, serializeExercise(created!), 201)
})

adminTutorialRoutes.put("/exercises/:id", requireSuperAdmin, async (c) => {
  const parsed = updateExerciseRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const [updated] = await db.update(schema.exercise)
    .set({ type: parsed.data.type, data: parsed.data.data, order: parsed.data.order })
    .where(eq(schema.exercise.id, queryInteger(c.req.param("id"), 0, { min: 1 })))
    .returning()
  if (!updated) return failure(c, 404, "exercise-not-found", "Exercise does not exist")
  return success(c, serializeExercise(updated))
})

adminTutorialRoutes.delete("/exercises/:id", requireSuperAdmin, async (c) => {
  const deleted = await db.delete(schema.exercise)
    .where(eq(schema.exercise.id, queryInteger(c.req.param("id"), 0, { min: 1 })))
    .returning({ id: schema.exercise.id })
  if (deleted.length === 0) return failure(c, 404, "exercise-not-found", "Exercise does not exist")
  return success(c, null)
})

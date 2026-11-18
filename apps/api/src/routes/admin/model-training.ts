/**
 * 后台「训练模型」：出题（标签、达标线、三份数据、达标后的说明）。设计见 docs/specs/2026-11-17-model-training-lab-design.md
 * 第 5 节；样子照画布「训练模型」页的 TrainEdit。
 *
 * 老师都能出、都能改（和另外两个实验室一样，是任课老师自己备课用的）。
 * 「试跑」（起点、上限）在出题页的浏览器里算：老师本来就拿着全部数据，朴素贝叶斯在契约里前后端共用。
 */
import {
  STUDENT_ROLES,
  createModelTrainingRequestSchema,
  reorderModelTrainingsRequestSchema,
  saveModelTrainingRequestSchema,
  type AdminModelTraining,
  type AdminModelTrainingListItem,
} from '@oj2/contract'
import { and, asc, countDistinct, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireTeacher, type AppEnv } from '../../auth/middleware'
import { db, schema } from '../../db'
import { failure, parseBody, success } from '../../http'
import { modelTrainingSaveError, selectItems } from '../../services/model-training'
import { queryInteger, sampleUser } from '../helpers'

export const adminModelTrainingRoutes = new Hono<AppEnv>()

async function serialize(id: number): Promise<AdminModelTraining | null> {
  const [row] = await db
    .select({ lesson: schema.modelTraining, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.modelTraining)
    .innerJoin(schema.user, eq(schema.modelTraining.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.modelTraining.id, id))
    .limit(1)
  if (!row) return null
  const items = await selectItems(id)
  return {
    id: row.lesson.id,
    title: row.lesson.title,
    description: row.lesson.description,
    review: row.lesson.review,
    isPublic: row.lesson.isPublic,
    labels: row.lesson.labels,
    threshold: row.lesson.threshold,
    items: items.map(({ id, split, text, shown, answer }) => ({ id, split, text, shown, answer })),
    createdBy: sampleUser(row.user, row.realName),
    createdAt: row.lesson.createdAt,
    updatedAt: row.lesson.updatedAt,
  } satisfies AdminModelTraining
}

function countColumn(split: string) {
  return sql<number>`(select count(*) from "model_training_item" i where i."model_training_id" = "model_training"."id" and i."split" = ${split})`.mapWith(
    Number,
  )
}

adminModelTrainingRoutes.get('/model-trainings', requireTeacher, async (c) => {
  const [rows, studentRows] = await Promise.all([
    db
      .select({
        lesson: schema.modelTraining,
        user: schema.user,
        realName: schema.userProfile.realName,
        trainCount: countColumn('train'),
        practiceCount: countColumn('practice'),
        finalCount: countColumn('final'),
      })
      .from(schema.modelTraining)
      .innerJoin(schema.user, eq(schema.modelTraining.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .orderBy(asc(schema.modelTraining.order), asc(schema.modelTraining.id)),
    // 训练过的学生数：老师自己试的不算
    db
      .select({ id: schema.modelTrainingRun.modelTrainingId, students: countDistinct(schema.modelTrainingRun.userId) })
      .from(schema.modelTrainingRun)
      .innerJoin(schema.user, eq(schema.user.id, schema.modelTrainingRun.userId))
      .where(inArray(schema.user.adminType, [...STUDENT_ROLES]))
      .groupBy(schema.modelTrainingRun.modelTrainingId),
  ])
  const students = new Map(studentRows.map((r) => [r.id, r.students]))
  return success(
    c,
    rows.map(
      (r) =>
        ({
          id: r.lesson.id,
          title: r.lesson.title,
          isPublic: r.lesson.isPublic,
          trainCount: r.trainCount,
          practiceCount: r.practiceCount,
          finalCount: r.finalCount,
          students: students.get(r.lesson.id) ?? 0,
          createdBy: sampleUser(r.user, r.realName),
          updatedAt: r.lesson.updatedAt,
        }) satisfies AdminModelTrainingListItem,
    ),
  )
})

adminModelTrainingRoutes.post('/model-trainings', requireTeacher, async (c) => {
  const parsed = await parseBody(c, createModelTrainingRequestSchema)
  if (!parsed.success) return parsed.response
  const now = new Date().toISOString()
  const [created] = await db
    .insert(schema.modelTraining)
    .values({
      title: parsed.data.title,
      order: sql`(select coalesce(max("order"), 0) + 1 from "model_training")`,
      createdById: c.get('user')!.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.modelTraining.id })
  return success(c, (await serialize(created!.id))!, 201)
})

/** 拖动排序。路径不叫 /model-trainings/order：会和下面的 /model-trainings/:id 撞 */
adminModelTrainingRoutes.put('/model-training-order', requireTeacher, async (c) => {
  const parsed = await parseBody(c, reorderModelTrainingsRequestSchema)
  if (!parsed.success) return parsed.response
  await db.transaction(async (tx) => {
    for (const [index, id] of parsed.data.ids.entries()) {
      // 排序不是内容修改，不动 updatedAt
      await tx
        .update(schema.modelTraining)
        .set({ order: index + 1 })
        .where(eq(schema.modelTraining.id, id))
    }
  })
  return success(c, null)
})

adminModelTrainingRoutes.get('/model-trainings/:id', requireTeacher, async (c) => {
  const lesson = await serialize(queryInteger(c.req.param('id'), 0, { min: 1 }))
  if (!lesson) return failure(c, 404, 'model-training-not-found', '这一节不存在')
  return success(c, lesson)
})

/**
 * 整节一起存。条目按数组顺序排：带 id 的改（只改真变了的）、不带的建、原来有而这次没出现的删掉。
 * 学生的改动按条目 id 记，删掉的条目在他们那边自然不算了（见 services 的 cleanEdits）。
 */
adminModelTrainingRoutes.put('/model-trainings/:id', requireTeacher, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, saveModelTrainingRequestSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data
  for (const item of body.items) {
    item.text = item.text.trim()
    if (item.split !== 'train') item.shown = null // 测试的两份没有「给学生的标签」
  }
  const [current] = await db.select({ id: schema.modelTraining.id }).from(schema.modelTraining).where(eq(schema.modelTraining.id, id)).limit(1)
  if (!current) return failure(c, 404, 'model-training-not-found', '这一节不存在')
  const error = modelTrainingSaveError(body)
  if (error) return failure(c, 400, 'invalid-model-training', error)

  const existing = await selectItems(id)
  const byId = new Map(existing.map((row) => [row.id, row]))
  if (body.items.some((item) => item.id !== undefined && !byId.has(item.id))) {
    return failure(c, 409, 'stale-items', '有的条目已经被别人删掉了，刷新一下再改')
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.modelTraining)
      .set({
        title: body.title,
        description: body.description,
        review: body.review.trim(),
        isPublic: body.isPublic,
        labels: body.labels,
        threshold: body.threshold,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.modelTraining.id, id))
    const keep = new Set(body.items.flatMap((item) => (item.id === undefined ? [] : [item.id])))
    const removed = existing.filter((row) => !keep.has(row.id)).map((row) => row.id)
    if (removed.length) await tx.delete(schema.modelTrainingItem).where(inArray(schema.modelTrainingItem.id, removed))
    const inserts: (typeof schema.modelTrainingItem.$inferInsert)[] = []
    for (const [order, { id: itemId, ...item }] of body.items.entries()) {
      const values = { split: item.split, text: item.text, shown: item.shown, answer: item.answer, order }
      if (itemId === undefined) {
        inserts.push({ ...values, modelTrainingId: id })
        continue
      }
      // 一节几百条，每次全改一遍太慢：只改真变了的
      const old = byId.get(itemId)!
      if (old.split === values.split && old.text === values.text && old.shown === values.shown && old.answer === values.answer && old.order === order) continue
      await tx
        .update(schema.modelTrainingItem)
        .set(values)
        .where(and(eq(schema.modelTrainingItem.id, itemId), eq(schema.modelTrainingItem.modelTrainingId, id)))
    }
    for (let i = 0; i < inserts.length; i += 500) await tx.insert(schema.modelTrainingItem).values(inserts.slice(i, i + 500))
  })
  return success(c, (await serialize(id))!)
})

adminModelTrainingRoutes.delete('/model-trainings/:id', requireTeacher, async (c) => {
  // 条目、学生的改动和训练记录都随这一节一起没（model_training_id 全是 CASCADE）
  const deleted = await db
    .delete(schema.modelTraining)
    .where(eq(schema.modelTraining.id, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .returning({ id: schema.modelTraining.id })
  if (!deleted.length) return failure(c, 404, 'model-training-not-found', '这一节不存在')
  return success(c, null)
})

/**
 * 后台「数据标注」：出题（一节的标签、条目、图片）。设计见 docs/specs/2026-11-17-data-labeling-lab-design.md
 * 第 5 节；样子照画布「数据标注」页的 LabelEditText / LabelEditImage / LabelEditSpan。
 *
 * 老师都能出、都能改（和「数据分析」一样，是任课老师自己备课用的）。
 */
import {
  LABELING_IMAGE_MAX_BYTES,
  LABELING_MAX_ITEMS,
  STUDENT_ROLES,
  createLabelingRequestSchema,
  reorderLabelingsRequestSchema,
  saveLabelingRequestSchema,
  type AdminLabeling,
  type AdminLabelingItem,
  type AdminLabelingListItem,
} from '@oj2/contract'
import { and, asc, countDistinct, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireTeacher, type AppEnv } from '../../auth/middleware'
import { db, schema } from '../../db'
import { failure, parseBody, success } from '../../http'
import { sniffImageExtension } from '../../services/image'
import { IMAGE_TYPES, itemColumns, labelingSaveError, type ItemRow } from '../../services/labeling'
import { queryInteger, sampleUser } from '../helpers'

export const adminLabelingRoutes = new Hono<AppEnv>()

export function adminItem(row: ItemRow): AdminLabelingItem {
  return { id: row.id, text: row.text, hasImage: row.imageType !== null, answer: row.answer, spans: row.spans, boxes: row.boxes, reason: row.reason }
}

function selectItems(labelingId: number) {
  return db
    .select(itemColumns)
    .from(schema.labelingItem)
    .where(eq(schema.labelingItem.labelingId, labelingId))
    .orderBy(asc(schema.labelingItem.order), asc(schema.labelingItem.id))
}

async function serializeLabeling(id: number): Promise<AdminLabeling | null> {
  const [row] = await db
    .select({ labeling: schema.labeling, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.labeling)
    .innerJoin(schema.user, eq(schema.labeling.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.labeling.id, id))
    .limit(1)
  if (!row) return null
  const items = await selectItems(id)
  return {
    id: row.labeling.id,
    title: row.labeling.title,
    description: row.labeling.description,
    kind: row.labeling.kind,
    labels: row.labeling.labels,
    isPublic: row.labeling.isPublic,
    items: items.map(adminItem),
    createdBy: sampleUser(row.user, row.realName),
    createdAt: row.labeling.createdAt,
    updatedAt: row.labeling.updatedAt,
  } satisfies AdminLabeling
}

const itemCountColumn = sql<number>`(select count(*) from "labeling_item" i where i."labeling_id" = "labeling"."id")`.mapWith(Number)

adminLabelingRoutes.get('/labelings', requireTeacher, async (c) => {
  const [rows, studentRows] = await Promise.all([
    db
      .select({ labeling: schema.labeling, user: schema.user, realName: schema.userProfile.realName, itemCount: itemCountColumn })
      .from(schema.labeling)
      .innerJoin(schema.user, eq(schema.labeling.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .orderBy(asc(schema.labeling.order), asc(schema.labeling.id)),
    // 动过手的学生数：老师自己试的不算
    db
      .select({ labelingId: schema.labelingAnswer.labelingId, students: countDistinct(schema.labelingAnswer.userId) })
      .from(schema.labelingAnswer)
      .innerJoin(schema.user, eq(schema.user.id, schema.labelingAnswer.userId))
      .where(inArray(schema.user.adminType, [...STUDENT_ROLES]))
      .groupBy(schema.labelingAnswer.labelingId),
  ])
  const students = new Map(studentRows.map((r) => [r.labelingId, r.students]))
  return success(
    c,
    rows.map(
      (r) =>
        ({
          id: r.labeling.id,
          title: r.labeling.title,
          kind: r.labeling.kind,
          isPublic: r.labeling.isPublic,
          itemCount: r.itemCount,
          students: students.get(r.labeling.id) ?? 0,
          createdBy: sampleUser(r.user, r.realName),
          updatedAt: r.labeling.updatedAt,
        }) satisfies AdminLabelingListItem,
    ),
  )
})

/** 新建问标题和类型（类型之后不能改）。建好就进编辑页：图片要挂在已经存在的一节下面 */
adminLabelingRoutes.post('/labelings', requireTeacher, async (c) => {
  const parsed = await parseBody(c, createLabelingRequestSchema)
  if (!parsed.success) return parsed.response
  const now = new Date().toISOString()
  const [created] = await db
    .insert(schema.labeling)
    .values({
      title: parsed.data.title,
      kind: parsed.data.kind,
      order: sql`(select coalesce(max("order"), 0) + 1 from "labeling")`,
      createdById: c.get('user')!.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.labeling.id })
  return success(c, (await serializeLabeling(created!.id))!, 201)
})

/** 拖动排序。路径不叫 /labelings/order：会和下面的 /labelings/:id 撞 */
adminLabelingRoutes.put('/labeling-order', requireTeacher, async (c) => {
  const parsed = await parseBody(c, reorderLabelingsRequestSchema)
  if (!parsed.success) return parsed.response
  await db.transaction(async (tx) => {
    for (const [index, id] of parsed.data.ids.entries()) {
      // 排序不是内容修改，不动 updatedAt
      await tx
        .update(schema.labeling)
        .set({ order: index + 1 })
        .where(eq(schema.labeling.id, id))
    }
  })
  return success(c, null)
})

adminLabelingRoutes.get('/labelings/:id', requireTeacher, async (c) => {
  const labeling = await serializeLabeling(queryInteger(c.req.param('id'), 0, { min: 1 }))
  if (!labeling) return failure(c, 404, 'labeling-not-found', '这一节不存在')
  return success(c, labeling)
})

/**
 * 整节一起存。条目按数组顺序排：带 id 的改、不带的建、原来有而这次没出现的删掉 ——
 * 学生在那一条的作答跟着没（labeling_answer.item_id CASCADE）。改答案不动作答记录：
 * 统计对照当前答案现算，已标对的不打回（设计文档第 8 节）。
 */
adminLabelingRoutes.put('/labelings/:id', requireTeacher, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, saveLabelingRequestSchema)
  if (!parsed.success) return parsed.response
  const [current] = await db.select({ kind: schema.labeling.kind }).from(schema.labeling).where(eq(schema.labeling.id, id)).limit(1)
  if (!current) return failure(c, 404, 'labeling-not-found', '这一节不存在')
  const kind = current.kind
  const body = parsed.data

  const existing = await db
    .select({ id: schema.labelingItem.id, imageType: schema.labelingItem.imageType })
    .from(schema.labelingItem)
    .where(eq(schema.labelingItem.labelingId, id))
  const existingIds = new Set(existing.map((r) => r.id))
  if (body.items.some((item) => item.id !== undefined && !existingIds.has(item.id))) {
    return failure(c, 409, 'stale-items', '有的条目已经被别人删掉了，刷新一下再改')
  }
  const imageIds = new Set(existing.filter((r) => r.imageType !== null).map((r) => r.id))
  const error = labelingSaveError(kind, body, imageIds)
  if (error) return failure(c, 400, 'invalid-labeling', error)

  await db.transaction(async (tx) => {
    await tx
      .update(schema.labeling)
      .set({ title: body.title, description: body.description, isPublic: body.isPublic, labels: body.labels, updatedAt: new Date().toISOString() })
      .where(eq(schema.labeling.id, id))
    const keep = new Set(body.items.flatMap((item) => (item.id === undefined ? [] : [item.id])))
    const removed = [...existingIds].filter((itemId) => !keep.has(itemId))
    if (removed.length) await tx.delete(schema.labelingItem).where(inArray(schema.labelingItem.id, removed))
    for (const [order, { id: itemId, ...item }] of body.items.entries()) {
      const values = {
        // 图片、框选的条目没有文字；只有分类有单个标签，只有实体标注有段，只有框选有框
        text: kind === 'image' || kind === 'box' ? '' : item.text.trim(),
        answer: kind === 'span' || kind === 'box' ? null : item.answer,
        spans: kind === 'span' ? item.spans : [],
        boxes: kind === 'box' ? item.boxes : [],
        reason: item.reason.trim(),
        order,
      }
      if (itemId === undefined) {
        await tx.insert(schema.labelingItem).values({ ...values, labelingId: id })
      } else {
        await tx
          .update(schema.labelingItem)
          .set(values)
          .where(and(eq(schema.labelingItem.id, itemId), eq(schema.labelingItem.labelingId, id)))
      }
    }
  })
  return success(c, (await serializeLabeling(id))!)
})

adminLabelingRoutes.delete('/labelings/:id', requireTeacher, async (c) => {
  // 条目、图片、学生作答都随这一节一起没（labeling_id 全是 CASCADE）
  const deleted = await db
    .delete(schema.labeling)
    .where(eq(schema.labeling.id, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .returning({ id: schema.labeling.id })
  if (!deleted.length) return failure(c, 404, 'labeling-not-found', '这一节不存在')
  return success(c, null)
})

/**
 * 传一张图 = 在这一节最后加一条（标签还没选，answer 是 null）。上传即生效，不等「保存」，
 * 出题页把返回的条目接到列表末尾；之后的「保存」带着它的 id 改标签、理由、顺序。
 */
adminLabelingRoutes.post('/labelings/:id/images', requireTeacher, async (c) => {
  const labelingId = queryInteger(c.req.param('id'), 0, { min: 1 })
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return failure(c, 400, 'invalid-request', '没收到图片')
  if (file.size > LABELING_IMAGE_MAX_BYTES) return failure(c, 400, 'image-too-large', `一张图最大 ${LABELING_IMAGE_MAX_BYTES / 1024 / 1024}MB`)
  const extension = await sniffImageExtension(file)
  if (!extension) return failure(c, 400, 'invalid-image', '只认 PNG、JPG、GIF、BMP 图片')
  const [labeling] = await db.select({ kind: schema.labeling.kind }).from(schema.labeling).where(eq(schema.labeling.id, labelingId)).limit(1)
  if (!labeling) return failure(c, 404, 'labeling-not-found', '这一节不存在')
  if (labeling.kind !== 'image' && labeling.kind !== 'box') return failure(c, 400, 'not-image-labeling', '这一节不用传图片')
  const [count] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.labelingItem)
    .where(eq(schema.labelingItem.labelingId, labelingId))
  if ((count?.n ?? 0) >= LABELING_MAX_ITEMS) return failure(c, 400, 'too-many-items', `一节最多 ${LABELING_MAX_ITEMS} 条`)
  const image = Buffer.from(await file.arrayBuffer())
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.labelingItem)
      .values({
        labelingId,
        order: sql`(select coalesce(max("order"), -1) + 1 from "labeling_item" where "labeling_id" = ${labelingId})`,
        image,
        imageType: IMAGE_TYPES[extension]!,
      })
      .returning(itemColumns)
    // 新图还没选标签 / 还没画框：已经公开的一节先收回来，不然学生会碰上一条怎么点都不对的（出题页同时把开关关掉）
    await tx.update(schema.labeling).set({ isPublic: false }).where(eq(schema.labeling.id, labelingId))
    return inserted!
  })
  return success(c, adminItem(row), 201)
})

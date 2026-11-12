/**
 * 后台「数据分析」：出题（一节的步骤、素材）和出题页的「试跑这一步」。设计见
 * docs/specs/2026-11-12-data-analysis-lab-design.md 第 6 节；样子照画布 LabEdit。
 *
 * 老师都能出、都能改（和教程只给超管不同：数据分析是任课老师自己备课用的）。
 */
import {
  LAB_ASSET_MAX_BYTES,
  LAB_ASSETS_MAX_TOTAL_BYTES,
  STUDENT_ROLES,
  createLabRequestSchema,
  labTrialRequestSchema,
  reorderLabsRequestSchema,
  saveLabRequestSchema,
  type AdminLab,
  type AdminLabListItem,
  type LabAsset,
  type LabAssetPreview,
  type LabRunResult,
} from '@oj2/contract'
import { and, asc, countDistinct, eq, inArray, ne, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'

import { requireTeacher, type AppEnv } from '../../auth/middleware'
import { db, schema } from '../../db'
import { failure, parseBody, success } from '../../http'
import { LabBusyError, LabRunnerError, buildRunRequest, labAssetNameError, labAssetPreview, labAssetsPayload, labStepError, runLab } from '../../services/lab'
import { queryInteger, sampleUser } from '../helpers'

export const adminLabRoutes = new Hono<AppEnv>()

function selectLab(id: number) {
  return db
    .select({ lab: schema.lab, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.lab)
    .innerJoin(schema.user, eq(schema.lab.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.lab.id, id))
    .limit(1)
}

function selectAssets(labId: number) {
  return db
    .select({ id: schema.labAsset.id, name: schema.labAsset.name, size: schema.labAsset.size })
    .from(schema.labAsset)
    .where(eq(schema.labAsset.labId, labId))
    .orderBy(asc(schema.labAsset.name))
}

async function serializeLab(id: number): Promise<AdminLab | null> {
  const [row] = await selectLab(id)
  if (!row) return null
  const [steps, assets] = await Promise.all([
    db.select().from(schema.labStep).where(eq(schema.labStep.labId, id)).orderBy(asc(schema.labStep.order), asc(schema.labStep.id)),
    selectAssets(id),
  ])
  return {
    id: row.lab.id,
    title: row.lab.title,
    description: row.lab.description,
    isPublic: row.lab.isPublic,
    steps: steps.map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      description: s.description,
      starterCode: s.starterCode,
      referenceCode: s.referenceCode,
      checkKind: s.checkKind,
      compareVars: s.compareVars,
      compareFigure: s.compareFigure,
      checkScript: s.checkScript,
    })),
    assets: assets satisfies LabAsset[],
    createdBy: sampleUser(row.user, row.realName),
    createdAt: row.lab.createdAt,
    updatedAt: row.lab.updatedAt,
  } satisfies AdminLab
}

const stepCountColumn = sql<number>`(select count(*) from "lab_step" s where s."lab_id" = "lab"."id")`.mapWith(Number)

adminLabRoutes.get('/labs', requireTeacher, async (c) => {
  const [rows, studentRows] = await Promise.all([
    db
      .select({ lab: schema.lab, user: schema.user, realName: schema.userProfile.realName, stepCount: stepCountColumn })
      .from(schema.lab)
      .innerJoin(schema.user, eq(schema.lab.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .orderBy(asc(schema.lab.order), asc(schema.lab.id)),
    // 动过手的学生数：老师自己试的不算
    db
      .select({ labId: schema.labProgress.labId, students: countDistinct(schema.labProgress.userId) })
      .from(schema.labProgress)
      .innerJoin(schema.user, eq(schema.user.id, schema.labProgress.userId))
      .where(inArray(schema.user.adminType, [...STUDENT_ROLES]))
      .groupBy(schema.labProgress.labId),
  ])
  const students = new Map(studentRows.map((r) => [r.labId, r.students]))
  return success(
    c,
    rows.map(
      (r) =>
        ({
          id: r.lab.id,
          title: r.lab.title,
          isPublic: r.lab.isPublic,
          stepCount: r.stepCount,
          students: students.get(r.lab.id) ?? 0,
          createdBy: sampleUser(r.user, r.realName),
          updatedAt: r.lab.updatedAt,
        }) satisfies AdminLabListItem,
    ),
  )
})

/** 新建只要一个标题：建好就进编辑页，素材要挂在已经存在的一节下面 */
adminLabRoutes.post('/labs', requireTeacher, async (c) => {
  const parsed = await parseBody(c, createLabRequestSchema)
  if (!parsed.success) return parsed.response
  const now = new Date().toISOString()
  // 新建的排最后
  const [created] = await db
    .insert(schema.lab)
    .values({
      title: parsed.data.title,
      order: sql`(select coalesce(max("order"), 0) + 1 from "lab")`,
      createdById: c.get('user')!.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.lab.id })
  return success(c, (await serializeLab(created!.id))!, 201)
})

/** 拖动排序。路径不叫 /labs/order：会和下面的 /labs/:id 撞 */
adminLabRoutes.put('/lab-order', requireTeacher, async (c) => {
  const parsed = await parseBody(c, reorderLabsRequestSchema)
  if (!parsed.success) return parsed.response
  await db.transaction(async (tx) => {
    for (const [index, id] of parsed.data.ids.entries()) {
      // 排序不是内容修改，不动 updatedAt
      await tx
        .update(schema.lab)
        .set({ order: index + 1 })
        .where(eq(schema.lab.id, id))
    }
  })
  return success(c, null)
})

adminLabRoutes.get('/labs/:id', requireTeacher, async (c) => {
  const lab = await serializeLab(queryInteger(c.req.param('id'), 0, { min: 1 }))
  if (!lab) return failure(c, 404, 'lab-not-found', '这一节不存在')
  return success(c, lab)
})

/**
 * 整节一起存（出题页只有一个「保存」）。步骤按数组顺序排：带 id 的改、不带的建、
 * 原来有而这次没出现的删掉 —— 学生在那一步的进度跟着没（lab_progress.step_id CASCADE）。
 */
adminLabRoutes.put('/labs/:id', requireTeacher, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, saveLabRequestSchema)
  if (!parsed.success) return parsed.response
  const { steps, ...lab } = parsed.data
  for (const [index, step] of steps.entries()) {
    const error = labStepError(step, index)
    if (error) return failure(c, 400, 'invalid-step', error)
  }
  const existing = await db.select({ id: schema.labStep.id }).from(schema.labStep).where(eq(schema.labStep.labId, id))
  const existingIds = new Set(existing.map((s) => s.id))
  if (steps.some((s) => s.id !== undefined && !existingIds.has(s.id))) {
    return failure(c, 409, 'stale-steps', '有的步骤已经被别人删掉了，刷新一下再改')
  }

  const ok = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.lab)
      .set({ ...lab, updatedAt: new Date().toISOString() })
      .where(eq(schema.lab.id, id))
      .returning({ id: schema.lab.id })
    if (!updated.length) return false
    const keep = steps.flatMap((s) => (s.id === undefined ? [] : [s.id]))
    const removed = [...existingIds].filter((stepId) => !keep.includes(stepId))
    if (removed.length) await tx.delete(schema.labStep).where(inArray(schema.labStep.id, removed))
    for (const [order, { id: stepId, ...step }] of steps.entries()) {
      if (stepId === undefined) {
        await tx.insert(schema.labStep).values({ ...step, labId: id, order })
      } else {
        await tx
          .update(schema.labStep)
          .set({ ...step, order })
          .where(and(eq(schema.labStep.id, stepId), eq(schema.labStep.labId, id)))
      }
    }
    return true
  })
  if (!ok) return failure(c, 404, 'lab-not-found', '这一节不存在')
  return success(c, (await serializeLab(id))!)
})

adminLabRoutes.delete('/labs/:id', requireTeacher, async (c) => {
  // 步骤、素材、学生进度都随这一节一起没（lab_id 全是 CASCADE）
  const deleted = await db
    .delete(schema.lab)
    .where(eq(schema.lab.id, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .returning({ id: schema.lab.id })
  if (!deleted.length) return failure(c, 404, 'lab-not-found', '这一节不存在')
  return success(c, null)
})

// ---------------------------------------------------------------- 素材

/** 上传即生效，不等「保存」。同名的覆盖（删旧的、插新的，新 id）。 */
adminLabRoutes.post('/labs/:id/assets', requireTeacher, async (c) => {
  const labId = queryInteger(c.req.param('id'), 0, { min: 1 })
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return failure(c, 400, 'invalid-request', '没收到文件')
  const nameError = labAssetNameError(file.name)
  if (nameError) return failure(c, 400, 'invalid-asset', nameError)
  if (file.size > LAB_ASSET_MAX_BYTES) return failure(c, 400, 'asset-too-large', `一个文件最大 ${LAB_ASSET_MAX_BYTES / 1024 / 1024}MB`)
  const [lab] = await db.select({ id: schema.lab.id }).from(schema.lab).where(eq(schema.lab.id, labId)).limit(1)
  if (!lab) return failure(c, 404, 'lab-not-found', '这一节不存在')
  const [others] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.labAsset.size}), 0)`.mapWith(Number) })
    .from(schema.labAsset)
    .where(and(eq(schema.labAsset.labId, labId), ne(schema.labAsset.name, file.name)))
  if ((others?.total ?? 0) + file.size > LAB_ASSETS_MAX_TOTAL_BYTES) {
    return failure(c, 400, 'asset-too-large', `一节的素材加起来最大 ${LAB_ASSETS_MAX_TOTAL_BYTES / 1024 / 1024}MB`)
  }
  const data = Buffer.from(await file.arrayBuffer())
  const created = await db.transaction(async (tx) => {
    await tx.delete(schema.labAsset).where(and(eq(schema.labAsset.labId, labId), eq(schema.labAsset.name, file.name)))
    const [row] = await tx
      .insert(schema.labAsset)
      .values({ labId, name: file.name, size: data.length, data, createdAt: new Date().toISOString() })
      .returning({ id: schema.labAsset.id, name: schema.labAsset.name, size: schema.labAsset.size })
    return row!
  })
  return success(c, created satisfies LabAsset, 201)
})

adminLabRoutes.delete('/labs/:id/assets/:assetId', requireTeacher, async (c) => {
  const deleted = await db
    .delete(schema.labAsset)
    .where(
      and(
        eq(schema.labAsset.id, queryInteger(c.req.param('assetId'), 0, { min: 1 })),
        eq(schema.labAsset.labId, queryInteger(c.req.param('id'), 0, { min: 1 })),
      ),
    )
    .returning({ id: schema.labAsset.id })
  if (!deleted.length) return failure(c, 404, 'asset-not-found', '这个素材不存在')
  return success(c, null)
})

async function findAsset(c: Context<AppEnv>) {
  const [asset] = await db
    .select({ id: schema.labAsset.id, name: schema.labAsset.name, labId: schema.labAsset.labId })
    .from(schema.labAsset)
    .where(
      and(
        eq(schema.labAsset.id, queryInteger(c.req.param('assetId'), 0, { min: 1 })),
        eq(schema.labAsset.labId, queryInteger(c.req.param('id'), 0, { min: 1 })),
      ),
    )
    .limit(1)
  return asset
}

adminLabRoutes.get('/labs/:id/assets/:assetId/preview', requireTeacher, async (c) => {
  const asset = await findAsset(c)
  if (!asset) return failure(c, 404, 'asset-not-found', '这个素材不存在')
  try {
    return success(c, (await labAssetPreview(asset.labId, asset)) satisfies LabAssetPreview)
  } catch (error) {
    console.error('Lab asset preview failed', error)
    return failure(c, 502, 'lab-unavailable', '运行器暂时连不上')
  }
})

adminLabRoutes.get('/labs/:id/assets/:assetId/file', requireTeacher, async (c) => {
  const asset = await findAsset(c)
  if (!asset) return failure(c, 404, 'asset-not-found', '这个素材不存在')
  const [row] = await db.select({ data: schema.labAsset.data }).from(schema.labAsset).where(eq(schema.labAsset.id, asset.id))
  return new Response(new Uint8Array(row!.data), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
    },
  })
})

// ---------------------------------------------------------------- 试跑

/** 出题页「试跑这一步」：用编辑器里还没存的答案，从第 1 步跑到这一步（设计文档第 6 节）。 */
adminLabRoutes.post('/labs/:id/trial', requireTeacher, async (c) => {
  const labId = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, labTrialRequestSchema)
  if (!parsed.success) return parsed.response
  const { steps, index } = parsed.data
  if (index >= steps.length) return failure(c, 400, 'invalid-request', '没有这一步')
  const error = labStepError(steps[index]!, index)
  if (error) return failure(c, 400, 'invalid-step', error)
  const [lab] = await db.select({ id: schema.lab.id }).from(schema.lab).where(eq(schema.lab.id, labId)).limit(1)
  if (!lab) return failure(c, 404, 'lab-not-found', '这一节不存在')
  try {
    const result = await runLab(c.get('user')!.id, buildRunRequest(steps, index, await labAssetsPayload(labId)))
    return success(c, result satisfies LabRunResult)
  } catch (err) {
    if (err instanceof LabBusyError) return failure(c, 429, 'lab-busy', '上一次还没跑完，稍等一下')
    if (err instanceof LabRunnerError) {
      console.error('Lab trial failed', err.message)
      return failure(c, 502, 'lab-unavailable', '运行器暂时连不上')
    }
    throw err
  }
})

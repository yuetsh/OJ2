/**
 * 后台「数据分析」：出题（一节的步骤、素材）和出题页的「试跑这一步」。设计见
 * docs/specs/2026-11-12-data-analysis-design.md 第 6 节；样子照画布 DataAnalysisEdit。
 *
 * 老师都能出、都能改（和教程只给超管不同：数据分析是任课老师自己备课用的）。
 */
import {
  DATA_ANALYSIS_ASSET_MAX_BYTES,
  DATA_ANALYSIS_ASSETS_MAX_TOTAL_BYTES,
  STUDENT_ROLES,
  createDataAnalysisRequestSchema,
  dataAnalysisTrialRequestSchema,
  reorderDataAnalysesRequestSchema,
  saveDataAnalysisRequestSchema,
  type AdminDataAnalysis,
  type AdminDataAnalysisListItem,
  type DataAnalysisAsset,
  type DataAnalysisAssetPreview,
  type DataAnalysisRunResult,
} from '@oj2/contract'
import { and, asc, countDistinct, eq, inArray, ne, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'

import { requireTeacher, type AppEnv } from '../../auth/middleware'
import { db, schema } from '../../db'
import { failure, parseBody, success } from '../../http'
import {
  DataAnalysisBusyError,
  DataAnalysisRunnerError,
  DataAnalysisTooLongError,
  buildRunRequest,
  dataAnalysisAssetNameError,
  dataAnalysisAssetPreview,
  dataAnalysisAssetsPayload,
  dataAnalysisStepError,
  runDataAnalysis,
} from '../../services/data-analysis'
import { queryInteger, sampleUser } from '../helpers'

export const adminDataAnalysisRoutes = new Hono<AppEnv>()

function selectDataAnalysis(id: number) {
  return db
    .select({ dataAnalysis: schema.dataAnalysis, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.dataAnalysis)
    .innerJoin(schema.user, eq(schema.dataAnalysis.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.dataAnalysis.id, id))
    .limit(1)
}

function selectAssets(dataAnalysisId: number) {
  return db
    .select({ id: schema.dataAnalysisAsset.id, name: schema.dataAnalysisAsset.name, size: schema.dataAnalysisAsset.size })
    .from(schema.dataAnalysisAsset)
    .where(eq(schema.dataAnalysisAsset.dataAnalysisId, dataAnalysisId))
    .orderBy(asc(schema.dataAnalysisAsset.name))
}

async function serializeDataAnalysis(id: number): Promise<AdminDataAnalysis | null> {
  const [row] = await selectDataAnalysis(id)
  if (!row) return null
  const [steps, assets] = await Promise.all([
    db
      .select()
      .from(schema.dataAnalysisStep)
      .where(eq(schema.dataAnalysisStep.dataAnalysisId, id))
      .orderBy(asc(schema.dataAnalysisStep.order), asc(schema.dataAnalysisStep.id)),
    selectAssets(id),
  ])
  return {
    id: row.dataAnalysis.id,
    title: row.dataAnalysis.title,
    description: row.dataAnalysis.description,
    isPublic: row.dataAnalysis.isPublic,
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
    assets: assets satisfies DataAnalysisAsset[],
    createdBy: sampleUser(row.user, row.realName),
    createdAt: row.dataAnalysis.createdAt,
    updatedAt: row.dataAnalysis.updatedAt,
  } satisfies AdminDataAnalysis
}

const stepCountColumn = sql<number>`(select count(*) from "data_analysis_step" s where s."data_analysis_id" = "data_analysis"."id")`.mapWith(Number)

adminDataAnalysisRoutes.get('/data-analyses', requireTeacher, async (c) => {
  const [rows, studentRows] = await Promise.all([
    db
      .select({ dataAnalysis: schema.dataAnalysis, user: schema.user, realName: schema.userProfile.realName, stepCount: stepCountColumn })
      .from(schema.dataAnalysis)
      .innerJoin(schema.user, eq(schema.dataAnalysis.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .orderBy(asc(schema.dataAnalysis.order), asc(schema.dataAnalysis.id)),
    // 动过手的学生数：老师自己试的不算
    db
      .select({ dataAnalysisId: schema.dataAnalysisProgress.dataAnalysisId, students: countDistinct(schema.dataAnalysisProgress.userId) })
      .from(schema.dataAnalysisProgress)
      .innerJoin(schema.user, eq(schema.user.id, schema.dataAnalysisProgress.userId))
      .where(inArray(schema.user.adminType, [...STUDENT_ROLES]))
      .groupBy(schema.dataAnalysisProgress.dataAnalysisId),
  ])
  const students = new Map(studentRows.map((r) => [r.dataAnalysisId, r.students]))
  return success(
    c,
    rows.map(
      (r) =>
        ({
          id: r.dataAnalysis.id,
          title: r.dataAnalysis.title,
          isPublic: r.dataAnalysis.isPublic,
          stepCount: r.stepCount,
          students: students.get(r.dataAnalysis.id) ?? 0,
          createdBy: sampleUser(r.user, r.realName),
          updatedAt: r.dataAnalysis.updatedAt,
        }) satisfies AdminDataAnalysisListItem,
    ),
  )
})

/** 新建只要一个标题：建好就进编辑页，素材要挂在已经存在的一节下面 */
adminDataAnalysisRoutes.post('/data-analyses', requireTeacher, async (c) => {
  const parsed = await parseBody(c, createDataAnalysisRequestSchema)
  if (!parsed.success) return parsed.response
  const now = new Date().toISOString()
  // 新建的排最后
  const [created] = await db
    .insert(schema.dataAnalysis)
    .values({
      title: parsed.data.title,
      order: sql`(select coalesce(max("order"), 0) + 1 from "data_analysis")`,
      createdById: c.get('user')!.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.dataAnalysis.id })
  return success(c, (await serializeDataAnalysis(created!.id))!, 201)
})

/** 拖动排序。路径不叫 /data-analyses/order：会和下面的 /data-analyses/:id 撞 */
adminDataAnalysisRoutes.put('/data-analysis-order', requireTeacher, async (c) => {
  const parsed = await parseBody(c, reorderDataAnalysesRequestSchema)
  if (!parsed.success) return parsed.response
  await db.transaction(async (tx) => {
    for (const [index, id] of parsed.data.ids.entries()) {
      // 排序不是内容修改，不动 updatedAt
      await tx
        .update(schema.dataAnalysis)
        .set({ order: index + 1 })
        .where(eq(schema.dataAnalysis.id, id))
    }
  })
  return success(c, null)
})

adminDataAnalysisRoutes.get('/data-analyses/:id', requireTeacher, async (c) => {
  const dataAnalysis = await serializeDataAnalysis(queryInteger(c.req.param('id'), 0, { min: 1 }))
  if (!dataAnalysis) return failure(c, 404, 'data-analysis-not-found', '这一节不存在')
  return success(c, dataAnalysis)
})

/**
 * 整节一起存（出题页只有一个「保存」）。步骤按数组顺序排：带 id 的改、不带的建、
 * 原来有而这次没出现的删掉 —— 学生在那一步的进度跟着没（data_analysis_progress.step_id CASCADE）。
 */
adminDataAnalysisRoutes.put('/data-analyses/:id', requireTeacher, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, saveDataAnalysisRequestSchema)
  if (!parsed.success) return parsed.response
  const { steps, ...dataAnalysis } = parsed.data
  for (const [index, step] of steps.entries()) {
    const error = dataAnalysisStepError(step, index)
    if (error) return failure(c, 400, 'invalid-step', error)
  }
  const existing = await db.select({ id: schema.dataAnalysisStep.id }).from(schema.dataAnalysisStep).where(eq(schema.dataAnalysisStep.dataAnalysisId, id))
  const existingIds = new Set(existing.map((s) => s.id))
  if (steps.some((s) => s.id !== undefined && !existingIds.has(s.id))) {
    return failure(c, 409, 'stale-steps', '有的步骤已经被别人删掉了，刷新一下再改')
  }

  const ok = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.dataAnalysis)
      .set({ ...dataAnalysis, updatedAt: new Date().toISOString() })
      .where(eq(schema.dataAnalysis.id, id))
      .returning({ id: schema.dataAnalysis.id })
    if (!updated.length) return false
    const keep = steps.flatMap((s) => (s.id === undefined ? [] : [s.id]))
    const removed = [...existingIds].filter((stepId) => !keep.includes(stepId))
    if (removed.length) await tx.delete(schema.dataAnalysisStep).where(inArray(schema.dataAnalysisStep.id, removed))
    for (const [order, { id: stepId, ...step }] of steps.entries()) {
      if (stepId === undefined) {
        await tx.insert(schema.dataAnalysisStep).values({ ...step, dataAnalysisId: id, order })
      } else {
        await tx
          .update(schema.dataAnalysisStep)
          .set({ ...step, order })
          .where(and(eq(schema.dataAnalysisStep.id, stepId), eq(schema.dataAnalysisStep.dataAnalysisId, id)))
      }
    }
    return true
  })
  if (!ok) return failure(c, 404, 'data-analysis-not-found', '这一节不存在')
  return success(c, (await serializeDataAnalysis(id))!)
})

adminDataAnalysisRoutes.delete('/data-analyses/:id', requireTeacher, async (c) => {
  // 步骤、素材、学生进度都随这一节一起没（data_analysis_id 全是 CASCADE）
  const deleted = await db
    .delete(schema.dataAnalysis)
    .where(eq(schema.dataAnalysis.id, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .returning({ id: schema.dataAnalysis.id })
  if (!deleted.length) return failure(c, 404, 'data-analysis-not-found', '这一节不存在')
  return success(c, null)
})

// ---------------------------------------------------------------- 素材

/** 上传即生效，不等「保存」。同名的覆盖（删旧的、插新的，新 id）。 */
adminDataAnalysisRoutes.post('/data-analyses/:id/assets', requireTeacher, async (c) => {
  const dataAnalysisId = queryInteger(c.req.param('id'), 0, { min: 1 })
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return failure(c, 400, 'invalid-request', '没收到文件')
  const nameError = dataAnalysisAssetNameError(file.name)
  if (nameError) return failure(c, 400, 'invalid-asset', nameError)
  if (file.size > DATA_ANALYSIS_ASSET_MAX_BYTES) return failure(c, 400, 'asset-too-large', `一个文件最大 ${DATA_ANALYSIS_ASSET_MAX_BYTES / 1024 / 1024}MB`)
  const [dataAnalysis] = await db.select({ id: schema.dataAnalysis.id }).from(schema.dataAnalysis).where(eq(schema.dataAnalysis.id, dataAnalysisId)).limit(1)
  if (!dataAnalysis) return failure(c, 404, 'data-analysis-not-found', '这一节不存在')
  const [others] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.dataAnalysisAsset.size}), 0)`.mapWith(Number) })
    .from(schema.dataAnalysisAsset)
    .where(and(eq(schema.dataAnalysisAsset.dataAnalysisId, dataAnalysisId), ne(schema.dataAnalysisAsset.name, file.name)))
  if ((others?.total ?? 0) + file.size > DATA_ANALYSIS_ASSETS_MAX_TOTAL_BYTES) {
    return failure(c, 400, 'asset-too-large', `一节的素材加起来最大 ${DATA_ANALYSIS_ASSETS_MAX_TOTAL_BYTES / 1024 / 1024}MB`)
  }
  const data = Buffer.from(await file.arrayBuffer())
  const created = await db.transaction(async (tx) => {
    await tx
      .delete(schema.dataAnalysisAsset)
      .where(and(eq(schema.dataAnalysisAsset.dataAnalysisId, dataAnalysisId), eq(schema.dataAnalysisAsset.name, file.name)))
    const [row] = await tx
      .insert(schema.dataAnalysisAsset)
      .values({ dataAnalysisId, name: file.name, size: data.length, data, createdAt: new Date().toISOString() })
      .returning({ id: schema.dataAnalysisAsset.id, name: schema.dataAnalysisAsset.name, size: schema.dataAnalysisAsset.size })
    return row!
  })
  return success(c, created satisfies DataAnalysisAsset, 201)
})

adminDataAnalysisRoutes.delete('/data-analyses/:id/assets/:assetId', requireTeacher, async (c) => {
  const deleted = await db
    .delete(schema.dataAnalysisAsset)
    .where(
      and(
        eq(schema.dataAnalysisAsset.id, queryInteger(c.req.param('assetId'), 0, { min: 1 })),
        eq(schema.dataAnalysisAsset.dataAnalysisId, queryInteger(c.req.param('id'), 0, { min: 1 })),
      ),
    )
    .returning({ id: schema.dataAnalysisAsset.id })
  if (!deleted.length) return failure(c, 404, 'asset-not-found', '这个素材不存在')
  return success(c, null)
})

async function findAsset(c: Context<AppEnv>) {
  const [asset] = await db
    .select({ id: schema.dataAnalysisAsset.id, name: schema.dataAnalysisAsset.name, dataAnalysisId: schema.dataAnalysisAsset.dataAnalysisId })
    .from(schema.dataAnalysisAsset)
    .where(
      and(
        eq(schema.dataAnalysisAsset.id, queryInteger(c.req.param('assetId'), 0, { min: 1 })),
        eq(schema.dataAnalysisAsset.dataAnalysisId, queryInteger(c.req.param('id'), 0, { min: 1 })),
      ),
    )
    .limit(1)
  return asset
}

adminDataAnalysisRoutes.get('/data-analyses/:id/assets/:assetId/preview', requireTeacher, async (c) => {
  const asset = await findAsset(c)
  if (!asset) return failure(c, 404, 'asset-not-found', '这个素材不存在')
  try {
    return success(c, (await dataAnalysisAssetPreview(asset.dataAnalysisId, asset)) satisfies DataAnalysisAssetPreview)
  } catch (error) {
    console.error('DataAnalysis asset preview failed', error)
    return failure(c, 502, 'data-analysis-unavailable', '运行器暂时连不上')
  }
})

adminDataAnalysisRoutes.get('/data-analyses/:id/assets/:assetId/file', requireTeacher, async (c) => {
  const asset = await findAsset(c)
  if (!asset) return failure(c, 404, 'asset-not-found', '这个素材不存在')
  const [row] = await db.select({ data: schema.dataAnalysisAsset.data }).from(schema.dataAnalysisAsset).where(eq(schema.dataAnalysisAsset.id, asset.id))
  return new Response(new Uint8Array(row!.data), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
    },
  })
})

// ---------------------------------------------------------------- 试跑

/** 出题页「试跑这一步」：用编辑器里还没存的答案，从第 1 步跑到这一步（设计文档第 6 节）。 */
adminDataAnalysisRoutes.post('/data-analyses/:id/trial', requireTeacher, async (c) => {
  const dataAnalysisId = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, dataAnalysisTrialRequestSchema)
  if (!parsed.success) return parsed.response
  const { steps, index } = parsed.data
  if (index >= steps.length) return failure(c, 400, 'invalid-request', '没有这一步')
  const error = dataAnalysisStepError(steps[index]!, index)
  if (error) return failure(c, 400, 'invalid-step', error)
  const [dataAnalysis] = await db.select({ id: schema.dataAnalysis.id }).from(schema.dataAnalysis).where(eq(schema.dataAnalysis.id, dataAnalysisId)).limit(1)
  if (!dataAnalysis) return failure(c, 404, 'data-analysis-not-found', '这一节不存在')
  try {
    const result = await runDataAnalysis(c.get('user')!.id, buildRunRequest(steps, index, await dataAnalysisAssetsPayload(dataAnalysisId)))
    return success(c, result satisfies DataAnalysisRunResult)
  } catch (err) {
    if (err instanceof DataAnalysisBusyError) return failure(c, 429, 'data-analysis-busy', '上一次还没跑完，稍等一下')
    if (err instanceof DataAnalysisTooLongError)
      return failure(c, 400, 'data-analysis-code-too-long', '到这一步为止的答案加起来太长了（运行器一次最多收 20 万字）')
    if (err instanceof DataAnalysisRunnerError) {
      console.error('DataAnalysis trial failed', err.message)
      return failure(c, 502, 'data-analysis-unavailable', '运行器暂时连不上')
    }
    throw err
  }
})

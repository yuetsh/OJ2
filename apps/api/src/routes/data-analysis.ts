/**
 * 「数据分析」学生这边：列表、一节、自动保存代码、运行、交开放步骤、素材。
 * 设计见 docs/specs/2026-11-12-data-analysis-design.md；样子照画布 DataAnalysisStudent。
 *
 * 没公开的一节只有老师进得去（拿来预览）。运行不是提交：data_analysis_progress 只记最新代码、
 * 运行次数、第一次做对的时间和最近一次没过的原因（进度页按它分组），不留每次运行的流水。
 */
import {
  STUDENT_ROLES,
  TEACHER_ROLES,
  runDataAnalysisStepRequestSchema,
  saveDataAnalysisCodeRequestSchema,
  submitDataAnalysisOpenRequestSchema,
  type DataAnalysisAssetPreview,
  type DataAnalysisDetail,
  type DataAnalysisListItem,
  type DataAnalysisProgress,
  type DataAnalysisRunResult,
  type DataAnalysisStepRunResponse,
  type DataAnalysisStudentWork,
} from '@oj2/contract'
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'

import { optionalAuth, requireAuth, requireTeacher, type AppEnv } from '../auth/middleware'
import { db, schema } from '../db'
import { failure, parseBody, success } from '../http'
import { suggestActiveClass } from '../services/class-activity'
import {
  DataAnalysisBusyError,
  DataAnalysisRunnerError,
  buildRunRequest,
  dataAnalysisAssetPreview,
  dataAnalysisAssetsPayload,
  runDataAnalysis,
} from '../services/data-analysis'
import { queryInteger } from './helpers'

export const dataAnalysisRoutes = new Hono<AppEnv>()

function isTeacher(c: Context<AppEnv>) {
  const user = c.get('user')
  return !!user && TEACHER_ROLES.includes(user.adminType)
}

/** 这一节：学生只能看公开的，老师都能看 */
async function findDataAnalysis(c: Context<AppEnv>) {
  const [dataAnalysis] = await db
    .select()
    .from(schema.dataAnalysis)
    .where(eq(schema.dataAnalysis.id, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .limit(1)
  if (!dataAnalysis || (!dataAnalysis.isPublic && !isTeacher(c))) return null
  return dataAnalysis
}

function dataAnalysisSteps(dataAnalysisId: number) {
  return db
    .select()
    .from(schema.dataAnalysisStep)
    .where(eq(schema.dataAnalysisStep.dataAnalysisId, dataAnalysisId))
    .orderBy(asc(schema.dataAnalysisStep.order), asc(schema.dataAnalysisStep.id))
}

dataAnalysisRoutes.get('/data-analyses', optionalAuth, async (c) => {
  const user = c.get('user')
  const passed = user
    ? db
        .select({ dataAnalysisId: schema.dataAnalysisProgress.dataAnalysisId, count: sql<number>`count(*)`.mapWith(Number).as('count') })
        .from(schema.dataAnalysisProgress)
        .where(and(eq(schema.dataAnalysisProgress.userId, user.id), isNotNull(schema.dataAnalysisProgress.passedAt)))
        .groupBy(schema.dataAnalysisProgress.dataAnalysisId)
        .as('passed')
    : null
  const stepCount = sql<number>`(select count(*) from "data_analysis_step" s where s."data_analysis_id" = "data_analysis"."id")`.mapWith(Number)
  const query = db
    .select({
      id: schema.dataAnalysis.id,
      title: schema.dataAnalysis.title,
      isPublic: schema.dataAnalysis.isPublic,
      stepCount,
      passedCount: passed ? sql<number>`coalesce(${passed.count}, 0)`.mapWith(Number) : sql<number>`0`.mapWith(Number),
    })
    .from(schema.dataAnalysis)
  const rows = await (passed ? query.leftJoin(passed, eq(passed.dataAnalysisId, schema.dataAnalysis.id)) : query)
    .where(isTeacher(c) ? undefined : eq(schema.dataAnalysis.isPublic, true))
    .orderBy(asc(schema.dataAnalysis.order), asc(schema.dataAnalysis.id))
  return success(c, rows satisfies DataAnalysisListItem[])
})

dataAnalysisRoutes.get('/data-analyses/:id', optionalAuth, async (c) => {
  const dataAnalysis = await findDataAnalysis(c)
  if (!dataAnalysis) return failure(c, 404, 'data-analysis-not-found', '这一节不存在')
  const user = c.get('user')
  const teacher = isTeacher(c)
  const [steps, assets, progress] = await Promise.all([
    dataAnalysisSteps(dataAnalysis.id),
    db
      .select({ id: schema.dataAnalysisAsset.id, name: schema.dataAnalysisAsset.name, size: schema.dataAnalysisAsset.size })
      .from(schema.dataAnalysisAsset)
      .where(eq(schema.dataAnalysisAsset.dataAnalysisId, dataAnalysis.id))
      .orderBy(asc(schema.dataAnalysisAsset.name)),
    user
      ? db
          .select()
          .from(schema.dataAnalysisProgress)
          .where(and(eq(schema.dataAnalysisProgress.dataAnalysisId, dataAnalysis.id), eq(schema.dataAnalysisProgress.userId, user.id)))
      : Promise.resolve([]),
  ])
  const mine = new Map(progress.map((p) => [p.stepId, p]))
  return success(c, {
    id: dataAnalysis.id,
    title: dataAnalysis.title,
    description: dataAnalysis.description,
    isPublic: dataAnalysis.isPublic,
    assets,
    steps: steps.map((s) => {
      const p = mine.get(s.id)
      const passed = !!p?.passedAt
      return {
        id: s.id,
        kind: s.kind,
        title: s.title,
        description: s.description,
        starterCode: s.starterCode,
        checkKind: s.checkKind,
        code: p ? p.code : null,
        passed,
        runs: p?.runs ?? 0,
        referenceCode: s.kind === 'normal' && (passed || teacher) && s.referenceCode.trim() ? s.referenceCode : null,
        openText: p?.openText ?? null,
        submittedAt: p?.submittedAt ?? null,
      }
    }),
  } satisfies DataAnalysisDetail)
})

/** 找到这一节里的这一步，以及它前面（含它）的全部步骤 */
async function findStep(c: Context<AppEnv>) {
  const dataAnalysis = await findDataAnalysis(c)
  if (!dataAnalysis) return null
  const steps = await dataAnalysisSteps(dataAnalysis.id)
  const index = steps.findIndex((s) => s.id === queryInteger(c.req.param('stepId'), 0, { min: 1 }))
  if (index < 0) return null
  return { dataAnalysis, steps, index, step: steps[index]! }
}

/** 存第 1…k 步的代码（只改代码，不碰对错） */
async function saveCodes(userId: number, dataAnalysisId: number, steps: { id: number }[], codes: string[]) {
  const now = new Date().toISOString()
  await db
    .insert(schema.dataAnalysisProgress)
    .values(codes.map((code, i) => ({ userId, stepId: steps[i]!.id, dataAnalysisId, code, updatedAt: now })))
    .onConflictDoUpdate({
      target: [schema.dataAnalysisProgress.userId, schema.dataAnalysisProgress.stepId],
      set: { code: sql`excluded.code`, updatedAt: now },
    })
}

dataAnalysisRoutes.put('/data-analyses/:id/steps/:stepId/code', requireAuth, async (c) => {
  const found = await findStep(c)
  if (!found) return failure(c, 404, 'data-analysis-step-not-found', '这一步不存在')
  const parsed = await parseBody(c, saveDataAnalysisCodeRequestSchema)
  if (!parsed.success) return parsed.response
  await saveCodes(c.get('user')!.id, found.dataAnalysis.id, [found.step], [parsed.data.code])
  return success(c, null)
})

function runFailure(c: Context<AppEnv>, err: unknown) {
  if (err instanceof DataAnalysisBusyError) return failure(c, 429, 'data-analysis-busy', '上一次还没跑完，稍等一下')
  if (err instanceof DataAnalysisRunnerError) {
    console.error('DataAnalysis run failed', err.message)
    return failure(c, 502, 'data-analysis-unavailable', '运行器暂时连不上，过一会儿再点')
  }
  throw err
}

/** 进度页分组用的那句话：没过的头一条说法；报错记成 error:异常名（前端翻成中文）；答案自己有问题不算学生的 */
function failureOf(result: DataAnalysisRunResult): string | null {
  if (result.referenceError) return null
  if (result.error) return `error:${result.error.type}`
  if (result.check && !result.check.passed) return result.check.messages[0] ?? '还没对'
  return null
}

dataAnalysisRoutes.post('/data-analyses/:id/steps/:stepId/run', requireAuth, async (c) => {
  const found = await findStep(c)
  if (!found) return failure(c, 404, 'data-analysis-step-not-found', '这一步不存在')
  const parsed = await parseBody(c, runDataAnalysisStepRequestSchema)
  if (!parsed.success) return parsed.response
  const { dataAnalysis, steps, index, step } = found
  const codes = parsed.data.codes
  if (codes.length !== index + 1) return failure(c, 400, 'invalid-request', '代码的步数对不上，刷新一下')
  const user = c.get('user')!

  let result: DataAnalysisRunResult
  try {
    result = await runDataAnalysis(user.id, buildRunRequest(steps, index, await dataAnalysisAssetsPayload(dataAnalysis.id), codes))
  } catch (err) {
    return runFailure(c, err)
  }
  // 检查脚本自己出的错是给老师看的
  if (result.check?.scriptError && !isTeacher(c)) {
    const { scriptError: _hidden, ...check } = result.check
    result = { ...result, check }
  }
  const passed = step.kind === 'normal' && result.ok && !result.referenceError && result.check?.passed === true

  await saveCodes(user.id, dataAnalysis.id, steps, codes)
  const now = new Date().toISOString()
  await db
    .update(schema.dataAnalysisProgress)
    .set({
      runs: sql`${schema.dataAnalysisProgress.runs} + 1`,
      lastRunAt: now,
      // 第一次做对的时间，之后再跑错也不收回
      ...(passed ? { passedAt: sql`coalesce(${schema.dataAnalysisProgress.passedAt}, ${now})` } : {}),
      ...(step.kind === 'normal' ? { lastFailure: failureOf(result) } : {}),
    })
    .where(and(eq(schema.dataAnalysisProgress.userId, user.id), eq(schema.dataAnalysisProgress.stepId, step.id)))

  return success(c, {
    ...result,
    passed,
    referenceCode: passed && step.referenceCode.trim() ? step.referenceCode : null,
  } satisfies DataAnalysisStepRunResponse)
})

/** 开放步骤交上去：一句话 + 交的那一刻的代码。交了就算这一步完成，可以改了再交 */
dataAnalysisRoutes.post('/data-analyses/:id/steps/:stepId/submit', requireAuth, async (c) => {
  const found = await findStep(c)
  if (!found) return failure(c, 404, 'data-analysis-step-not-found', '这一步不存在')
  if (found.step.kind !== 'open') return failure(c, 400, 'not-open-step', '这一步不用交')
  const parsed = await parseBody(c, submitDataAnalysisOpenRequestSchema)
  if (!parsed.success) return parsed.response
  const { dataAnalysis, steps, index, step } = found
  const { codes, text } = parsed.data
  if (codes.length !== index + 1) return failure(c, 400, 'invalid-request', '代码的步数对不上，刷新一下')
  const user = c.get('user')!
  await saveCodes(user.id, dataAnalysis.id, steps, codes)
  const now = new Date().toISOString()
  await db
    .update(schema.dataAnalysisProgress)
    .set({
      openText: text,
      openCode: codes[index]!,
      submittedAt: now,
      passedAt: sql`coalesce(${schema.dataAnalysisProgress.passedAt}, ${now})`,
    })
    .where(and(eq(schema.dataAnalysisProgress.userId, user.id), eq(schema.dataAnalysisProgress.stepId, step.id)))
  return success(c, { submittedAt: now })
})

// ---------------------------------------------------------------- 素材

async function findAsset(c: Context<AppEnv>) {
  const dataAnalysis = await findDataAnalysis(c)
  if (!dataAnalysis) return null
  const [asset] = await db
    .select({ id: schema.dataAnalysisAsset.id, name: schema.dataAnalysisAsset.name, dataAnalysisId: schema.dataAnalysisAsset.dataAnalysisId })
    .from(schema.dataAnalysisAsset)
    .where(
      and(eq(schema.dataAnalysisAsset.id, queryInteger(c.req.param('assetId'), 0, { min: 1 })), eq(schema.dataAnalysisAsset.dataAnalysisId, dataAnalysis.id)),
    )
    .limit(1)
  return asset ?? null
}

dataAnalysisRoutes.get('/data-analyses/:id/assets/:assetId/preview', optionalAuth, async (c) => {
  const asset = await findAsset(c)
  if (!asset) return failure(c, 404, 'asset-not-found', '这个素材不存在')
  try {
    return success(c, (await dataAnalysisAssetPreview(asset.dataAnalysisId, asset)) satisfies DataAnalysisAssetPreview)
  } catch (err) {
    return runFailure(c, err instanceof DataAnalysisRunnerError ? err : new DataAnalysisRunnerError(String(err)))
  }
})

dataAnalysisRoutes.get('/data-analyses/:id/assets/:assetId/file', optionalAuth, async (c) => {
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

// ---------------------------------------------------------------- 老师：全班进度（画布 DataAnalysisProgress）

/**
 * 一个班在这一节上的进度。不指定班：先看做过这一节的班里人最多的，没人做过就猜正在上课的班。
 * 分组（卡在第几步、卡在哪条检查）在前端做 —— 口径要随界面调，放前端改起来不用动接口。
 */
dataAnalysisRoutes.get('/data-analyses/:id/progress', requireTeacher, async (c) => {
  const dataAnalysis = await findDataAnalysis(c)
  if (!dataAnalysis) return failure(c, 404, 'data-analysis-not-found', '这一节不存在')
  const users = sql<number>`count(distinct ${schema.dataAnalysisProgress.userId})::int`
  const [steps, classRows] = await Promise.all([
    dataAnalysisSteps(dataAnalysis.id),
    db
      .select({ className: schema.user.className, users })
      .from(schema.dataAnalysisProgress)
      .innerJoin(schema.user, eq(schema.user.id, schema.dataAnalysisProgress.userId))
      .where(
        and(
          eq(schema.dataAnalysisProgress.dataAnalysisId, dataAnalysis.id),
          isNotNull(schema.user.className),
          inArray(schema.user.adminType, [...STUDENT_ROLES]),
        ),
      )
      .groupBy(schema.user.className)
      .orderBy(desc(users)),
  ])
  const classes = classRows.flatMap((r) => (r.className ? [r.className] : []))
  const className = c.req.query('className')?.trim() || classes[0] || (await suggestActiveClass())

  const students = className
    ? await db
        .select({ id: schema.user.id, username: schema.user.username, className: schema.user.className })
        .from(schema.user)
        .where(and(eq(schema.user.className, className), eq(schema.user.isDisabled, false), inArray(schema.user.adminType, [...STUDENT_ROLES])))
        .orderBy(asc(schema.user.username))
    : []
  const progress = students.length
    ? await db
        .select()
        .from(schema.dataAnalysisProgress)
        .where(
          and(
            eq(schema.dataAnalysisProgress.dataAnalysisId, dataAnalysis.id),
            inArray(
              schema.dataAnalysisProgress.userId,
              students.map((s) => s.id),
            ),
          ),
        )
    : []
  const cell = new Map(progress.map((p) => [`${p.userId}:${p.stepId}`, p]))
  return success(c, {
    className,
    classes,
    steps: steps.map((s) => ({ id: s.id, title: s.title, kind: s.kind })),
    students: students.map((u) => ({
      ...u,
      steps: steps.map((s) => {
        const p = cell.get(`${u.id}:${s.id}`)
        return {
          passed: !!p?.passedAt,
          runs: p?.runs ?? 0,
          lastFailure: p?.passedAt ? null : (p?.lastFailure ?? null),
          lastRunAt: p?.lastRunAt ?? null,
          passedAt: p?.passedAt ?? null,
          submittedAt: p?.submittedAt ?? null,
        }
      }),
    })),
  } satisfies DataAnalysisProgress)
})

async function studentRows(dataAnalysisId: number, userId: number) {
  const rows = await db
    .select()
    .from(schema.dataAnalysisProgress)
    .where(and(eq(schema.dataAnalysisProgress.dataAnalysisId, dataAnalysisId), eq(schema.dataAnalysisProgress.userId, userId)))
  return new Map(rows.map((r) => [r.stepId, r]))
}

dataAnalysisRoutes.get('/data-analyses/:id/progress/:userId', requireTeacher, async (c) => {
  const dataAnalysis = await findDataAnalysis(c)
  if (!dataAnalysis) return failure(c, 404, 'data-analysis-not-found', '这一节不存在')
  const [steps, rows] = await Promise.all([
    dataAnalysisSteps(dataAnalysis.id),
    studentRows(dataAnalysis.id, queryInteger(c.req.param('userId'), 0, { min: 1 })),
  ])
  return success(c, {
    steps: steps.map((s) => {
      const p = rows.get(s.id)
      return { code: p?.code ?? null, openText: p?.openText ?? null, openCode: p?.openCode ?? null }
    }),
  } satisfies DataAnalysisStudentWork)
})

/**
 * 老师看一个学生的某一步：拿他存着的代码现跑（运行结果不存，见 data_analysis_progress 的注释）。
 * 开放步骤交过的，跑交的那一份；没动过的步骤用初始代码。
 */
dataAnalysisRoutes.post('/data-analyses/:id/progress/:userId/steps/:stepId/run', requireTeacher, async (c) => {
  const found = await findStep(c)
  if (!found) return failure(c, 404, 'data-analysis-step-not-found', '这一步不存在')
  const { dataAnalysis, steps, index } = found
  const rows = await studentRows(dataAnalysis.id, queryInteger(c.req.param('userId'), 0, { min: 1 }))
  const codes = steps.slice(0, index + 1).map((s) => {
    const p = rows.get(s.id)
    return (s.kind === 'open' && p?.openCode) || (p ? p.code : s.starterCode)
  })
  try {
    const result = await runDataAnalysis(c.get('user')!.id, buildRunRequest(steps, index, await dataAnalysisAssetsPayload(dataAnalysis.id), codes))
    return success(c, result satisfies DataAnalysisRunResult)
  } catch (err) {
    return runFailure(c, err)
  }
})

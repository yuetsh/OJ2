/**
 * 「数据分析」学生这边：列表、一节、自动保存代码、运行、交开放步骤、素材。
 * 设计见 docs/specs/2026-11-12-data-analysis-lab-design.md；样子照画布 LabStudent。
 *
 * 没公开的一节只有老师进得去（拿来预览）。运行不是提交：lab_progress 只记最新代码、
 * 运行次数、第一次做对的时间和最近一次没过的原因（进度页按它分组），不留每次运行的流水。
 */
import {
  STUDENT_ROLES,
  TEACHER_ROLES,
  runLabStepRequestSchema,
  saveLabCodeRequestSchema,
  submitLabOpenRequestSchema,
  type LabAssetPreview,
  type LabDetail,
  type LabListItem,
  type LabProgress,
  type LabRunResult,
  type LabStepRunResponse,
  type LabStudentWork,
} from '@oj2/contract'
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'

import { optionalAuth, requireAuth, requireTeacher, type AppEnv } from '../auth/middleware'
import { db, schema } from '../db'
import { failure, parseBody, success } from '../http'
import { suggestActiveClass } from '../services/class-activity'
import { LabBusyError, LabRunnerError, buildRunRequest, labAssetPreview, labAssetsPayload, runLab } from '../services/lab'
import { queryInteger } from './helpers'

export const labRoutes = new Hono<AppEnv>()

function isTeacher(c: Context<AppEnv>) {
  const user = c.get('user')
  return !!user && TEACHER_ROLES.includes(user.adminType)
}

/** 这一节：学生只能看公开的，老师都能看 */
async function findLab(c: Context<AppEnv>) {
  const [lab] = await db
    .select()
    .from(schema.lab)
    .where(eq(schema.lab.id, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .limit(1)
  if (!lab || (!lab.isPublic && !isTeacher(c))) return null
  return lab
}

function labSteps(labId: number) {
  return db.select().from(schema.labStep).where(eq(schema.labStep.labId, labId)).orderBy(asc(schema.labStep.order), asc(schema.labStep.id))
}

labRoutes.get('/labs', optionalAuth, async (c) => {
  const user = c.get('user')
  const passed = user
    ? db
        .select({ labId: schema.labProgress.labId, count: sql<number>`count(*)`.mapWith(Number).as('count') })
        .from(schema.labProgress)
        .where(and(eq(schema.labProgress.userId, user.id), isNotNull(schema.labProgress.passedAt)))
        .groupBy(schema.labProgress.labId)
        .as('passed')
    : null
  const stepCount = sql<number>`(select count(*) from "lab_step" s where s."lab_id" = "lab"."id")`.mapWith(Number)
  const query = db
    .select({
      id: schema.lab.id,
      title: schema.lab.title,
      isPublic: schema.lab.isPublic,
      stepCount,
      passedCount: passed ? sql<number>`coalesce(${passed.count}, 0)`.mapWith(Number) : sql<number>`0`.mapWith(Number),
    })
    .from(schema.lab)
  const rows = await (passed ? query.leftJoin(passed, eq(passed.labId, schema.lab.id)) : query)
    .where(isTeacher(c) ? undefined : eq(schema.lab.isPublic, true))
    .orderBy(desc(schema.lab.createdAt))
  return success(c, rows satisfies LabListItem[])
})

labRoutes.get('/labs/:id', optionalAuth, async (c) => {
  const lab = await findLab(c)
  if (!lab) return failure(c, 404, 'lab-not-found', '这一节不存在')
  const user = c.get('user')
  const teacher = isTeacher(c)
  const [steps, assets, progress] = await Promise.all([
    labSteps(lab.id),
    db
      .select({ id: schema.labAsset.id, name: schema.labAsset.name, size: schema.labAsset.size })
      .from(schema.labAsset)
      .where(eq(schema.labAsset.labId, lab.id))
      .orderBy(asc(schema.labAsset.name)),
    user
      ? db
          .select()
          .from(schema.labProgress)
          .where(and(eq(schema.labProgress.labId, lab.id), eq(schema.labProgress.userId, user.id)))
      : Promise.resolve([]),
  ])
  const mine = new Map(progress.map((p) => [p.stepId, p]))
  return success(c, {
    id: lab.id,
    title: lab.title,
    description: lab.description,
    isPublic: lab.isPublic,
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
  } satisfies LabDetail)
})

/** 找到这一节里的这一步，以及它前面（含它）的全部步骤 */
async function findStep(c: Context<AppEnv>) {
  const lab = await findLab(c)
  if (!lab) return null
  const steps = await labSteps(lab.id)
  const index = steps.findIndex((s) => s.id === queryInteger(c.req.param('stepId'), 0, { min: 1 }))
  if (index < 0) return null
  return { lab, steps, index, step: steps[index]! }
}

/** 存第 1…k 步的代码（只改代码，不碰对错） */
async function saveCodes(userId: number, labId: number, steps: { id: number }[], codes: string[]) {
  const now = new Date().toISOString()
  await db
    .insert(schema.labProgress)
    .values(codes.map((code, i) => ({ userId, stepId: steps[i]!.id, labId, code, updatedAt: now })))
    .onConflictDoUpdate({
      target: [schema.labProgress.userId, schema.labProgress.stepId],
      set: { code: sql`excluded.code`, updatedAt: now },
    })
}

labRoutes.put('/labs/:id/steps/:stepId/code', requireAuth, async (c) => {
  const found = await findStep(c)
  if (!found) return failure(c, 404, 'lab-step-not-found', '这一步不存在')
  const parsed = await parseBody(c, saveLabCodeRequestSchema)
  if (!parsed.success) return parsed.response
  await saveCodes(c.get('user')!.id, found.lab.id, [found.step], [parsed.data.code])
  return success(c, null)
})

function runFailure(c: Context<AppEnv>, err: unknown) {
  if (err instanceof LabBusyError) return failure(c, 429, 'lab-busy', '上一次还没跑完，稍等一下')
  if (err instanceof LabRunnerError) {
    console.error('Lab run failed', err.message)
    return failure(c, 502, 'lab-unavailable', '运行器暂时连不上，过一会儿再点')
  }
  throw err
}

/** 进度页分组用的那句话：没过的头一条说法；报错记成 error:异常名（前端翻成中文）；答案自己有问题不算学生的 */
function failureOf(result: LabRunResult): string | null {
  if (result.referenceError) return null
  if (result.error) return `error:${result.error.type}`
  if (result.check && !result.check.passed) return result.check.messages[0] ?? '还没对'
  return null
}

labRoutes.post('/labs/:id/steps/:stepId/run', requireAuth, async (c) => {
  const found = await findStep(c)
  if (!found) return failure(c, 404, 'lab-step-not-found', '这一步不存在')
  const parsed = await parseBody(c, runLabStepRequestSchema)
  if (!parsed.success) return parsed.response
  const { lab, steps, index, step } = found
  const codes = parsed.data.codes
  if (codes.length !== index + 1) return failure(c, 400, 'invalid-request', '代码的步数对不上，刷新一下')
  const user = c.get('user')!

  let result: LabRunResult
  try {
    result = await runLab(user.id, buildRunRequest(steps, index, await labAssetsPayload(lab.id), codes))
  } catch (err) {
    return runFailure(c, err)
  }
  // 检查脚本自己出的错是给老师看的
  if (result.check?.scriptError && !isTeacher(c)) {
    const { scriptError: _hidden, ...check } = result.check
    result = { ...result, check }
  }
  const passed = step.kind === 'normal' && result.ok && !result.referenceError && result.check?.passed === true

  await saveCodes(user.id, lab.id, steps, codes)
  const now = new Date().toISOString()
  await db
    .update(schema.labProgress)
    .set({
      runs: sql`${schema.labProgress.runs} + 1`,
      lastRunAt: now,
      // 第一次做对的时间，之后再跑错也不收回
      ...(passed ? { passedAt: sql`coalesce(${schema.labProgress.passedAt}, ${now})` } : {}),
      ...(step.kind === 'normal' ? { lastFailure: failureOf(result) } : {}),
    })
    .where(and(eq(schema.labProgress.userId, user.id), eq(schema.labProgress.stepId, step.id)))

  return success(c, {
    ...result,
    passed,
    referenceCode: passed && step.referenceCode.trim() ? step.referenceCode : null,
  } satisfies LabStepRunResponse)
})

/** 开放步骤交上去：一句话 + 交的那一刻的代码。交了就算这一步完成，可以改了再交 */
labRoutes.post('/labs/:id/steps/:stepId/submit', requireAuth, async (c) => {
  const found = await findStep(c)
  if (!found) return failure(c, 404, 'lab-step-not-found', '这一步不存在')
  if (found.step.kind !== 'open') return failure(c, 400, 'not-open-step', '这一步不用交')
  const parsed = await parseBody(c, submitLabOpenRequestSchema)
  if (!parsed.success) return parsed.response
  const { lab, steps, index, step } = found
  const { codes, text } = parsed.data
  if (codes.length !== index + 1) return failure(c, 400, 'invalid-request', '代码的步数对不上，刷新一下')
  const user = c.get('user')!
  await saveCodes(user.id, lab.id, steps, codes)
  const now = new Date().toISOString()
  await db
    .update(schema.labProgress)
    .set({
      openText: text,
      openCode: codes[index]!,
      submittedAt: now,
      passedAt: sql`coalesce(${schema.labProgress.passedAt}, ${now})`,
    })
    .where(and(eq(schema.labProgress.userId, user.id), eq(schema.labProgress.stepId, step.id)))
  return success(c, { submittedAt: now })
})

// ---------------------------------------------------------------- 素材

async function findAsset(c: Context<AppEnv>) {
  const lab = await findLab(c)
  if (!lab) return null
  const [asset] = await db
    .select({ id: schema.labAsset.id, name: schema.labAsset.name, labId: schema.labAsset.labId })
    .from(schema.labAsset)
    .where(and(eq(schema.labAsset.id, queryInteger(c.req.param('assetId'), 0, { min: 1 })), eq(schema.labAsset.labId, lab.id)))
    .limit(1)
  return asset ?? null
}

labRoutes.get('/labs/:id/assets/:assetId/preview', optionalAuth, async (c) => {
  const asset = await findAsset(c)
  if (!asset) return failure(c, 404, 'asset-not-found', '这个素材不存在')
  try {
    return success(c, (await labAssetPreview(asset.labId, asset)) satisfies LabAssetPreview)
  } catch (err) {
    return runFailure(c, err instanceof LabRunnerError ? err : new LabRunnerError(String(err)))
  }
})

labRoutes.get('/labs/:id/assets/:assetId/file', optionalAuth, async (c) => {
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

// ---------------------------------------------------------------- 老师：全班进度（画布 LabProgress）

/**
 * 一个班在这一节上的进度。不指定班：先看做过这一节的班里人最多的，没人做过就猜正在上课的班。
 * 分组（卡在第几步、卡在哪条检查）在前端做 —— 口径要随界面调，放前端改起来不用动接口。
 */
labRoutes.get('/labs/:id/progress', requireTeacher, async (c) => {
  const lab = await findLab(c)
  if (!lab) return failure(c, 404, 'lab-not-found', '这一节不存在')
  const users = sql<number>`count(distinct ${schema.labProgress.userId})::int`
  const [steps, classRows] = await Promise.all([
    labSteps(lab.id),
    db
      .select({ className: schema.user.className, users })
      .from(schema.labProgress)
      .innerJoin(schema.user, eq(schema.user.id, schema.labProgress.userId))
      .where(and(eq(schema.labProgress.labId, lab.id), isNotNull(schema.user.className), inArray(schema.user.adminType, [...STUDENT_ROLES])))
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
        .from(schema.labProgress)
        .where(
          and(
            eq(schema.labProgress.labId, lab.id),
            inArray(
              schema.labProgress.userId,
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
  } satisfies LabProgress)
})

async function studentRows(labId: number, userId: number) {
  const rows = await db
    .select()
    .from(schema.labProgress)
    .where(and(eq(schema.labProgress.labId, labId), eq(schema.labProgress.userId, userId)))
  return new Map(rows.map((r) => [r.stepId, r]))
}

labRoutes.get('/labs/:id/progress/:userId', requireTeacher, async (c) => {
  const lab = await findLab(c)
  if (!lab) return failure(c, 404, 'lab-not-found', '这一节不存在')
  const [steps, rows] = await Promise.all([labSteps(lab.id), studentRows(lab.id, queryInteger(c.req.param('userId'), 0, { min: 1 }))])
  return success(c, {
    steps: steps.map((s) => {
      const p = rows.get(s.id)
      return { code: p?.code ?? null, openText: p?.openText ?? null, openCode: p?.openCode ?? null }
    }),
  } satisfies LabStudentWork)
})

/**
 * 老师看一个学生的某一步：拿他存着的代码现跑（运行结果不存，见 lab_progress 的注释）。
 * 开放步骤交过的，跑交的那一份；没动过的步骤用初始代码。
 */
labRoutes.post('/labs/:id/progress/:userId/steps/:stepId/run', requireTeacher, async (c) => {
  const found = await findStep(c)
  if (!found) return failure(c, 404, 'lab-step-not-found', '这一步不存在')
  const { lab, steps, index } = found
  const rows = await studentRows(lab.id, queryInteger(c.req.param('userId'), 0, { min: 1 }))
  const codes = steps.slice(0, index + 1).map((s) => {
    const p = rows.get(s.id)
    return (s.kind === 'open' && p?.openCode) || (p ? p.code : s.starterCode)
  })
  try {
    const result = await runLab(c.get('user')!.id, buildRunRequest(steps, index, await labAssetsPayload(lab.id), codes))
    return success(c, result satisfies LabRunResult)
  } catch (err) {
    return runFailure(c, err)
  }
})

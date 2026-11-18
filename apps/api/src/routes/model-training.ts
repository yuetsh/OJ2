/**
 * 「训练模型」学生这边：列表、一节、存改动、训练一次、老师重来、全班情况。
 * 设计见 docs/specs/2026-11-17-model-training-lab-design.md；样子照画布「训练模型」页。
 *
 * 没公开的一节只有老师进得去（拿来试做）。**训练只在服务器做**：最后考的句子、训练数据的正确标签都不下发，
 * 正确标签只在达标后的复盘里揭开标错的那几条。
 */
import {
  EMPTY_MODEL_TRAINING_EDITS,
  STUDENT_ROLES,
  TEACHER_ROLES,
  accuracyPercent,
  editsDiff,
  saveModelTrainingEditsRequestSchema,
  type ModelTrainingDetail,
  type ModelTrainingEdits,
  type ModelTrainingListItem,
  type ModelTrainingProgress,
} from '@oj2/contract'
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'

import { optionalAuth, requireAuth, requireTeacher, type AppEnv } from '../auth/middleware'
import { db, schema } from '../db'
import { failure, parseBody, success } from '../http'
import { suggestActiveClass } from '../services/class-activity'
import { buildReview, cleanEdits, editsError, passes, runTraining, selectItems, splitItems } from '../services/model-training'
import { queryInteger, rosterCondition } from './helpers'

export const modelTrainingRoutes = new Hono<AppEnv>()

function isTeacher(c: Context<AppEnv>) {
  const user = c.get('user')
  return !!user && TEACHER_ROLES.includes(user.adminType)
}

/** 这一节：学生只能看公开的，老师都能看 */
async function findLesson(c: Context<AppEnv>) {
  const [lesson] = await db
    .select()
    .from(schema.modelTraining)
    .where(eq(schema.modelTraining.id, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .limit(1)
  if (!lesson || (!lesson.isPublic && !isTeacher(c))) return null
  return lesson
}

type Lesson = typeof schema.modelTraining.$inferSelect

async function findWork(userId: number, lessonId: number) {
  const [work] = await db
    .select()
    .from(schema.modelTrainingWork)
    .where(and(eq(schema.modelTrainingWork.userId, userId), eq(schema.modelTrainingWork.modelTrainingId, lessonId)))
    .limit(1)
  return work ?? null
}

/** 一节的完整样子（学生看的）。练习测试判错的那几条按上一次训练时的改动现算 —— 毫秒级，不存 */
async function detail(c: Context<AppEnv>, lesson: Lesson): Promise<ModelTrainingDetail> {
  const user = c.get('user')
  const [items, work, runs] = await Promise.all([
    selectItems(lesson.id),
    user ? findWork(user.id, lesson.id) : null,
    user
      ? db
          .select()
          .from(schema.modelTrainingRun)
          .where(and(eq(schema.modelTrainingRun.userId, user.id), eq(schema.modelTrainingRun.modelTrainingId, lesson.id)))
          .orderBy(asc(schema.modelTrainingRun.id))
      : [],
  ])
  const data = splitItems(items)
  const trainIds = new Set(data.train.map((row) => row.id))
  const edits = work ? cleanEdits(work.edits, trainIds) : EMPTY_MODEL_TRAINING_EDITS
  const trainedEdits = work?.trainedEdits ? cleanEdits(work.trainedEdits, trainIds) : null
  const passed = !!work?.passedAt
  return {
    id: lesson.id,
    title: lesson.title,
    description: lesson.description,
    labels: lesson.labels,
    threshold: lesson.threshold,
    isPublic: lesson.isPublic,
    canReset: !!user && !STUDENT_ROLES.includes(user.adminType),
    train: data.train.map(({ id, text, label }) => ({ id, text, label })),
    practiceTotal: data.practice.length,
    edits,
    trainedEdits,
    runs: runs.map((r) => ({
      practice: accuracyPercent(r.practiceCorrect, r.practiceTotal),
      final: accuracyPercent(r.finalCorrect, r.finalTotal),
      passed: r.passed,
    })),
    practiceWrong: trainedEdits ? runTraining(lesson.labels, data, trainedEdits).practiceWrong : null,
    passed,
    review: passed ? buildReview(data.train, edits, lesson.review) : null,
  }
}

modelTrainingRoutes.get('/model-trainings', optionalAuth, async (c) => {
  const user = c.get('user')
  const lessons = await db
    .select({
      id: schema.modelTraining.id,
      title: schema.modelTraining.title,
      isPublic: schema.modelTraining.isPublic,
      threshold: schema.modelTraining.threshold,
    })
    .from(schema.modelTraining)
    .where(isTeacher(c) ? undefined : eq(schema.modelTraining.isPublic, true))
    .orderBy(asc(schema.modelTraining.order), asc(schema.modelTraining.id))
  const works = user
    ? await db
        .select({ id: schema.modelTrainingWork.modelTrainingId, best: schema.modelTrainingWork.best, passedAt: schema.modelTrainingWork.passedAt })
        .from(schema.modelTrainingWork)
        .where(eq(schema.modelTrainingWork.userId, user.id))
    : []
  const mine = new Map(works.map((w) => [w.id, w]))
  return success(
    c,
    lessons.map((l) => ({ ...l, best: mine.get(l.id)?.best ?? null, passed: !!mine.get(l.id)?.passedAt }) satisfies ModelTrainingListItem),
  )
})

modelTrainingRoutes.get('/model-trainings/:id', optionalAuth, async (c) => {
  const lesson = await findLesson(c)
  if (!lesson) return failure(c, 404, 'model-training-not-found', '这一节不存在')
  return success(c, await detail(c, lesson))
})

/** 读请求体里的改动并校验。成功回 { lesson, edits }，失败回响应 */
async function readEdits(c: Context<AppEnv>) {
  const lesson = await findLesson(c)
  if (!lesson) return { response: failure(c, 404, 'model-training-not-found', '这一节不存在') }
  const parsed = await parseBody(c, saveModelTrainingEditsRequestSchema)
  if (!parsed.success) return { response: parsed.response }
  const items = await selectItems(lesson.id)
  const trainIds = new Set(items.filter((i) => i.split === 'train').map((i) => i.id))
  const error = editsError(parsed.data.edits, lesson.labels, trainIds)
  if (error) return { response: failure(c, 400, 'invalid-edits', error) }
  return { lesson, items, edits: cleanEdits(parsed.data.edits, trainIds) }
}

function saveEdits(userId: number, lessonId: number, edits: ModelTrainingEdits) {
  const now = new Date().toISOString()
  return db
    .insert(schema.modelTrainingWork)
    .values({ userId, modelTrainingId: lessonId, edits, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.modelTrainingWork.userId, schema.modelTrainingWork.modelTrainingId],
      set: { edits, updatedAt: now },
    })
}

/** 存改动（页面上改一处存一次，不训练）。离开页面再回来，改到一半的还在 */
modelTrainingRoutes.put('/model-trainings/:id/work', requireAuth, async (c) => {
  const read = await readEdits(c)
  if ('response' in read) return read.response
  await saveEdits(c.get('user')!.id, read.lesson.id, read.edits)
  return success(c, null)
})

/**
 * 训练一次：存改动 → 训练 → 两份测试 → 记一行。最后考到线就记第一次达标的时间，之后不撤销；
 * 最高分只往上走。回整节的样子（判错的、复盘都跟着变）。
 */
modelTrainingRoutes.post('/model-trainings/:id/train', requireAuth, async (c) => {
  const read = await readEdits(c)
  if ('response' in read) return read.response
  const { lesson, items, edits } = read
  const data = splitItems(items)
  if (!data.practice.length || !data.final.length) return failure(c, 400, 'not-ready', '这一节的测试数据还没出好')
  const userId = c.get('user')!.id
  // 和上次训练时一处都没改：模型是确定的，结果一模一样，不再记一次（不然连点会刷出一串一样的分，
  // 老师那边「训练几次」也失真）。页面上这时「训练」按钮本来就是灰的，这里防绕过页面直接发请求
  const work = await findWork(userId, lesson.id)
  const trainIds = new Set(data.train.map((row) => row.id))
  if (work?.trainedEdits && editsDiff(cleanEdits(work.trainedEdits, trainIds), edits) === 0) return success(c, await detail(c, lesson))
  const result = runTraining(lesson.labels, data, edits)
  const passed = passes(result.finalCorrect, data.final.length, lesson.threshold)
  const percent = accuracyPercent(result.finalCorrect, data.final.length)
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.insert(schema.modelTrainingRun).values({
      userId,
      modelTrainingId: lesson.id,
      practiceCorrect: result.practiceCorrect,
      practiceTotal: data.practice.length,
      finalCorrect: result.finalCorrect,
      finalTotal: data.final.length,
      passed,
      createdAt: now,
    })
    await tx
      .insert(schema.modelTrainingWork)
      .values({
        userId,
        modelTrainingId: lesson.id,
        edits,
        trainedEdits: edits,
        best: percent,
        passedAt: passed ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.modelTrainingWork.userId, schema.modelTrainingWork.modelTrainingId],
        set: {
          edits,
          trainedEdits: edits,
          best: sql`greatest(coalesce(${schema.modelTrainingWork.best}, 0), ${percent})`,
          passedAt: passed ? sql`coalesce(${schema.modelTrainingWork.passedAt}, ${now})` : sql`${schema.modelTrainingWork.passedAt}`,
          updatedAt: now,
        },
      })
  })
  return success(c, await detail(c, lesson))
})

/** 老师试做完「重来」：清掉自己这一节的改动和训练记录。学生没有这个按钮，接口也不认学生 */
modelTrainingRoutes.post('/model-trainings/:id/reset', requireAuth, async (c) => {
  const user = c.get('user')!
  if (STUDENT_ROLES.includes(user.adminType)) return failure(c, 403, 'forbidden', '学生不能重来')
  const lesson = await findLesson(c)
  if (!lesson) return failure(c, 404, 'model-training-not-found', '这一节不存在')
  await db.transaction(async (tx) => {
    await tx.delete(schema.modelTrainingWork).where(and(eq(schema.modelTrainingWork.userId, user.id), eq(schema.modelTrainingWork.modelTrainingId, lesson.id)))
    await tx.delete(schema.modelTrainingRun).where(and(eq(schema.modelTrainingRun.userId, user.id), eq(schema.modelTrainingRun.modelTrainingId, lesson.id)))
  })
  return success(c, null)
})

// ---------------------------------------------------------------- 老师：全班情况

/**
 * 一个班在这一节上的情况。不指定班：先看训练过的班里人最多的，没人训练过就猜正在上课的班。
 * 「改对 / 改坏」「按数据」都在前端算 —— 口径要随界面调，放前端改起来不用动接口。
 */
modelTrainingRoutes.get('/model-trainings/:id/progress', requireTeacher, async (c) => {
  const lesson = await findLesson(c)
  if (!lesson) return failure(c, 404, 'model-training-not-found', '这一节不存在')
  const users = sql<number>`count(distinct ${schema.modelTrainingWork.userId})::int`
  const [items, classRows] = await Promise.all([
    selectItems(lesson.id),
    db
      .select({ className: schema.user.className, users })
      .from(schema.modelTrainingWork)
      .innerJoin(schema.user, eq(schema.user.id, schema.modelTrainingWork.userId))
      .where(and(eq(schema.modelTrainingWork.modelTrainingId, lesson.id), isNotNull(schema.user.className), inArray(schema.user.adminType, [...STUDENT_ROLES])))
      .groupBy(schema.user.className)
      .orderBy(desc(users)),
  ])
  const classes = classRows.flatMap((r) => (r.className ? [r.className] : []))
  const className = c.req.query('className')?.trim() || classes[0] || (await suggestActiveClass())

  const students = className
    ? await db
        .select({ id: schema.user.id, username: schema.user.username, className: schema.user.className })
        .from(schema.user)
        .where(
          rosterCondition(
            className,
            db.select({ id: schema.modelTrainingWork.userId }).from(schema.modelTrainingWork).where(eq(schema.modelTrainingWork.modelTrainingId, lesson.id)),
          ),
        )
        .orderBy(asc(schema.user.username))
    : []
  const ids = students.map((s) => s.id)
  const [works, runCounts] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(schema.modelTrainingWork)
          .where(and(eq(schema.modelTrainingWork.modelTrainingId, lesson.id), inArray(schema.modelTrainingWork.userId, ids))),
        db
          .select({ userId: schema.modelTrainingRun.userId, n: sql<number>`count(*)::int` })
          .from(schema.modelTrainingRun)
          .where(and(eq(schema.modelTrainingRun.modelTrainingId, lesson.id), inArray(schema.modelTrainingRun.userId, ids)))
          .groupBy(schema.modelTrainingRun.userId),
      ])
    : [[], []]
  const workOf = new Map(works.map((w) => [w.userId, w]))
  const runsOf = new Map(runCounts.map((r) => [r.userId, r.n]))
  const train = items.filter((i) => i.split === 'train')
  const trainIds = new Set(train.map((i) => i.id))
  return success(c, {
    className,
    classes,
    labels: lesson.labels,
    threshold: lesson.threshold,
    items: train.map((i) => ({ id: i.id, text: i.text, shown: i.shown ?? i.answer, answer: i.answer })),
    students: students.map((u) => {
      const work = workOf.get(u.id)
      const edits = work ? cleanEdits(work.edits, trainIds) : EMPTY_MODEL_TRAINING_EDITS
      return {
        ...u,
        runs: runsOf.get(u.id) ?? 0,
        best: work?.best ?? null,
        passed: !!work?.passedAt,
        relabels: edits.relabels,
        removed: edits.removed,
      }
    }),
  } satisfies ModelTrainingProgress)
})

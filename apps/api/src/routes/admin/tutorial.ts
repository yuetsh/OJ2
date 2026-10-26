import {
  STUDENT_ROLES,
  createExerciseRequestSchema,
  createTutorialRequestSchema,
  renameTutorialProjectRequestSchema,
  reorderTutorialsRequestSchema,
  setTutorialProblemsRequestSchema,
  setTutorialVisibilityRequestSchema,
  updateExerciseRequestSchema,
  updateTutorialRequestSchema,
  type AdminExercise,
  type AdminTutorial,
  type AdminTutorialGroups,
  type AdminTutorialListItem,
  type TutorialProblemCandidate,
} from '@oj2/contract'
import { and, asc, count, countDistinct, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireSuperAdmin, type AppEnv } from '../../auth/middleware'
import { db, schema } from '../../db'
import { failure, parseBody, success } from '../../http'
import { exerciseDataError } from '../../services/exercise'
import {
  MUST_DO_TAG,
  exerciseCountColumn,
  mustDoColumn,
  problemCountColumn,
  problemTagNames,
  projectFromContent,
  tutorialProblems,
} from '../../services/tutorial'
import { asRecord, queryInteger, sampleUser } from '../helpers'

export const adminTutorialRoutes = new Hono<AppEnv>()

async function serializeTutorial(row: { tutorial: typeof schema.tutorial.$inferSelect; user: typeof schema.user.$inferSelect; realName: string | null }) {
  const problems = await tutorialProblems([row.tutorial.id], false)
  return {
    id: row.tutorial.id,
    title: row.tutorial.title,
    content: row.tutorial.content,
    code: row.tutorial.code,
    project: row.tutorial.project,
    problems: problems.map(({ id, displayId, title, mustDo }) => ({
      id,
      displayId,
      title,
      mustDo,
    })),
    isPublic: row.tutorial.isPublic,
    order: row.tutorial.order,
    type: row.tutorial.type,
    createdBy: sampleUser(row.user, row.realName),
    createdAt: row.tutorial.createdAt,
    updatedAt: row.tutorial.updatedAt,
  } satisfies AdminTutorial
}

function selectTutorial(id: number) {
  return db
    .select({
      tutorial: schema.tutorial,
      user: schema.user,
      realName: schema.userProfile.realName,
    })
    .from(schema.tutorial)
    .innerJoin(schema.user, eq(schema.tutorial.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.tutorial.id, id))
    .limit(1)
}

adminTutorialRoutes.get('/tutorials', requireSuperAdmin, async (c) => {
  const [rows, readerRows] = await Promise.all([
    db
      .select({
        tutorial: schema.tutorial,
        user: schema.user,
        realName: schema.userProfile.realName,
        exerciseCount: exerciseCountColumn,
        problemCount: problemCountColumn,
      })
      .from(schema.tutorial)
      .innerJoin(schema.user, eq(schema.tutorial.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .orderBy(asc(schema.tutorial.order), desc(schema.tutorial.createdAt)),
    // 打开过的学生数：老师自己点开看的不算
    db
      .select({
        tutorialId: schema.tutorialProgress.tutorialId,
        readers: countDistinct(schema.tutorialProgress.userId),
      })
      .from(schema.tutorialProgress)
      .innerJoin(schema.user, eq(schema.user.id, schema.tutorialProgress.userId))
      .where(inArray(schema.user.adminType, [...STUDENT_ROLES]))
      .groupBy(schema.tutorialProgress.tutorialId),
  ])
  const readers = new Map(readerRows.map((row) => [row.tutorialId, row.readers]))
  const all = rows.map(
    (row) =>
      ({
        id: row.tutorial.id,
        title: row.tutorial.title,
        project: row.tutorial.project,
        isPublic: row.tutorial.isPublic,
        order: row.tutorial.order,
        type: row.tutorial.type,
        createdBy: sampleUser(row.user, row.realName),
        createdAt: row.tutorial.createdAt,
        updatedAt: row.tutorial.updatedAt,
        exerciseCount: row.exerciseCount,
        problemCount: row.problemCount,
        readers: readers.get(row.tutorial.id) ?? 0,
      }) satisfies AdminTutorialListItem,
  )
  // 分组返回，形状对齐旧 TutorialAdminAPI.get
  return success(c, {
    python: all.filter((item) => item.type === 'python'),
    c: all.filter((item) => item.type === 'c'),
  } satisfies AdminTutorialGroups)
})

/**
 * 拖动排序：把这一串 id 的 order 依次改成 1、2、3……
 * 路径不放在 `/tutorials/` 下，理由同 learn.ts 顶上那段：`/tutorials/:id` 会先吃掉它。
 */
adminTutorialRoutes.put('/tutorial-order', requireSuperAdmin, async (c) => {
  const parsed = await parseBody(c, reorderTutorialsRequestSchema)
  if (!parsed.success) return parsed.response
  const ids = parsed.data.ids
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      // 排序不是内容修改，不动 updatedAt
      await tx
        .update(schema.tutorial)
        .set({ order: index + 1 })
        .where(eq(schema.tutorial.id, id))
    }
  })
  return success(c, null)
})

/** 项目改名：这门课里挂在旧名字下的教程一起改 */
adminTutorialRoutes.put('/tutorial-projects', requireSuperAdmin, async (c) => {
  const parsed = await parseBody(c, renameTutorialProjectRequestSchema)
  if (!parsed.success) return parsed.response
  const { type, from, to } = parsed.data
  await db
    .update(schema.tutorial)
    .set({ project: to })
    .where(and(eq(schema.tutorial.type, type), eq(schema.tutorial.project, from)))
  return success(c, null)
})

/**
 * 给一课挑题的候选。不带关键字列出全部必会题；带关键字按题号、标题找，
 * 必会题排在前面。只给公开题库里的题（比赛题学生点不进去）。
 */
adminTutorialRoutes.get('/tutorial-problem-candidates', requireSuperAdmin, async (c) => {
  const keyword = c.req.query('keyword')?.trim() ?? ''
  const pattern = `%${keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
  const rows = await db
    .select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      title: schema.problem.title,
      mustDo: mustDoColumn,
      tags: problemTagNames,
    })
    .from(schema.problem)
    .where(
      and(
        isNull(schema.problem.contestId),
        eq(schema.problem.visible, true),
        keyword ? or(eq(schema.problem.displayId, keyword), ilike(schema.problem.title, pattern)) : mustDoColumn,
      ),
    )
    .orderBy(desc(sql`${schema.problem.displayId} = ${keyword}`), desc(mustDoColumn), asc(schema.problem.displayId))
    .limit(keyword ? 20 : 60)
  return success(
    c,
    rows.map(
      (row) =>
        ({
          ...row,
          tags: row.tags.filter((tag) => tag !== MUST_DO_TAG),
        }) satisfies TutorialProblemCandidate,
    ),
  )
})

adminTutorialRoutes.post('/tutorials', requireSuperAdmin, async (c) => {
  const parsed = await parseBody(c, createTutorialRequestSchema)
  if (!parsed.success) return parsed.response
  const now = new Date().toISOString()
  const { project, ...data } = parsed.data
  const [created] = await db
    .insert(schema.tutorial)
    .values({
      ...data,
      project: project ?? projectFromContent(data.content),
      createdAt: now,
      updatedAt: now,
      createdById: c.get('user')!.id,
    })
    .returning({ id: schema.tutorial.id })
  const [row] = await selectTutorial(created!.id)
  return success(c, await serializeTutorial(row!), 201)
})

adminTutorialRoutes.get('/tutorials/:id', requireSuperAdmin, async (c) => {
  const [row] = await selectTutorial(queryInteger(c.req.param('id'), 0, { min: 1 }))
  if (!row) return failure(c, 404, 'tutorial-not-found', 'Tutorial does not exist')
  return success(c, await serializeTutorial(row))
})

adminTutorialRoutes.put('/tutorials/:id', requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, updateTutorialRequestSchema)
  if (!parsed.success) return parsed.response
  const { project, ...data } = parsed.data
  // 没传 project（发布脚本）就从正文里抽；正文里也没写就不动原来的
  const derived = project ?? (projectFromContent(data.content) || undefined)
  const updated = await db
    .update(schema.tutorial)
    .set({
      ...data,
      ...(derived === undefined ? {} : { project: derived }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tutorial.id, id))
    .returning({ id: schema.tutorial.id })
  if (updated.length === 0) return failure(c, 404, 'tutorial-not-found', 'Tutorial does not exist')
  const [row] = await selectTutorial(id)
  return success(c, await serializeTutorial(row!))
})

adminTutorialRoutes.put('/tutorials/:id/visibility', requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, setTutorialVisibilityRequestSchema, 'isPublic is required')
  if (!parsed.success) return parsed.response
  // 只改可见性，不动 updatedAt —— 上下架不是内容修改，改了会打乱按更新时间排序的直觉
  const updated = await db
    .update(schema.tutorial)
    .set({ isPublic: parsed.data.isPublic })
    .where(eq(schema.tutorial.id, id))
    .returning({ id: schema.tutorial.id })
  if (updated.length === 0) return failure(c, 404, 'tutorial-not-found', 'Tutorial does not exist')
  const [row] = await selectTutorial(id)
  return success(c, await serializeTutorial(row!))
})

/** 一课挂哪几道题：整串替换，顺序就是数组顺序 */
adminTutorialRoutes.put('/tutorials/:id/problems', requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, setTutorialProblemsRequestSchema)
  if (!parsed.success) return parsed.response
  const problemIds = [...new Set(parsed.data.problemIds)]
  const [row] = await selectTutorial(id)
  if (!row) return failure(c, 404, 'tutorial-not-found', 'Tutorial does not exist')
  if (problemIds.length) {
    const found = await db
      .select({ id: schema.problem.id })
      .from(schema.problem)
      .where(and(inArray(schema.problem.id, problemIds), isNull(schema.problem.contestId)))
    if (found.length !== problemIds.length) {
      return failure(c, 400, 'problem-not-found', '有的题不存在，或者是比赛题')
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.tutorialProblem).where(eq(schema.tutorialProblem.tutorialId, id))
    if (problemIds.length) {
      await tx.insert(schema.tutorialProblem).values(problemIds.map((problemId, index) => ({ tutorialId: id, problemId, order: index })))
    }
  })
  return success(c, await serializeTutorial(row))
})

adminTutorialRoutes.delete('/tutorials/:id', requireSuperAdmin, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  // 练习、学习留痕、挂的题都随教程一起没：exercise / tutorial_progress / tutorial_problem
  // 的 tutorial_id 都是库级 CASCADE。**加子表时要回来想一遍该 CASCADE 还是该拦住**，
  // 别默认新表会自己连坐 —— 0010 只改了当时存在的那批外键。
  const deleted = await db.delete(schema.tutorial).where(eq(schema.tutorial.id, id)).returning({ id: schema.tutorial.id })
  if (deleted.length === 0) return failure(c, 404, 'tutorial-not-found', 'Tutorial does not exist')
  return success(c, null)
})

// ---------------------------------------------------------------- 练习

function serializeExercise(row: typeof schema.exercise.$inferSelect, attemptUsers: number) {
  return {
    id: row.id,
    type: row.type,
    data: asRecord(row.data),
    order: row.order,
    attemptUsers,
  } satisfies AdminExercise
}

const attemptUsersColumn = sql<number>`(
  select count(*) from "exercise_attempt" ea where ea."exercise_id" = "exercise"."id"
)`.mapWith(Number)

// 练习挂在教程下，路径嵌套 —— 旧后端是 ?tutorial_id= 查询参数，
// 但它本来就是一对多的从属关系，嵌套路径更贴事实，也省掉「忘了传 tutorial_id」这类错误
adminTutorialRoutes.get('/tutorials/:id/exercises', requireSuperAdmin, async (c) => {
  const rows = await db
    .select({ exercise: schema.exercise, attemptUsers: attemptUsersColumn })
    .from(schema.exercise)
    .where(eq(schema.exercise.tutorialId, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .orderBy(asc(schema.exercise.order), asc(schema.exercise.id))
  return success(
    c,
    rows.map((row) => serializeExercise(row.exercise, row.attemptUsers)),
  )
})

adminTutorialRoutes.post('/exercises', requireSuperAdmin, async (c) => {
  const parsed = await parseBody(c, createExerciseRequestSchema)
  if (!parsed.success) return parsed.response
  const [tutorial] = await db.select({ id: schema.tutorial.id }).from(schema.tutorial).where(eq(schema.tutorial.id, parsed.data.tutorialId)).limit(1)
  if (!tutorial) return failure(c, 404, 'tutorial-not-found', 'Tutorial does not exist')
  const dataError = exerciseDataError(parsed.data.type, parsed.data.data)
  if (dataError) return failure(c, 400, 'invalid-exercise', dataError)
  const [created] = await db
    .insert(schema.exercise)
    .values({
      tutorialId: parsed.data.tutorialId,
      type: parsed.data.type,
      data: parsed.data.data,
      order: parsed.data.order,
      createdAt: new Date().toISOString(),
    })
    .returning()
  return success(c, serializeExercise(created!, 0), 201)
})

adminTutorialRoutes.put('/exercises/:id', requireSuperAdmin, async (c) => {
  const parsed = await parseBody(c, updateExerciseRequestSchema)
  if (!parsed.success) return parsed.response
  const dataError = exerciseDataError(parsed.data.type, parsed.data.data)
  if (dataError) return failure(c, 400, 'invalid-exercise', dataError)
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.exercise)
      .set({
        type: parsed.data.type,
        data: parsed.data.data,
        order: parsed.data.order,
      })
      .where(eq(schema.exercise.id, id))
      .returning()
    if (!updated) return null
    if (parsed.data.resetAttempts) {
      await tx.delete(schema.exerciseAttempt).where(eq(schema.exerciseAttempt.exerciseId, id))
    }
    const [attempted] = await tx.select({ value: count() }).from(schema.exerciseAttempt).where(eq(schema.exerciseAttempt.exerciseId, id))
    return serializeExercise(updated, attempted?.value ?? 0)
  })
  if (!result) return failure(c, 404, 'exercise-not-found', 'Exercise does not exist')
  return success(c, result)
})

adminTutorialRoutes.delete('/exercises/:id', requireSuperAdmin, async (c) => {
  const deleted = await db
    .delete(schema.exercise)
    .where(eq(schema.exercise.id, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .returning({ id: schema.exercise.id })
  if (deleted.length === 0) return failure(c, 404, 'exercise-not-found', 'Exercise does not exist')
  return success(c, null)
})

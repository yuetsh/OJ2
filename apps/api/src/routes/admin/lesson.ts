import { adminLessonRequestSchema, lessonModeSchema, STUDENT_ROLES, type AdminLessonList, type AdminLessonRequest } from '@oj2/contract'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireTeacher, type AppEnv } from '../../auth/middleware'
import { db, schema } from '../../db'
import { failure, parseBody, success } from '../../http'
import { announceLessonChange, lessonDoneCounts, resolveLessonProblems, todayLessonSnapshot } from '../../services/lesson'
import { localDateTime } from '../../time'
import { queryInteger } from '../helpers'

/**
 * 后台「课堂任务」：布置过的每一节课（class_lesson）。任务页上布置错了班、错了题可以在这里改，
 * 任务页外上的课（以前的、没在任务页布置的）可以补一节 —— 数据统计按布置切课，补了才认得到。
 *
 * 权限和任务页一样是老师：任务页上任何老师都能改任何班的这节课，这里不另设门槛。
 */
export const adminLessonRoutes = new Hono<AppEnv>()

const teacherName = sql<string>`coalesce(nullif(${schema.userProfile.realName}, ''), ${schema.user.username})`

adminLessonRoutes.get('/lessons', requireTeacher, async (c) => {
  const limit = queryInteger(c.req.query('limit'), 20, { min: 1, max: 100 })
  const offset = queryInteger(c.req.query('offset'), 0, { min: 0 })
  const className = c.req.query('className')?.trim()
  const teacherId = queryInteger(c.req.query('teacher'), 0, { min: 0 })
  const mode = lessonModeSchema.safeParse(c.req.query('mode')).data
  const where = and(
    className ? eq(schema.classLesson.className, className) : undefined,
    teacherId ? eq(schema.classLesson.createdBy, teacherId) : undefined,
    mode ? eq(schema.classLesson.mode, mode) : undefined,
  )

  const [rows, [totalRow], teachers] = await Promise.all([
    db
      .select({
        id: schema.classLesson.id,
        className: schema.classLesson.className,
        day: schema.classLesson.day,
        problemIds: schema.classLesson.problemIds,
        language: schema.classLesson.language,
        mode: schema.classLesson.mode,
        createdAt: schema.classLesson.createdAt,
        updatedAt: schema.classLesson.updatedAt,
        createdBy: teacherName,
      })
      .from(schema.classLesson)
      .innerJoin(schema.user, eq(schema.user.id, schema.classLesson.createdBy))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.classLesson.createdBy))
      .where(where)
      .orderBy(desc(schema.classLesson.day), desc(schema.classLesson.createdAt), desc(schema.classLesson.id))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(schema.classLesson).where(where),
    db
      .select({ id: schema.classLesson.createdBy, name: teacherName })
      .from(schema.classLesson)
      .innerJoin(schema.user, eq(schema.user.id, schema.classLesson.createdBy))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.classLesson.createdBy))
      .groupBy(schema.classLesson.createdBy, schema.user.username, schema.userProfile.realName)
      .orderBy(desc(count())),
  ])

  const problemIds = [...new Set(rows.flatMap((row) => row.problemIds))]
  const classNames = [...new Set(rows.map((row) => row.className))]
  const [problems, sizes, done] = await Promise.all([
    problemIds.length
      ? db
          .select({ id: schema.problem.id, displayId: schema.problem.displayId, title: schema.problem.title, visible: schema.problem.visible })
          .from(schema.problem)
          .where(inArray(schema.problem.id, problemIds))
      : [],
    classNames.length
      ? db
          .select({ className: schema.user.className, value: count() })
          .from(schema.user)
          .where(and(inArray(schema.user.className, classNames), inArray(schema.user.adminType, [...STUDENT_ROLES]), eq(schema.user.isDisabled, false)))
          .groupBy(schema.user.className)
      : [],
    lessonDoneCounts(rows),
  ])
  const problemById = new Map(problems.map((row) => [row.id, row]))
  const sizeByClass = new Map(sizes.map((row) => [row.className, row.value]))

  return success(c, {
    results: rows.map((row) => ({
      id: row.id,
      className: row.className,
      day: row.day,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      language: row.language ?? null,
      mode: row.mode,
      // 题被删掉的（problem_ids 不挂外键）直接不列
      problems: row.problemIds.flatMap((id) => {
        const problem = problemById.get(id)
        return problem ? [{ problemDisplayId: problem.displayId, title: problem.title, visible: problem.visible }] : []
      }),
      classSize: sizeByClass.get(row.className) ?? 0,
      doneCount: done.get(row.id) ?? 0,
    })),
    total: totalRow?.value ?? 0,
    teachers,
  } satisfies AdminLessonList)
})

/** 新补一节、改一节共用的校验：班得有人、题号都对得上、语言每道都能交、要画的都打开了画流程图 */
async function lessonValues(body: AdminLessonRequest): Promise<
  | { code: string; message: string }
  | {
      values: {
        className: string
        day: string
        problemIds: number[]
        language: AdminLessonRequest['language']
        mode: AdminLessonRequest['mode']
        createdAt: string
      }
    }
> {
  const [exists] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.className, body.className)).limit(1)
  if (!exists) return { code: 'class-not-found', message: `没有 ${body.className} 这个班` }
  // 只画流程图不用语言，存成 null（和任务页布置一样）
  const language = body.mode === 'flowchart' ? null : body.language
  const resolved = await resolveLessonProblems(body.problemDisplayIds, language, body.mode)
  if ('code' in resolved) return resolved
  return {
    values: {
      className: body.className,
      day: body.day,
      problemIds: resolved.problemIds,
      language,
      mode: body.mode,
      createdAt: localDateTime(body.day, body.time),
    },
  }
}

adminLessonRoutes.post('/lessons', requireTeacher, async (c) => {
  const parsed = await parseBody(c, adminLessonRequestSchema, '班级、日子、时刻或题号不对')
  if (!parsed.success) return parsed.response
  const result = await lessonValues(parsed.data)
  if ('code' in result) return failure(c, 400, result.code, result.message)
  const before = await todayLessonSnapshot(result.values.className)
  const [row] = await db
    .insert(schema.classLesson)
    .values({ ...result.values, createdBy: c.get('user')!.id, updatedAt: new Date().toISOString() })
    .returning({ id: schema.classLesson.id })
  // 补登的是今天、而且是最后一节，学生那边看到的就变了
  await announceLessonChange(result.values.className, before)
  return success(c, { id: row!.id })
})

adminLessonRoutes.put('/lessons/:id', requireTeacher, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, adminLessonRequestSchema, '班级、日子、时刻或题号不对')
  if (!parsed.success) return parsed.response
  const result = await lessonValues(parsed.data)
  if ('code' in result) return failure(c, 400, result.code, result.message)
  // 班级能改：原来那个班和新的班学生看到的都可能变，两边各比一次
  const classes = await affectedClasses(id, result.values.className)
  const before = await Promise.all(classes.map((className) => todayLessonSnapshot(className)))
  // 时刻只填到分：没改时刻就留着原来带秒的那个。不然只改了做什么，这一节也被挪到这一分钟的开头，
  // 排到同一分钟里后布置的那节前面去 —— 「今天最后一节」就换了人（先画流程图、紧接着再开一节写代码，常在同一分钟里）
  const [current] = await db.select({ createdAt: schema.classLesson.createdAt }).from(schema.classLesson).where(eq(schema.classLesson.id, id))
  const sameMinute = current && Math.floor(Date.parse(current.createdAt) / 60_000) * 60_000 === Date.parse(result.values.createdAt)
  // 布置的老师不换，和任务页上「改」一样认第一次
  const [row] = await db
    .update(schema.classLesson)
    .set({ ...result.values, createdAt: sameMinute ? current.createdAt : result.values.createdAt, updatedAt: new Date().toISOString() })
    .where(eq(schema.classLesson.id, id))
    .returning({ id: schema.classLesson.id })
  if (!row) return failure(c, 404, 'lesson-not-found', '这一节已经被删掉了')
  await Promise.all(classes.map((className, index) => announceLessonChange(className, before[index]!)))
  return success(c, null)
})

adminLessonRoutes.delete('/lessons/:id', requireTeacher, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const [className] = await affectedClasses(id)
  const before = className ? await todayLessonSnapshot(className) : null
  await db.delete(schema.classLesson).where(eq(schema.classLesson.id, id))
  if (className) await announceLessonChange(className, before)
  return success(c, null)
})

/** 这一节原来属于哪个班（已经没了就没有），再加上要改成的班，去重 */
async function affectedClasses(id: number, nextClass?: string) {
  const [row] = await db.select({ className: schema.classLesson.className }).from(schema.classLesson).where(eq(schema.classLesson.id, id))
  return [...new Set([row?.className, nextClass].filter((name): name is string => !!name))]
}

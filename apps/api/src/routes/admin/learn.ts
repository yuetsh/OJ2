import {
  STUDENT_ROLES,
  TUTORIAL_READ_SECONDS,
  learnExerciseAttemptSchema,
  learnExerciseProgressListSchema,
  learnExerciseProgressSchema,
  learnStudentProgressListSchema,
  learnStudentProgressSchema,
  learnTutorialProgressListSchema,
  learnTutorialProgressSchema,
} from "@oj2/contract"
import { and, asc, count, desc, eq, inArray, like, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireTeacher, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { queryInteger, rounded } from "../helpers"

/**
 * 自学情况：教程读了没、读了多久。
 *
 * 路径用 `/learn-analytics` 而不是挂在 `/tutorials` 下，理由同 tag.ts 里那段注释：
 * Hono 按注册顺序匹配，`/tutorials/:id` 会把同级的静态段整个吃掉且不报错。
 */
export const adminLearnRoutes = new Hono<AppEnv>()

function tutorialTypeOf(value: string | undefined) {
  return value === "c" ? "c" : "python"
}

/**
 * 班级筛选。班号形如 `241`（24 级 1 班），只允许纯数字：
 * 直接拼进 like 的话，`%` 会变成通配符，把筛选变成「全选」。
 */
function classFilter(className: string | undefined) {
  const value = className?.trim()
  if (!value) return { ok: true as const, value: null }
  if (!/^\d{1,4}$/.test(value)) return { ok: false as const, value: null }
  return { ok: true as const, value }
}

/**
 * `className` 传 3 位以上是具体班级（精确匹配），传 1-2 位当年级前缀（like）。
 * 年级前缀这条是给「24 级整体读得怎么样」用的，不然老师得一个班一个班点。
 */
function classCondition(value: string | null) {
  if (!value) return undefined
  return value.length >= 3
    ? eq(schema.user.className, value)
    : like(schema.user.className, `${value}%`)
}

/**
 * 没有班级的学生**照样统计**（班级列显示为空）。班级是从用户名的数字前缀推出来的，
 * 推不出来时就是 null（见 admin/account.ts 的 classNameOf），把这些人过滤掉等于让他们
 * 在「谁没学」这张表上凭空消失 —— 班级榜可以只算入班的人，这里不行。
 */
function studentCondition(value: string | null) {
  return and(
    eq(schema.user.isDisabled, false),
    inArray(schema.user.adminType, [...STUDENT_ROLES]),
    classCondition(value),
  )
}

adminLearnRoutes.get("/learn-analytics/students", requireTeacher, async (c) => {
  const type = tutorialTypeOf(c.req.query("type"))
  const className = classFilter(c.req.query("className"))
  if (!className.ok) return failure(c, 400, "invalid-class", "班级只能是数字")

  // 该语言下已公开的教程，既是分母，也是「哪些课算数」的白名单 ——
  // 未公开的课学生本来就打不开，混进来会让读完的人显示成没读完
  const tutorials = await db.select({ id: schema.tutorial.id }).from(schema.tutorial)
    .where(and(eq(schema.tutorial.isPublic, true), eq(schema.tutorial.type, type)))
  const tutorialIds = tutorials.map((row) => row.id)

  // 学生表打底 left join 进度：没读过的人也要出现在结果里，这是这张表的重点
  const progressJoin = tutorialIds.length
    ? and(
        eq(schema.tutorialProgress.userId, schema.user.id),
        inArray(schema.tutorialProgress.tutorialId, tutorialIds),
      )
    : sql`false`

  // 阅读和练习**分两条查**再在内存里拼。写成一条的话，一个学生读了 3 课、
  // 做了 8 道练习，join 出来是 24 行，count 全是错的 —— 两个一对多挂在同一张表上
  // 就是这个下场，用 filter 也救不回来
  const [rows, exerciseRows] = await Promise.all([
    db.select({
      userId: schema.user.id,
      username: schema.user.username,
      realName: schema.userProfile.realName,
      className: schema.user.className,
      // 「已读」按 TUTORIAL_READ_SECONDS 卡，不是「有这条记录」：点开一眼就退的不算。
      // 累计时长不卡，那些秒数照样算 —— 「已读 0 课、累计 25 分钟」是要看见的一种情况
      readCount: sql<number>`count(${schema.tutorialProgress.tutorialId}) filter (where ${schema.tutorialProgress.totalSeconds} >= ${TUTORIAL_READ_SECONDS})`.mapWith(Number),
      totalSeconds: sql<number>`coalesce(sum(${schema.tutorialProgress.totalSeconds}), 0)`.mapWith(Number),
      lastViewedAt: sql<string | null>`max(${schema.tutorialProgress.lastViewedAt})`,
    }).from(schema.user)
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .leftJoin(schema.tutorialProgress, progressJoin)
      .where(studentCondition(className.value))
      .groupBy(schema.user.id, schema.user.username, schema.userProfile.realName, schema.user.className),
    db.select({
      userId: schema.exerciseAttempt.userId,
      tried: count(),
      solved: sql<number>`count(*) filter (where ${schema.exerciseAttempt.solved})`.mapWith(Number),
      attempts: sql<number>`coalesce(sum(${schema.exerciseAttempt.attempts}), 0)`.mapWith(Number),
    }).from(schema.exerciseAttempt)
      .innerJoin(schema.exercise, eq(schema.exercise.id, schema.exerciseAttempt.exerciseId))
      .innerJoin(schema.tutorial, eq(schema.tutorial.id, schema.exercise.tutorialId))
      .where(and(eq(schema.tutorial.isPublic, true), eq(schema.tutorial.type, type)))
      .groupBy(schema.exerciseAttempt.userId),
  ])
  const attempts = new Map(exerciseRows.map((row) => [row.userId, row]))

  const [exerciseCountRow] = tutorialIds.length
    ? await db.select({ value: count() }).from(schema.exercise)
        .where(inArray(schema.exercise.tutorialId, tutorialIds))
    : [{ value: 0 }]

  return success(c, learnStudentProgressListSchema.parse({
    tutorialCount: tutorialIds.length,
    exerciseCount: exerciseCountRow?.value ?? 0,
    results: rows.map((row) => learnStudentProgressSchema.parse({
      ...row,
      exerciseTried: attempts.get(row.userId)?.tried ?? 0,
      exerciseSolved: attempts.get(row.userId)?.solved ?? 0,
      exerciseAttempts: attempts.get(row.userId)?.attempts ?? 0,
    })),
  }))
})

adminLearnRoutes.get("/learn-analytics/tutorials", requireTeacher, async (c) => {
  const type = tutorialTypeOf(c.req.query("type"))
  const className = classFilter(c.req.query("className"))
  if (!className.ok) return failure(c, 400, "invalid-class", "班级只能是数字")

  const [studentCountRow] = await db.select({ value: count() }).from(schema.user)
    .where(studentCondition(className.value))
  const studentCount = studentCountRow?.value ?? 0

  // 进度行 join 回 user 是为了让班级筛选生效，同时把老师自己试读的记录挡在外面
  const rows = await db.select({
    tutorialId: schema.tutorial.id,
    title: schema.tutorial.title,
    order: schema.tutorial.order,
    // 数的是 user.id 而不是 progress.user_id：join 不上的（老师自己试读的、
    // 已禁用的、不在所选班级的）在这一列是 NULL，count(distinct) 正好不算它，
    // 而 progress.user_id 那边永远非空，会把过滤当没发生
    readers: sql<number>`count(distinct ${schema.user.id}) filter (where ${schema.tutorialProgress.totalSeconds} >= ${TUTORIAL_READ_SECONDS})`.mapWith(Number),
    totalSeconds: sql<number>`coalesce(sum(${schema.tutorialProgress.totalSeconds}) filter (where ${schema.user.id} is not null), 0)`.mapWith(Number),
    // 人均时长的分母是 readers（读满 3 分钟的人），分子就得是同一批人的时长，
    // 否则拿全部时长去除达标人数，人均会被翻了一眼就走的人凭空抬高
    readSeconds: sql<number>`coalesce(sum(${schema.tutorialProgress.totalSeconds}) filter (where ${schema.tutorialProgress.totalSeconds} >= ${TUTORIAL_READ_SECONDS}), 0)`.mapWith(Number),
  }).from(schema.tutorial)
    .leftJoin(schema.tutorialProgress, eq(schema.tutorialProgress.tutorialId, schema.tutorial.id))
    .leftJoin(schema.user, and(
      eq(schema.user.id, schema.tutorialProgress.userId),
      studentCondition(className.value),
    ))
    // 学生条件写在 join 的 on 上而不是 where 上：写 where 会把没人读过的课整行滤掉，
    // 而「一节课一个人都没读」恰恰是老师最需要看见的一行
    .where(and(eq(schema.tutorial.isPublic, true), eq(schema.tutorial.type, type)))
    .groupBy(schema.tutorial.id, schema.tutorial.title, schema.tutorial.order)
    .orderBy(asc(schema.tutorial.order))

  return success(c, learnTutorialProgressListSchema.parse({
    studentCount,
    results: rows.map(({ readSeconds, ...row }) => learnTutorialProgressSchema.parse({
      ...row,
      avgSeconds: row.readers ? Math.round(readSeconds / row.readers) : 0,
    })),
  }))
})

/**
 * 按练习：哪道练一练卡住了全班。
 *
 * 一道题一行，含做过/做对的人数、做对的人平均试了几次、一次就做对的人数。
 * 没人做过的题也在列表里（一行零）—— 「这道题全班没一个人碰」同样是要看见的。
 */
adminLearnRoutes.get("/learn-analytics/exercises", requireTeacher, async (c) => {
  const type = tutorialTypeOf(c.req.query("type"))
  const className = classFilter(c.req.query("className"))
  if (!className.ok) return failure(c, 400, "invalid-class", "班级只能是数字")

  const [studentCountRow] = await db.select({ value: count() }).from(schema.user)
    .where(studentCondition(className.value))

  const rows = await db.select({
    exerciseId: schema.exercise.id,
    tutorialId: schema.tutorial.id,
    tutorialTitle: schema.tutorial.title,
    tutorialOrder: schema.tutorial.order,
    type: schema.exercise.type,
    order: schema.exercise.order,
    // 题干在 jsonb 里，各题型的字段名都叫 question；取不到就给空串，别让整行挂掉
    question: sql<string>`coalesce(${schema.exercise.data}->>'question', '')`,
    triedUsers: sql<number>`count(distinct ${schema.user.id})`.mapWith(Number),
    solvedUsers: sql<number>`count(distinct ${schema.user.id}) filter (where ${schema.exerciseAttempt.solved})`.mapWith(Number),
    firstTryUsers: sql<number>`count(distinct ${schema.user.id}) filter (where ${schema.exerciseAttempt.attemptsToSolve} = 1)`.mapWith(Number),
    attempts: sql<number>`coalesce(sum(${schema.exerciseAttempt.attempts}) filter (where ${schema.user.id} is not null), 0)`.mapWith(Number),
    // 只算做对的人：没做对的人「试了几次」还没停，混进平均值只会把它拉花
    avgAttemptsToSolve: sql<number>`coalesce(avg(${schema.exerciseAttempt.attemptsToSolve}) filter (where ${schema.user.id} is not null), 0)`.mapWith(Number),
  }).from(schema.exercise)
    .innerJoin(schema.tutorial, eq(schema.tutorial.id, schema.exercise.tutorialId))
    .leftJoin(schema.exerciseAttempt, eq(schema.exerciseAttempt.exerciseId, schema.exercise.id))
    // 学生条件挂在 join 的 on 上，不是 where 上：写 where 会把没人做过的题整行滤掉
    .leftJoin(schema.user, and(
      eq(schema.user.id, schema.exerciseAttempt.userId),
      studentCondition(className.value),
    ))
    .where(and(eq(schema.tutorial.isPublic, true), eq(schema.tutorial.type, type)))
    .groupBy(schema.exercise.id, schema.tutorial.id, schema.tutorial.title, schema.tutorial.order)
    .orderBy(asc(schema.tutorial.order), asc(schema.exercise.order))

  return success(c, learnExerciseProgressListSchema.parse({
    studentCount: studentCountRow?.value ?? 0,
    results: rows.map((row) => learnExerciseProgressSchema.parse({
      ...row,
      avgAttemptsToSolve: rounded(Number(row.avgAttemptsToSolve), 1),
    })),
  }))
})

/** 单道练习的逐人明细。后台表格展开某一行时才拉，不跟着列表一起下发 */
adminLearnRoutes.get("/learn-analytics/exercises/:id/attempts", requireTeacher, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const className = classFilter(c.req.query("className"))
  if (!className.ok) return failure(c, 400, "invalid-class", "班级只能是数字")

  const rows = await db.select({
    userId: schema.user.id,
    username: schema.user.username,
    realName: schema.userProfile.realName,
    className: schema.user.className,
    attempts: schema.exerciseAttempt.attempts,
    wrongAttempts: schema.exerciseAttempt.wrongAttempts,
    solved: schema.exerciseAttempt.solved,
    attemptsToSolve: schema.exerciseAttempt.attemptsToSolve,
    lastWrongAnswer: schema.exerciseAttempt.lastWrongAnswer,
    lastAttemptAt: schema.exerciseAttempt.lastAttemptAt,
  }).from(schema.exerciseAttempt)
    .innerJoin(schema.user, eq(schema.user.id, schema.exerciseAttempt.userId))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(and(eq(schema.exerciseAttempt.exerciseId, id), studentCondition(className.value)))
    // 没做对的排前面，错得最多的最前 —— 展开这一行的人是来找卡住的学生的
    .orderBy(asc(schema.exerciseAttempt.solved), desc(schema.exerciseAttempt.wrongAttempts))

  return success(c, rows.map((row) => learnExerciseAttemptSchema.parse(row)))
})

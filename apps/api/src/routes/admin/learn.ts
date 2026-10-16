import {
  FLOWCHART_PASS_GRADES,
  STUDENT_ROLES,
  isLessonDone,
  type LearnBoard,
  type LearnBoardStudent,
  type LearnExerciseAttemptList,
  type LearnExerciseProgress,
  type LearnExerciseProgressList,
  type LearnStudentDetail,
} from "@oj2/contract"
import { and, asc, count, desc, eq, inArray, isNull, like, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireTeacher, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { accepted } from "../../services/learning-stats"
import { defaultClassFor } from "../../services/ranking"
import { exerciseCountColumn, tutorialProblems } from "../../services/tutorial"
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

/**
 * 这些人在这些题上交过几次、做对没有。代码提交（不含比赛）和流程图提交并起来数，
 * 做对 = 代码 AC / AST_CHECK_FAILED 或流程图评到 A / S —— 和学生端课文里那个勾、
 * 课堂看板（routes/classroom.ts 的 activityRows）同一个口径。不论早晚：读这课之前
 * 在课上就做对的照样算。两边都按 `(problem_id, user_id)` 索引走。
 */
async function problemActivity(userIds: number[], problemIds: number[]) {
  if (!userIds.length || !problemIds.length) return []
  const code = db
    .select({
      userId: schema.submission.userId,
      problemId: schema.submission.problemId,
      createTime: schema.submission.createTime,
      solved: sql<boolean>`${inArray(schema.submission.result, accepted)}`.as("solved"),
    })
    .from(schema.submission)
    .where(
      and(
        isNull(schema.submission.contestId),
        inArray(schema.submission.userId, userIds),
        inArray(schema.submission.problemId, problemIds),
      ),
    )
  const flowchart = db
    .select({
      userId: schema.flowchartSubmission.userId,
      problemId: schema.flowchartSubmission.problemId,
      createTime: schema.flowchartSubmission.createTime,
      solved: sql<boolean>`${and(
        eq(schema.flowchartSubmission.status, 2),
        inArray(schema.flowchartSubmission.aiGrade, [...FLOWCHART_PASS_GRADES]),
      )}`.as("solved"),
    })
    .from(schema.flowchartSubmission)
    .where(
      and(
        inArray(schema.flowchartSubmission.userId, userIds),
        inArray(schema.flowchartSubmission.problemId, problemIds),
      ),
    )
  const activity = code.unionAll(flowchart).as("activity")
  return db
    .select({
      userId: activity.userId,
      problemId: activity.problemId,
      solved: sql<boolean>`bool_or(${activity.solved})`,
      submissions: count(),
      lastSubmitAt: sql<string>`max(${activity.createTime})`,
    })
    .from(activity)
    .groupBy(activity.userId, activity.problemId)
}

/**
 * 方块格：一个班的学生 × 这门课的每一课，打开过没有、学完没有（练一练全对）。
 *
 * 不选班就猜老师在教哪个班（`defaultClassFor`）；也能传年级前缀，
 * 但一个年级两三百行方块，页面上主要还是按班看。
 */
adminLearnRoutes.get("/learn-analytics/board", requireTeacher, async (c) => {
  const type = tutorialTypeOf(c.req.query("type"))
  const requested = classFilter(c.req.query("className"))
  if (!requested.ok) return failure(c, 400, "invalid-class", "班级只能是数字")
  const className = requested.value ?? (await defaultClassFor(c.get("user")!.id))

  const tutorials = await db
    .select({
      id: schema.tutorial.id,
      title: schema.tutorial.title,
      project: schema.tutorial.project,
      exerciseTotal: exerciseCountColumn,
    })
    .from(schema.tutorial)
    .where(and(eq(schema.tutorial.isPublic, true), eq(schema.tutorial.type, type)))
    .orderBy(asc(schema.tutorial.order))
    .then(async (rows) => {
      const problems = await tutorialProblems(
        rows.map((row) => row.id),
        true,
      )
      return rows.map((row) => ({
        ...row,
        problems: problems
          .filter((problem) => problem.tutorialId === row.id)
          .map(({ id, displayId, title }) => ({ id, displayId, title })),
      }))
    })
  const tutorialIds = tutorials.map((row) => row.id)
  if (!className)
    return success(c, { className: null, tutorials, students: [] } satisfies LearnBoard)

  const students = await db
    .select({
      userId: schema.user.id,
      username: schema.user.username,
      realName: schema.userProfile.realName,
      className: schema.user.className,
    })
    .from(schema.user)
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(studentCondition(className))
    .orderBy(asc(schema.user.className), asc(schema.user.username))
  const userIds = students.map((row) => row.userId)

  // 阅读、练习、配套题分开查再拼：几个一对多挂在同一张表上 join，count 全是错的
  const problemIds = [...new Set(tutorials.flatMap((row) => row.problems.map((p) => p.id)))]
  const problemRows = await problemActivity(userIds, problemIds)
  const problemsOf = new Map<number, LearnBoardStudent["problems"]>()
  for (const { userId, ...row } of problemRows) {
    const list = problemsOf.get(userId) ?? []
    list.push(row)
    problemsOf.set(userId, list)
  }
  const [progressRows, solvedRows] =
    userIds.length && tutorialIds.length
      ? await Promise.all([
          db
            .select({
              userId: schema.tutorialProgress.userId,
              tutorialId: schema.tutorialProgress.tutorialId,
              viewCount: schema.tutorialProgress.viewCount,
              totalSeconds: schema.tutorialProgress.totalSeconds,
              lastViewedAt: schema.tutorialProgress.lastViewedAt,
            })
            .from(schema.tutorialProgress)
            .where(
              and(
                inArray(schema.tutorialProgress.userId, userIds),
                inArray(schema.tutorialProgress.tutorialId, tutorialIds),
              ),
            ),
          db
            .select({
              userId: schema.exerciseAttempt.userId,
              tutorialId: schema.exercise.tutorialId,
              tried: count(),
              solved: sql<number>`count(*) filter (where ${schema.exerciseAttempt.solved})`.mapWith(
                Number,
              ),
              wrongAttempts:
                sql<number>`coalesce(sum(${schema.exerciseAttempt.wrongAttempts}), 0)`.mapWith(
                  Number,
                ),
            })
            .from(schema.exerciseAttempt)
            .innerJoin(schema.exercise, eq(schema.exercise.id, schema.exerciseAttempt.exerciseId))
            .where(
              and(
                inArray(schema.exerciseAttempt.userId, userIds),
                inArray(schema.exercise.tutorialId, tutorialIds),
              ),
            )
            .groupBy(schema.exerciseAttempt.userId, schema.exercise.tutorialId),
        ])
      : [[], []]

  const progress = new Map<string, (typeof progressRows)[number]>()
  for (const row of progressRows) progress.set(`${row.userId}:${row.tutorialId}`, row)
  const attempted = new Map<string, (typeof solvedRows)[number]>()
  for (const row of solvedRows) attempted.set(`${row.userId}:${row.tutorialId}`, row)

  return success(c, {
    className,
    tutorials,
    students: students.map((student) => {
      const opened: number[] = []
      const done: number[] = []
      const lessons: LearnBoardStudent["lessons"] = []
      let exerciseSolved = 0
      let totalSeconds = 0
      let lastViewedAt: string | null = null
      for (const tutorial of tutorials) {
        const key = `${student.userId}:${tutorial.id}`
        const row = progress.get(key)
        const exercises = attempted.get(key)
        const solvedHere = exercises?.solved ?? 0
        exerciseSolved += solvedHere
        if (exercises) {
          const { tried, solved, wrongAttempts } = exercises
          lessons.push({ tutorialId: tutorial.id, tried, solved, wrongAttempts })
        }
        if (row) {
          opened.push(tutorial.id)
          totalSeconds += row.totalSeconds
          if (!lastViewedAt || row.lastViewedAt > lastViewedAt) lastViewedAt = row.lastViewedAt
        }
        const lesson = {
          viewCount: row?.viewCount ?? 0,
          exerciseTotal: tutorial.exerciseTotal,
          exerciseSolved: solvedHere,
        }
        if (isLessonDone(lesson)) done.push(tutorial.id)
      }
      return {
        ...student,
        opened,
        done,
        exerciseSolved,
        lessons,
        problems: problemsOf.get(student.userId) ?? [],
        totalSeconds,
        lastViewedAt,
      }
    }),
  } satisfies LearnBoard)
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

  const [studentCountRow] = await db
    .select({ value: count() })
    .from(schema.user)
    .where(studentCondition(className.value))

  const rows = await db
    .select({
      exerciseId: schema.exercise.id,
      tutorialId: schema.tutorial.id,
      tutorialTitle: schema.tutorial.title,
      tutorialOrder: schema.tutorial.order,
      type: schema.exercise.type,
      order: schema.exercise.order,
      // 题干在 jsonb 里，各题型的字段名都叫 question；取不到就给空串，别让整行挂掉
      question: sql<string>`coalesce(${schema.exercise.data}->>'question', '')`,
      triedUsers: sql<number>`count(distinct ${schema.user.id})`.mapWith(Number),
      solvedUsers:
        sql<number>`count(distinct ${schema.user.id}) filter (where ${schema.exerciseAttempt.solved})`.mapWith(
          Number,
        ),
      firstTryUsers:
        sql<number>`count(distinct ${schema.user.id}) filter (where ${schema.exerciseAttempt.attemptsToSolve} = 1)`.mapWith(
          Number,
        ),
      attempts:
        sql<number>`coalesce(sum(${schema.exerciseAttempt.attempts}) filter (where ${schema.user.id} is not null), 0)`.mapWith(
          Number,
        ),
      // 只算做对的人：没做对的人「试了几次」还没停，混进平均值只会把它拉花
      avgAttemptsToSolve:
        sql<number>`coalesce(avg(${schema.exerciseAttempt.attemptsToSolve}) filter (where ${schema.user.id} is not null), 0)`.mapWith(
          Number,
        ),
    })
    .from(schema.exercise)
    .innerJoin(schema.tutorial, eq(schema.tutorial.id, schema.exercise.tutorialId))
    .leftJoin(schema.exerciseAttempt, eq(schema.exerciseAttempt.exerciseId, schema.exercise.id))
    // 学生条件挂在 join 的 on 上，不是 where 上：写 where 会把没人做过的题整行滤掉
    .leftJoin(
      schema.user,
      and(eq(schema.user.id, schema.exerciseAttempt.userId), studentCondition(className.value)),
    )
    .where(and(eq(schema.tutorial.isPublic, true), eq(schema.tutorial.type, type)))
    .groupBy(schema.exercise.id, schema.tutorial.id, schema.tutorial.title, schema.tutorial.order)
    .orderBy(asc(schema.tutorial.order), asc(schema.exercise.order))

  return success(c, {
    studentCount: studentCountRow?.value ?? 0,
    results: rows.map(
      (row) =>
        ({
          ...row,
          avgAttemptsToSolve: rounded(Number(row.avgAttemptsToSolve), 1),
        }) satisfies LearnExerciseProgress,
    ),
  } satisfies LearnExerciseProgressList)
})

/** 单道练习的逐人明细。后台表格展开某一行时才拉，不跟着列表一起下发 */
adminLearnRoutes.get("/learn-analytics/exercises/:id/attempts", requireTeacher, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const className = classFilter(c.req.query("className"))
  if (!className.ok) return failure(c, 400, "invalid-class", "班级只能是数字")

  const rows = await db
    .select({
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
    })
    .from(schema.exerciseAttempt)
    .innerJoin(schema.user, eq(schema.user.id, schema.exerciseAttempt.userId))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(and(eq(schema.exerciseAttempt.exerciseId, id), studentCondition(className.value)))
    // 没做对的排前面，错得最多的最前 —— 展开这一行的人是来找卡住的学生的
    .orderBy(asc(schema.exerciseAttempt.solved), desc(schema.exerciseAttempt.wrongAttempts))

  // 读过这课却没碰这道题的人：从这课的阅读记录出发，反连作答表取空
  const untried = await db
    .select({ userId: schema.user.id, username: schema.user.username })
    .from(schema.exercise)
    .innerJoin(
      schema.tutorialProgress,
      eq(schema.tutorialProgress.tutorialId, schema.exercise.tutorialId),
    )
    .innerJoin(schema.user, eq(schema.user.id, schema.tutorialProgress.userId))
    .leftJoin(
      schema.exerciseAttempt,
      and(
        eq(schema.exerciseAttempt.exerciseId, schema.exercise.id),
        eq(schema.exerciseAttempt.userId, schema.user.id),
      ),
    )
    .where(
      and(
        eq(schema.exercise.id, id),
        isNull(schema.exerciseAttempt.userId),
        studentCondition(className.value),
      ),
    )
    .orderBy(asc(schema.user.username))

  return success(c, { results: rows, untried } satisfies LearnExerciseAttemptList)
})

/**
 * 一个学生的自学明细：他打开过或做过练一练的每一课，每道练习做到哪了。
 *
 * 不限班级、也不限学生角色 —— 老师从方块格点进来的一定是学生，
 * 而按 id 查一个人的自学留痕本来就是老师能看的东西（方块格上全有）。
 */
adminLearnRoutes.get("/learn-analytics/students/:id", requireTeacher, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const type = tutorialTypeOf(c.req.query("type"))

  const [student] = await db
    .select({
      userId: schema.user.id,
      username: schema.user.username,
      className: schema.user.className,
    })
    .from(schema.user)
    .where(eq(schema.user.id, id))
  if (!student) return failure(c, 404, "user-not-found", "用户不存在")

  const visible = and(eq(schema.tutorial.isPublic, true), eq(schema.tutorial.type, type))
  const [tutorials, exercises] = await Promise.all([
    db
      .select({
        tutorialId: schema.tutorial.id,
        title: schema.tutorial.title,
        viewCount: schema.tutorialProgress.viewCount,
        totalSeconds: schema.tutorialProgress.totalSeconds,
        lastViewedAt: schema.tutorialProgress.lastViewedAt,
      })
      .from(schema.tutorial)
      .leftJoin(
        schema.tutorialProgress,
        and(
          eq(schema.tutorialProgress.tutorialId, schema.tutorial.id),
          eq(schema.tutorialProgress.userId, id),
        ),
      )
      .where(visible)
      .orderBy(asc(schema.tutorial.order)),
    db
      .select({
        tutorialId: schema.exercise.tutorialId,
        exerciseId: schema.exercise.id,
        type: schema.exercise.type,
        question: sql<string>`coalesce(${schema.exercise.data}->>'question', '')`,
        attempts: schema.exerciseAttempt.attempts,
        solved: schema.exerciseAttempt.solved,
        attemptsToSolve: schema.exerciseAttempt.attemptsToSolve,
        lastWrongAnswer: schema.exerciseAttempt.lastWrongAnswer,
        lastAttemptAt: schema.exerciseAttempt.lastAttemptAt,
      })
      .from(schema.exercise)
      .innerJoin(schema.tutorial, eq(schema.tutorial.id, schema.exercise.tutorialId))
      .leftJoin(
        schema.exerciseAttempt,
        and(
          eq(schema.exerciseAttempt.exerciseId, schema.exercise.id),
          eq(schema.exerciseAttempt.userId, id),
        ),
      )
      .where(visible)
      .orderBy(asc(schema.exercise.order)),
  ])

  const related = await tutorialProblems(
    tutorials.map((row) => row.tutorialId),
    true,
  )
  const activity = new Map(
    (
      await problemActivity(
        [id],
        related.map((row) => row.id),
      )
    ).map((row) => [row.problemId, row]),
  )

  const byLesson = new Map<number, LearnStudentDetail["lessons"][number]["exercises"]>()
  for (const { tutorialId, ...row } of exercises) {
    const list = byLesson.get(tutorialId) ?? []
    list.push({
      ...row,
      attempts: row.attempts ?? 0,
      solved: row.solved ?? false,
    })
    byLesson.set(tutorialId, list)
  }

  return success(c, {
    ...student,
    lessons: tutorials
      .map((row) => ({
        tutorialId: row.tutorialId,
        title: row.title,
        viewCount: row.viewCount ?? 0,
        totalSeconds: row.totalSeconds ?? 0,
        lastViewedAt: row.lastViewedAt,
        exercises: byLesson.get(row.tutorialId) ?? [],
        problems: related
          .filter((problem) => problem.tutorialId === row.tutorialId)
          .map(({ id: problemId, displayId, title }) => {
            const done = activity.get(problemId)
            return {
              id: problemId,
              displayId,
              title,
              solved: done?.solved ?? false,
              submissions: done?.submissions ?? 0,
              lastSubmitAt: done?.lastSubmitAt ?? null,
            }
          }),
      }))
      .filter((row) => row.viewCount > 0 || row.exercises.some((ex) => ex.attempts > 0)),
  } satisfies LearnStudentDetail)
})

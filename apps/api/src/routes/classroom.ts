import {
  classComparisonRequestSchema,
  STUDENT_ROLES,
  classLessonRequestSchema,
  type ClassActivity,
  type ClassBoard,
  type ClassBoardStudent,
  type ClassActivityProblem,
  type ClassComparison,
  type ClassComparisonResponse,
  type ClassRankItem,
  type ClassUserRank,
} from "@oj2/contract"
import { and, desc, eq, gte, inArray, isNotNull, isNull, like, lte, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, requireTeacher, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, parseBody, success } from "../http"
import { FLOWCHART_PASS_GRADES } from "../flowchart/grade"
import { JudgeStatus } from "../judge/status"
import { calendarDay, dayStart, localTime } from "../time"
import { queryInteger, rounded } from "./helpers"

export const classroomRoutes = new Hono<AppEnv>()

interface ClassUser {
  userId: number
  username: string
  className: string
  acceptedNumber: number
  submissionNumber: number
}

/**
 * 入班学生的 AC/提交数。`gradePrefix` 是年级（班号形如 `241` = 24 级 1 班），
 * 走 SQL 的 like 而不是拉全表再在内存里 startsWith —— 班级榜每换一次年级就要跑一遍，
 * 没必要每次都把全校一千多号人搬进进程。年级在调用处已校验为纯数字，不含 like 通配符。
 */
async function loadClassUsers(classNames?: string[], gradePrefix?: string) {
  const filters = [
    eq(schema.user.isDisabled, false),
    inArray(schema.user.adminType, [...STUDENT_ROLES]),
    sql`${schema.user.className} is not null`,
  ]
  if (classNames) filters.push(inArray(schema.user.className, classNames))
  if (gradePrefix) filters.push(like(schema.user.className, `${gradePrefix}%`))
  const rows = await db
    .select({
      userId: schema.user.id,
      username: schema.user.username,
      className: schema.user.className,
      acceptedNumber: schema.userProfile.acceptedNumber,
      submissionNumber: schema.userProfile.submissionNumber,
    })
    .from(schema.user)
    .innerJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(and(...filters))
  return rows.filter((row): row is ClassUser => row.className !== null)
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function quantile(values: number[], p: number) {
  if (values.length <= 1) return values[0] ?? 0
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length + 1) * p - 1
  if (position <= 0) return sorted[0]!
  if (position >= sorted.length - 1) return sorted.at(-1)!
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower]! + (sorted[lower + 1]! - sorted[lower]!) * fraction
}

function sampleStdDev(values: number[]) {
  if (values.length <= 1) return 0
  const average = mean(values)
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  )
}

classroomRoutes.get("/rankings/classes", async (c) => {
  const grade = c.req.query("grade")?.trim()
  if (!grade || !/^\d+$/.test(grade)) return failure(c, 400, "invalid-grade", "grade is required")
  const users = await loadClassUsers(undefined, grade)
  const groups = new Map<string, ClassUser[]>()
  for (const user of users)
    groups.set(user.className, [...(groups.get(user.className) ?? []), user])
  const result = [...groups]
    .map(([className, members]) => {
      const totalAc = members.reduce((sum, member) => sum + member.acceptedNumber, 0)
      const totalSubmission = members.reduce((sum, member) => sum + member.submissionNumber, 0)
      return {
        className,
        userCount: members.length,
        totalAc,
        totalSubmission,
        avgAc: rounded(totalAc / members.length),
        acRate: totalSubmission > 0 ? rounded((totalAc / totalSubmission) * 100) : 0,
      }
    })
    .sort((a, b) => b.totalAc - a.totalAc || a.totalSubmission - b.totalSubmission)
  return success(
    c,
    result.map((item, index) => ({ ...item, rank: index + 1 }) satisfies ClassRankItem),
  )
})

classroomRoutes.get("/me/class-rank", requireAuth, async (c) => {
  const user = c.get("user")!
  if (!user.className) return failure(c, 400, "class-missing", "用户没有班级信息")
  const members = (await loadClassUsers([user.className])).sort(
    (a, b) => b.acceptedNumber - a.acceptedNumber || a.submissionNumber - b.submissionNumber,
  )
  const ranks = members.map((member, index) => ({
    userId: member.userId,
    username: member.username,
    acceptedNumber: member.acceptedNumber,
    submissionNumber: member.submissionNumber,
    rank: index + 1,
  }))
  const myRank = ranks.find((rank) => rank.userId === user.id)?.rank ?? -1
  const showAll = c.req.query("scope") === "all"
  let selected = ranks
  if (showAll) {
    const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
    const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
    selected = ranks.slice(offset, offset + limit)
  } else if (myRank > 0 && ranks.length > 10) {
    const start = Math.min(Math.max(0, myRank - 6), ranks.length - 10)
    selected = ranks.slice(start, start + 10)
  }
  return success(c, {
    className: user.className,
    myRank,
    total: ranks.length,
    ranks: selected,
  } satisfies ClassUserRank)
})

/**
 * 同班同一天有这么多人做过，就算「班里在做」。2025 秋的实测分布是两极的：
 * (班级, 日, 题) 要么只有 1 个人（自己在刷），要么 13 人以上（老师点的题），
 * 5 落在中间的空档里，最小的那几个班（十来个人）也够得着。
 */
const CLASS_ACTIVITY_MIN_USERS = 5
/** 往回找几天：上完课第二天在家补作业、请假回来的学生，都还能看到上一次课做了什么 */
const CLASS_ACTIVITY_LOOKBACK_DAYS = 7
const CLASS_ACTIVITY_LIMIT = 8
/** AST_CHECK_FAILED 也是答案对了，与周榜同口径 */
const SOLVED_RESULTS = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

interface ClassDayGroup {
  day: string
  problemId: number
  firstAt: string
  userCount: number
  acceptedCount: number
}

/**
 * 某个班从 `since` 起、按（东八区日, 题）分组的做题人数和通过人数。只算正常状态的学生，
 * 不含比赛提交。`minUsers` 是「班里在做」的门槛，给了 `problemIds`（老师布置的题）时
 * 不设门槛 —— 那几道题是确定的，一个人都没交也要列出来。
 */
async function classDayGroups(
  className: string,
  since: string,
  options: { minUsers?: number; problemIds?: number[] } = {},
): Promise<ClassDayGroup[]> {
  const day = sql<string>`to_char(${localTime(schema.submission.createTime)}, 'YYYY-MM-DD')`
  const userCount = sql<number>`count(distinct ${schema.submission.userId})::int`
  const query = db
    .select({
      day,
      problemId: schema.submission.problemId,
      firstAt: sql<string>`min(${schema.submission.createTime})`,
      userCount,
      acceptedCount: sql<number>`count(distinct ${schema.submission.userId}) filter (where ${inArray(schema.submission.result, SOLVED_RESULTS)})::int`,
    })
    .from(schema.submission)
    .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
    .where(
      and(
        isNull(schema.submission.contestId),
        gte(schema.submission.createTime, since),
        eq(schema.user.className, className),
        eq(schema.user.isDisabled, false),
        inArray(schema.user.adminType, [...STUDENT_ROLES]),
        options.problemIds ? inArray(schema.submission.problemId, options.problemIds) : undefined,
      ),
    )
    .groupBy(day, schema.submission.problemId)
  return options.minUsers ? query.having(sql`${userCount} >= ${options.minUsers}`) : query
}

/** 按 id 取题，只留学生看得见的（题库里、visible），被藏起来的点进去也是 404 */
async function visibleProblems(ids: number[]) {
  if (!ids.length) return new Map<number, { id: number; displayId: string; title: string }>()
  const rows = await db
    .select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      title: schema.problem.title,
    })
    .from(schema.problem)
    .where(
      and(
        inArray(schema.problem.id, ids),
        eq(schema.problem.visible, true),
        isNull(schema.problem.contestId),
      ),
    )
  return new Map(rows.map((row) => [row.id, row]))
}

/** 老师给这个班今天布置的题（problem.id，按输入顺序）；没布置为 null */
async function lessonProblemIds(className: string, day: string) {
  const [row] = await db
    .select({ problemIds: schema.classLesson.problemIds })
    .from(schema.classLesson)
    .where(and(eq(schema.classLesson.className, className), eq(schema.classLesson.day, day)))
    .limit(1)
  return row?.problemIds.length ? row.problemIds : null
}

/**
 * 班里「这节课」的题。老师在课堂看板布置过就用老师的（source = teacher），
 * 否则从同班提交记录推断（source = inferred）：同班同一天 ≥ 5 人做过的题，只取最近的
 * **一天**、按那天第一次有人提交的时间排 —— 大致就是老师点题的顺序。
 *
 * 老师布置的优先，是因为推断在上课头几分钟是空的（还没人交），而那正是没听清题号的
 * 学生最需要它的时候。
 */
async function classLessonProblems(className: string, lookbackDays: number) {
  const today = calendarDay()
  const planned = await lessonProblemIds(className, today)
  if (planned) {
    const [problems, groups] = await Promise.all([
      visibleProblems(planned),
      classDayGroups(className, dayStart(), { problemIds: planned }),
    ])
    const groupById = new Map(groups.map((row) => [row.problemId, row]))
    return {
      source: "teacher" as const,
      day: today,
      problems: planned.flatMap((id) => {
        const problem = problems.get(id)
        if (!problem) return []
        const group = groupById.get(id)
        return [
          {
            ...problem,
            userCount: group?.userCount ?? 0,
            acceptedCount: group?.acceptedCount ?? 0,
          },
        ]
      }),
    }
  }

  const since = dayStart(Date.now() - (lookbackDays - 1) * 86_400_000)
  const groups = await classDayGroups(className, since, { minUsers: CLASS_ACTIVITY_MIN_USERS })
  const latest = groups.reduce<string | null>(
    (acc, row) => (!acc || row.day > acc ? row.day : acc),
    null,
  )
  const picked = groups
    .filter((row) => row.day === latest)
    .sort((a, b) => a.firstAt.localeCompare(b.firstAt))
    .slice(0, CLASS_ACTIVITY_LIMIT)
  const problems = await visibleProblems(picked.map((row) => row.problemId))
  return {
    source: picked.length ? ("inferred" as const) : null,
    day: picked.length ? latest : null,
    problems: picked.flatMap((row) => {
      const problem = problems.get(row.problemId)
      return problem
        ? [{ ...problem, userCount: row.userCount, acceptedCount: row.acceptedCount }]
        : []
    }),
  }
}

/**
 * 学生首页的「班里在做」。课上老师报题号、全班去找 —— 这是 2025 秋七成非比赛提交的
 * 来路，但界面上原本没有它的入口，没听清题号的只能问同桌。
 */
classroomRoutes.get("/me/class-activity", requireAuth, async (c) => {
  const user = c.get("user")!
  if (!user.className) {
    return success(c, {
      className: null,
      day: null,
      source: null,
      problems: [],
    } satisfies ClassActivity)
  }

  const lesson = await classLessonProblems(user.className, CLASS_ACTIVITY_LOOKBACK_DAYS)
  const ids = lesson.problems.map((problem) => problem.id)
  const mine = ids.length
    ? await db
        .select({
          problemId: schema.submission.problemId,
          accepted: sql<boolean>`bool_or(${inArray(schema.submission.result, SOLVED_RESULTS)})`,
        })
        .from(schema.submission)
        .where(
          and(
            eq(schema.submission.userId, user.id),
            inArray(schema.submission.problemId, ids),
            isNull(schema.submission.contestId),
          ),
        )
        .groupBy(schema.submission.problemId)
    : []
  const mineById = new Map(mine.map((row) => [row.problemId, row.accepted]))

  // 流程图作业：画到 A / S 也算做完（设计文档 2026-09-28-problem-page-redesign 第 3 节决定 6）。
  // 有的题流程图交了几百次、代码个位数，只看代码提交的话，这些学生在课堂条上永远是「没做」
  const drawn = ids.length
    ? await db
        .select({
          problemId: schema.flowchartSubmission.problemId,
          passed: sql<boolean>`bool_or(${inArray(schema.flowchartSubmission.aiGrade, FLOWCHART_PASS_GRADES)})`,
        })
        .from(schema.flowchartSubmission)
        .where(
          and(
            eq(schema.flowchartSubmission.userId, user.id),
            inArray(schema.flowchartSubmission.problemId, ids),
            // 只数评完了的：评分中、评失败的那次不算「做过」
            eq(schema.flowchartSubmission.status, 2),
          ),
        )
        .groupBy(schema.flowchartSubmission.problemId)
    : []
  for (const row of drawn) {
    mineById.set(row.problemId, (mineById.get(row.problemId) ?? false) || row.passed)
  }

  return success(c, {
    className: user.className,
    day: lesson.day,
    source: lesson.source,
    problems: lesson.problems.map((problem) => {
      const accepted = mineById.get(problem.id)
      return {
        problemDisplayId: problem.displayId,
        title: problem.title,
        userCount: problem.userCount,
        acceptedCount: problem.acceptedCount,
        myStatus: accepted === undefined ? "none" : accepted ? "accepted" : "tried",
      } satisfies ClassActivityProblem
    }),
  } satisfies ClassActivity)
})

/**
 * 看板上的「最近几节课交了几节」：分清「今天没来」和「一直不动手」。2025 秋至少上过
 * 5 节课的学生里，12.5% 七成以上的课一道都没交，37% 的学生贡献了一半以上的「没交」
 * —— 当堂那份名单把这两种人排在同一行里，老师分不出来。
 */
const RECENT_LESSONS = 5
/** 往回找最近几节课时最多看多远：寒暑假之后开学第一节课，前面几节是上学期的，没意义 */
const RECENT_LESSONS_WINDOW_DAYS = 45

/** 看板没指定班级时，猜「最近这么久里提交人数最多的班」—— 老师多半正在上这个班的课 */
const ACTIVE_CLASS_WINDOW_MS = 2 * 60 * 60 * 1000

/**
 * 从实际提交猜正在上课的班，而**不是记住老师上次选的**：统计面板吃过那个亏（上一节课
 * 的班悄悄留在框里，老师看的整个是别人的班，见 StatisticsPanel.vue 的注释）。
 */
async function suggestActiveClass() {
  const users = sql<number>`count(distinct ${schema.submission.userId})::int`
  const [row] = await db
    .select({ className: schema.user.className, users })
    .from(schema.submission)
    .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
    .where(
      and(
        gte(
          schema.submission.createTime,
          new Date(Date.now() - ACTIVE_CLASS_WINDOW_MS).toISOString(),
        ),
        isNull(schema.submission.contestId),
        isNotNull(schema.user.className),
        eq(schema.user.isDisabled, false),
        inArray(schema.user.adminType, [...STUDENT_ROLES]),
      ),
    )
    .groupBy(schema.user.className)
    .orderBy(desc(users))
    .limit(1)
  return row?.className ?? null
}

/**
 * 课堂看板：这个班、今天、这节课的几道题 × 全班学生。老师在课上用它看谁还没开始、
 * 谁卡住了 —— 2025 秋平均每节课有 14 个平时在用的学生一道都没交（占三分之一），
 * 而交了 3 次以上还没过的平均不到 1 个，所以「还没开始」才是这张表的重点，排序在前端。
 */
classroomRoutes.get("/classroom/board", requireTeacher, async (c) => {
  const day = calendarDay()
  const className = c.req.query("className")?.trim() || (await suggestActiveClass())
  if (!className) {
    return success(c, {
      className: null,
      day,
      source: null,
      problems: [],
      students: [],
      recentLessons: 0,
    } satisfies ClassBoard)
  }

  // 推断只看今天（回看 1 天）：看板是给这节课用的，昨天的题不该冒出来
  const lesson = await classLessonProblems(className, 1)
  const ids = lesson.problems.map((problem) => problem.id)
  const start = dayStart()

  const roster = await db
    .select({
      userId: schema.user.id,
      username: schema.user.username,
      realName: schema.userProfile.realName,
    })
    .from(schema.user)
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(
      and(
        eq(schema.user.className, className),
        eq(schema.user.isDisabled, false),
        inArray(schema.user.adminType, [...STUDENT_ROLES]),
      ),
    )
  const userIds = roster.map((row) => row.userId)

  // 最近几节课：这个班同学一起做题的那些天（不含今天）
  const windowStart = dayStart(Date.now() - RECENT_LESSONS_WINDOW_DAYS * 86_400_000)
  const recentDays = [
    ...new Set(
      (await classDayGroups(className, windowStart, { minUsers: CLASS_ACTIVITY_MIN_USERS })).map(
        (row) => row.day,
      ),
    ),
  ]
    .filter((d) => d < day)
    .sort()
    .slice(-RECENT_LESSONS)

  const localDay = sql<string>`to_char(${localTime(schema.submission.createTime)}, 'YYYY-MM-DD')`
  const [cells, lastSubmits, attendance] = await Promise.all([
    ids.length && userIds.length
      ? db
          .select({
            userId: schema.submission.userId,
            problemId: schema.submission.problemId,
            attempts: sql<number>`count(*) filter (where ${gte(schema.submission.createTime, start)})::int`,
            firstAcceptedAt: sql<
              string | null
            >`min(${schema.submission.createTime}) filter (where ${inArray(schema.submission.result, SOLVED_RESULTS)})`,
          })
          .from(schema.submission)
          .where(
            and(
              isNull(schema.submission.contestId),
              inArray(schema.submission.userId, userIds),
              inArray(schema.submission.problemId, ids),
            ),
          )
          .groupBy(schema.submission.userId, schema.submission.problemId)
      : [],
    userIds.length
      ? db
          .select({
            userId: schema.submission.userId,
            lastAt: sql<string>`max(${schema.submission.createTime})`,
          })
          .from(schema.submission)
          .where(
            and(
              inArray(schema.submission.userId, userIds),
              gte(schema.submission.createTime, start),
            ),
          )
          .groupBy(schema.submission.userId)
      : [],
    recentDays.length && userIds.length
      ? db
          .select({
            userId: schema.submission.userId,
            days: sql<number>`count(distinct ${localDay})::int`,
          })
          .from(schema.submission)
          .where(
            and(
              isNull(schema.submission.contestId),
              inArray(schema.submission.userId, userIds),
              gte(schema.submission.createTime, windowStart),
              inArray(localDay, recentDays),
            ),
          )
          .groupBy(schema.submission.userId)
      : [],
  ])
  const cellByKey = new Map(cells.map((row) => [`${row.userId}:${row.problemId}`, row]))
  const lastByUser = new Map(lastSubmits.map((row) => [row.userId, row.lastAt]))
  const attendedByUser = new Map(attendance.map((row) => [row.userId, row.days]))

  return success(c, {
    className,
    day,
    source: lesson.source,
    problems: lesson.problems.map((problem) => ({
      problemId: problem.id,
      problemDisplayId: problem.displayId,
      title: problem.title,
    })),
    students: roster.map(
      (student) =>
        ({
          userId: student.userId,
          username: student.username,
          realName: student.realName ?? null,
          cells: ids.map((id) => {
            const cell = cellByKey.get(`${student.userId}:${id}`)
            return {
              status: !cell ? "none" : cell.firstAcceptedAt ? "accepted" : "tried",
              attempts: cell?.attempts ?? 0,
              acceptedAt: cell?.firstAcceptedAt ?? null,
            }
          }),
          lastSubmitAt: lastByUser.get(student.userId) ?? null,
          recentAttended: attendedByUser.get(student.userId) ?? 0,
        }) satisfies ClassBoardStudent,
    ),
    recentLessons: recentDays.length,
  } satisfies ClassBoard)
})

/**
 * 老师给这个班布置今天的题。按展示题号给、不分大小写，存 problem.id 并保留输入顺序；
 * 有对不上的题号就整个拒掉并点名是哪几个，免得存下半张单子老师还不知道。空数组 = 清掉，
 * 学生那边退回推断。
 */
classroomRoutes.put("/classroom/lesson", requireTeacher, async (c) => {
  const parsed = await parseBody(c, classLessonRequestSchema, "题号格式不对")
  if (!parsed.success) return parsed.response
  const user = c.get("user")!
  const { className, problemDisplayIds } = parsed.data
  const day = calendarDay()

  const [exists] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.className, className))
    .limit(1)
  if (!exists) return failure(c, 400, "class-not-found", `没有 ${className} 这个班`)

  if (!problemDisplayIds.length) {
    await db
      .delete(schema.classLesson)
      .where(and(eq(schema.classLesson.className, className), eq(schema.classLesson.day, day)))
    return success(c, null)
  }

  const wanted = [...new Set(problemDisplayIds.map((id) => id.toLowerCase()))]
  const found = await db
    .select({ id: schema.problem.id, displayId: schema.problem.displayId })
    .from(schema.problem)
    .where(
      and(
        inArray(sql<string>`lower(${schema.problem.displayId})`, wanted),
        eq(schema.problem.visible, true),
        isNull(schema.problem.contestId),
      ),
    )
  const idByDisplay = new Map(found.map((row) => [row.displayId.toLowerCase(), row.id]))
  const missing = wanted.filter((id) => !idByDisplay.has(id))
  if (missing.length) {
    return failure(c, 400, "problem-not-found", `这些题号不存在或没有公开：${missing.join("、")}`)
  }

  const problemIds = wanted.map((id) => idByDisplay.get(id)!)
  const now = new Date().toISOString()
  await db
    .insert(schema.classLesson)
    .values({ className, day, problemIds, createdBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.classLesson.className, schema.classLesson.day],
      set: { problemIds, createdBy: user.id, updatedAt: now },
    })
  return success(c, null)
})

classroomRoutes.post("/classes/comparison", async (c) => {
  const parsed = await parseBody(c, classComparisonRequestSchema, "At least one class is required")
  if (!parsed.success) return parsed.response
  const users = await loadClassUsers(parsed.data.classNames)
  const allAc = users.map((user) => user.acceptedNumber)
  const globalQ1 = quantile(allAc, 0.25)
  const globalQ3 = quantile(allAc, 0.75)
  const byClass = new Map<string, ClassUser[]>()
  for (const user of users)
    byClass.set(user.className, [...(byClass.get(user.className) ?? []), user])

  let recentByUser = new Map<number, Set<number>>()
  let recentSubmissionCount = new Map<string, number>()
  const hasTimeRange = Boolean(parsed.data.startTime && parsed.data.endTime)
  if (hasTimeRange) {
    const rows = await db
      .select({
        userId: schema.submission.userId,
        problemId: schema.submission.problemId,
        result: schema.submission.result,
      })
      .from(schema.submission)
      .where(
        and(
          inArray(
            schema.submission.userId,
            users.map((user) => user.userId),
          ),
          gte(schema.submission.createTime, parsed.data.startTime!),
          lte(schema.submission.createTime, parsed.data.endTime!),
        ),
      )
    const userClass = new Map(users.map((user) => [user.userId, user.className]))
    for (const row of rows) {
      const className = userClass.get(row.userId)
      if (!className) continue
      recentSubmissionCount.set(className, (recentSubmissionCount.get(className) ?? 0) + 1)
      if ([JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED].includes(row.result as 0 | 10)) {
        const set = recentByUser.get(row.userId) ?? new Set<number>()
        set.add(row.problemId)
        recentByUser.set(row.userId, set)
      }
    }
  }

  const comparisons = [...byClass].map(([className, members]) => {
    const ac = members.map((member) => member.acceptedNumber).sort((a, b) => b - a)
    const submissions = members.map((member) => member.submissionNumber).sort((a, b) => b - a)
    const userCount = members.length
    const topCount = Math.max(1, Math.ceil(userCount * 0.1))
    const bottomCount = topCount
    const middle = topCount + bottomCount < userCount ? ac.slice(topCount, -bottomCount) : ac
    const totalAc = ac.reduce((sum, value) => sum + value, 0)
    const totalSubmission = submissions.reduce((sum, value) => sum + value, 0)
    const base: ClassComparison = {
      className,
      userCount,
      totalAc,
      totalSubmission,
      avgAc: rounded(mean(ac)),
      medianAc: rounded(median(ac)),
      q1Ac: rounded(quantile(ac, 0.25)),
      q3Ac: rounded(quantile(ac, 0.75)),
      iqr: rounded(quantile(ac, 0.75) - quantile(ac, 0.25)),
      stdDev: rounded(sampleStdDev(ac)),
      top10Avg: rounded(mean(ac.slice(0, topCount))),
      middle80Avg: rounded(mean(middle)),
      bottom10Avg: rounded(mean(ac.slice(-bottomCount))),
      excellentRate: rounded((ac.filter((value) => value >= globalQ3).length / userCount) * 100),
      passRate: rounded((ac.filter((value) => value >= globalQ1).length / userCount) * 100),
      activeRate: rounded((submissions.filter((value) => value > 0).length / userCount) * 100),
      acRate: totalSubmission > 0 ? rounded((totalAc / totalSubmission) * 100) : 0,
      compositeScore: 0,
    }
    if (hasTimeRange) {
      const recent = members
        .map((member) => recentByUser.get(member.userId)?.size ?? 0)
        .sort((a, b) => b - a)
      base.recentTotalAc = recent.reduce((sum, value) => sum + value, 0)
      base.recentTotalSubmission = recentSubmissionCount.get(className) ?? 0
      base.recentAvgAc = rounded(mean(recent))
      base.recentMedianAc = rounded(median(recent))
      base.recentTop10Avg = rounded(
        mean(recent.slice(0, Math.max(1, Math.ceil(recent.length * 0.1)))),
      )
      base.recentActiveCount = recent.filter((value) => value > 0).length
    }
    return base
  })
  const maxMedian = Math.max(1, ...comparisons.map((item) => item.medianAc))
  const maxMiddle = Math.max(1, ...comparisons.map((item) => item.middle80Avg))
  for (const item of comparisons) {
    item.compositeScore = rounded(
      0.4 * ((item.medianAc / maxMedian) * 100) +
        0.15 * ((item.middle80Avg / maxMiddle) * 100) +
        0.2 * item.activeRate +
        0.15 * item.passRate +
        0.1 * item.excellentRate,
      1,
    )
  }
  comparisons.sort((a, b) => b.compositeScore - a.compositeScore || b.medianAc - a.medianAc)
  return success(c, {
    comparisons,
    hasTimeRange,
  } satisfies ClassComparisonResponse)
})

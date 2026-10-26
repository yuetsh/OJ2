import {
  isSqlProblem,
  STUDENT_ROLES,
  classLessonRequestSchema,
  type ClassActivity,
  type ClassToday,
  type ClassBoard,
  type ClassBoardStudent,
  type ClassLesson,
  type ClassActivityProblem,
  type LastVisit,
  type LessonLanguage,
  type StatisticInfo,
} from "@oj2/contract"
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, requireTeacher, type AppEnv } from "../auth/middleware"
import { seenToday } from "../auth/presence"
import { getLoginWindow } from "../auth/session"
import { presenceOf } from "../collab/state"
import { db, schema } from "../db"
import { challengeSuccessesOf } from "../services/challenge"
import { failure, parseBody, success } from "../http"
import { isAccepted } from "../judge/status"
import {
  activityRows,
  classMemberIds,
  FLOWCHART_PASSED,
  lessonLanguageFilter,
  SOLVED_RESULTS,
  suggestActiveClass,
} from "../services/class-activity"
import { accepted } from "../services/learning-stats"
import { calendarDay, dayStart, localTime } from "../time"

export const classroomRoutes = new Hono<AppEnv>()

/**
 * 同班同一天有这么多人做过，就算「班里在做」。2025 秋的实测分布是两极的：
 * (班级, 日, 题) 要么只有 1 个人（自己在刷），要么 13 人以上（老师点的题），
 * 5 落在中间的空档里，最小的那几个班（十来个人）也够得着。
 */
const CLASS_ACTIVITY_MIN_USERS = 5
/** 往回找几天：上完课第二天在家补作业、请假回来的学生，都还能看到上一次课做了什么 */
const CLASS_ACTIVITY_LOOKBACK_DAYS = 7
const CLASS_ACTIVITY_LIMIT = 8
interface ClassDayGroup {
  day: string
  problemId: number
  firstAt: string
  userCount: number
  acceptedCount: number
}

/**
 * 某个班从 `since` 起、按（东八区日, 题）分组的做题人数和通过人数。只算正常状态的学生，
 * 不含比赛提交，代码和流程图合起来数（见 activityRows）。`minUsers` 是「班里在做」的门槛，
 * 给了 `problemIds`（老师布置的题）时不设门槛 —— 那几道题是确定的，一个人都没交也要列出来。
 */
async function classDayGroups(
  className: string,
  since: string,
  options: { minUsers?: number; problemIds?: number[]; language?: LessonLanguage | null } = {},
): Promise<ClassDayGroup[]> {
  const activity = activityRows({
    since,
    users: classMemberIds(className),
    problemIds: options.problemIds,
    language: options.language,
  })
  const day = sql<string>`to_char(${localTime(activity.createTime)}, 'YYYY-MM-DD')`
  const userCount = sql<number>`count(distinct ${activity.userId})::int`
  const query = db
    .select({
      day,
      problemId: activity.problemId,
      firstAt: sql<string>`min(${activity.createTime})`,
      userCount,
      acceptedCount: sql<number>`count(distinct ${activity.userId}) filter (where ${activity.solved})::int`,
    })
    .from(activity)
    .groupBy(day, activity.problemId)
  return options.minUsers ? query.having(sql`${userCount} >= ${options.minUsers}`) : query
}

/** 按 id 取题，只留学生看得见的（题库里、visible），被藏起来的点进去也是 404 */
async function visibleProblems(ids: number[]) {
  if (!ids.length)
    return new Map<number, { id: number; displayId: string; title: string; isSql: boolean }>()
  const rows = await db
    .select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      title: schema.problem.title,
      isSql: sql<boolean>`${schema.problem.languages} @> '["SQL"]'::jsonb`,
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

/**
 * 老师给这个班今天布置的题（problem.id，按输入顺序）、选的语言、布置时刻和布置的老师；
 * 没布置为 null。老师写真名：老师之间认的是名字，用户名（lwp0201、little）认不出是谁
 */
async function lessonPlan(className: string, day: string) {
  const [row] = await db
    .select({
      problemIds: schema.classLesson.problemIds,
      language: schema.classLesson.language,
      createdAt: schema.classLesson.createdAt,
      createdBy: sql<string>`coalesce(nullif(${schema.userProfile.realName}, ''), ${schema.user.username})`,
    })
    .from(schema.classLesson)
    .innerJoin(schema.user, eq(schema.user.id, schema.classLesson.createdBy))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.classLesson.createdBy))
    .where(and(eq(schema.classLesson.className, className), eq(schema.classLesson.day, day)))
    .limit(1)
  return row?.problemIds.length ? row : null
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
  const plan = await lessonPlan(className, today)
  if (plan) {
    const planned = plan.problemIds
    const [problems, groups] = await Promise.all([
      visibleProblems(planned),
      classDayGroups(className, dayStart(), { problemIds: planned, language: plan.language }),
    ])
    const groupById = new Map(groups.map((row) => [row.problemId, row]))
    return {
      source: "teacher" as const,
      day: today,
      language: plan.language ?? null,
      assignedAt: plan.createdAt,
      assignedBy: plan.createdBy,
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
    // 推断出来的课不知道老师要的是哪种语言，不限
    language: null,
    assignedAt: null,
    assignedBy: null,
    problems: picked.flatMap((row) => {
      const problem = problems.get(row.problemId)
      return problem
        ? [{ ...problem, userCount: row.userCount, acceptedCount: row.acceptedCount }]
        : []
    }),
  }
}

/** 「上次来」超过这么多天就不提那次做了什么，只在问候里说一句隔了多久 */
const LAST_VISIT_MAX_DAYS = 30

/**
 * 首页的「上次来」卡：上次登录到这次登录之间交过什么、哪道还没做对。
 * 原来是登录后弹的「登录速报」，数字外加 AI 两句话 —— AI 只拿到那五个数，说的就是复述，
 * 还要同步等模型（最长 60 秒）弹框才出来；现在拆进首页，没做对的题给「接着做」
 */
classroomRoutes.get("/me/last-visit", requireAuth, async (c) => {
  const user = c.get("user")!
  const window = await getLoginWindow(c)
  const previousLogin = window?.previousLogin ?? null
  if (
    !window ||
    !previousLogin ||
    Date.now() - new Date(previousLogin).getTime() > LAST_VISIT_MAX_DAYS * 864e5
  ) {
    return success(c, { previousLogin, summary: null } satisfies LastVisit)
  }
  const rows = await db
    .select({
      problemId: schema.submission.problemId,
      problemDisplayId: schema.problem.displayId,
      title: schema.problem.title,
      result: schema.submission.result,
      createTime: schema.submission.createTime,
    })
    .from(schema.submission)
    .innerJoin(schema.problem, eq(schema.problem.id, schema.submission.problemId))
    .where(
      and(
        eq(schema.submission.userId, user.id),
        isNull(schema.submission.contestId),
        gte(schema.submission.createTime, previousLogin),
        lt(schema.submission.createTime, window.loginAt),
      ),
    )
    .orderBy(asc(schema.submission.createTime))
  if (!rows.length) return success(c, { previousLogin, summary: null } satisfies LastVisit)

  // 按题归拢：rows 按时间正序，所以后来的覆盖 lastResult / lastTime，第一次 AC 的先进 solved
  const byProblem = new Map<
    number,
    {
      problemDisplayId: string
      title: string
      attempts: number
      lastResult: (typeof rows)[number]["result"]
      lastTime: string
      solved: boolean
    }
  >()
  const solved: { problemDisplayId: string; title: string }[] = []
  for (const row of rows) {
    const item = byProblem.get(row.problemId) ?? {
      problemDisplayId: row.problemDisplayId,
      title: row.title,
      attempts: 0,
      lastResult: row.result,
      lastTime: row.createTime,
      solved: false,
    }
    item.attempts++
    item.lastResult = row.result
    item.lastTime = row.createTime
    if (!item.solved && accepted.includes(row.result)) {
      item.solved = true
      solved.push({ problemDisplayId: row.problemDisplayId, title: row.title })
    }
    byProblem.set(row.problemId, item)
  }
  // 那次没做对的，再看以前、以及这次登录之后有没有做对过 —— 做对过的就不再催「接着做」
  const tried = [...byProblem].filter(([, item]) => !item.solved).map(([id]) => id)
  const everSolved = tried.length
    ? new Set(
        (
          await db
            .selectDistinct({ problemId: schema.submission.problemId })
            .from(schema.submission)
            .where(
              and(
                eq(schema.submission.userId, user.id),
                isNull(schema.submission.contestId),
                inArray(schema.submission.problemId, tried),
                inArray(schema.submission.result, accepted),
              ),
            )
        ).map((row) => row.problemId),
      )
    : new Set<number>()
  const unsolved = tried
    .filter((id) => !everSolved.has(id))
    .map((id) => byProblem.get(id)!)
    .sort((a, b) => b.lastTime.localeCompare(a.lastTime))
    .slice(0, 3)
    .map(({ problemDisplayId, title, attempts, lastResult }) => ({
      problemDisplayId,
      title,
      attempts,
      lastResult,
    }))
  return success(c, {
    previousLogin,
    summary: {
      submissionCount: rows.length,
      solvedCount: solved.length,
      lastSubmitTime: rows.at(-1)!.createTime,
      unsolved,
      solved: solved.slice(0, 12),
    },
  } satisfies LastVisit)
})

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
      language: null,
      problems: [],
    } satisfies ClassActivity)
  }

  const lesson = await classLessonProblems(user.className, CLASS_ACTIVITY_LOOKBACK_DAYS)
  const ids = lesson.problems.map((problem) => problem.id)
  // 代码提交和流程图提交两张表，互不依赖，一起查
  const [mine, drawn] = await Promise.all([
    ids.length
      ? db
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
              // 布置的是 C：以前用 Python 做对过不算这份作业做完
              lessonLanguageFilter(lesson.language),
            ),
          )
          .groupBy(schema.submission.problemId)
      : [],
    // 流程图作业：画到 A / S 也算做完（设计文档 2026-09-28-problem-page-redesign 第 3 节决定 6）。
    // 有的题流程图交了几百次、代码个位数，只看代码提交的话，这些学生在课堂条上永远是「没做」。
    // 交过就算「做过」，评分中、评失败的也算 —— 和代码提交编译错误也算「做过」同一个口径
    ids.length
      ? db
          .select({
            problemId: schema.flowchartSubmission.problemId,
            passed: sql<boolean>`coalesce(bool_or(${FLOWCHART_PASSED}), false)`,
          })
          .from(schema.flowchartSubmission)
          .where(
            and(
              eq(schema.flowchartSubmission.userId, user.id),
              inArray(schema.flowchartSubmission.problemId, ids),
            ),
          )
          .groupBy(schema.flowchartSubmission.problemId)
      : [],
  ])
  const mineById = new Map(mine.map((row) => [row.problemId, row.accepted]))
  for (const row of drawn) {
    mineById.set(row.problemId, (mineById.get(row.problemId) ?? false) || row.passed)
  }

  return success(c, {
    className: user.className,
    day: lesson.day,
    source: lesson.source,
    language: lesson.language,
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
      language: null,
      assignedAt: null,
      assignedBy: null,
      lastLanguage: null,
      problems: [],
      students: [],
      recentLessons: 0,
    } satisfies ClassBoard)
  }

  // 推断只看今天（回看 1 天）：看板是给这节课用的，昨天的题不该冒出来。
  // lastLanguage 给语言下拉当默认值：这个班上一次布置选的什么（一个班一般一学期只学一种）
  const [lesson, [last]] = await Promise.all([
    classLessonProblems(className, 1),
    db
      .select({ language: schema.classLesson.language })
      .from(schema.classLesson)
      .where(
        and(eq(schema.classLesson.className, className), isNotNull(schema.classLesson.language)),
      )
      .orderBy(desc(schema.classLesson.day))
      .limit(1),
  ])
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

  // 「来了几次」代码和流程图合起来数：那天只画了流程图的也算来过，和 recentDays 同一个口径
  const recentActivity = activityRows({ since: windowStart, users: userIds })
  const localDay = sql<string>`to_char(${localTime(recentActivity.createTime)}, 'YYYY-MM-DD')`
  const [challengeConfigs, challengeDone] = await Promise.all([
    ids.length
      ? db
          .select({ id: schema.problem.id, challenges: schema.problem.challenges })
          .from(schema.problem)
          .where(inArray(schema.problem.id, ids))
      : [],
    challengeSuccessesOf(userIds, ids),
  ])
  // 只认现在还配着的挑战：规则改过的旧 id 不算
  const liveChallenges = new Map(
    challengeConfigs.map((row) => [
      row.id,
      new Set(Object.values(row.challenges ?? {}).flatMap((list) => list.map((c) => c.id))),
    ]),
  )
  const challengeDoneKeys = new Set(
    challengeDone
      .filter((row) => liveChallenges.get(row.problemId)?.has(row.challengeId))
      .map((row) => `${row.userId}:${row.problemId}`),
  )
  const [cells, lastSubmits, lastDrawn, attendance, drawn, todays, seen] = await Promise.all([
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
              lessonLanguageFilter(lesson.language),
            ),
          )
          .groupBy(schema.submission.userId, schema.submission.problemId)
      : [],
    userIds.length
      ? db
          .select({
            userId: schema.submission.userId,
            lastAt: sql<string>`max(${schema.submission.createTime})`,
            // 非比赛的最后一次，给「点名字跳提交列表」判断用（列表只列非比赛的）
            lastPublicAt: sql<
              string | null
            >`max(${schema.submission.createTime}) filter (where ${isNull(schema.submission.contestId)})`,
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
    // 今天只画了流程图的学生，「最后一次提交」也得算上画图，不然他在看板上是一直没动手。
    // 和上面代码那条同一个范围：今天、所有题、不论评没评完
    userIds.length
      ? db
          .select({
            userId: schema.flowchartSubmission.userId,
            lastAt: sql<string>`max(${schema.flowchartSubmission.createTime})`,
          })
          .from(schema.flowchartSubmission)
          .where(
            and(
              inArray(schema.flowchartSubmission.userId, userIds),
              gte(schema.flowchartSubmission.createTime, start),
            ),
          )
          .groupBy(schema.flowchartSubmission.userId)
      : [],
    recentDays.length && userIds.length
      ? db
          .select({
            userId: recentActivity.userId,
            days: sql<number>`count(distinct ${localDay})::int`,
          })
          .from(recentActivity)
          .where(inArray(localDay, recentDays))
          .groupBy(recentActivity.userId)
      : [],
    /**
     * 流程图作业：画到 A / S 也算这道题做完，和学生首页的课堂条同一个口径（/me/class-activity）。
     * 有的题这节课整个班都在画流程图，只数代码提交的话，看板上满屏「没开始」。
     * 和代码那条（cells）同一个范围：交过就算尝试，评分中、评失败的也算
     */
    ids.length && userIds.length
      ? db
          .select({
            userId: schema.flowchartSubmission.userId,
            problemId: schema.flowchartSubmission.problemId,
            attempts: sql<number>`count(*) filter (where ${gte(schema.flowchartSubmission.createTime, start)})::int`,
            firstPassedAt: sql<
              string | null
            >`min(${schema.flowchartSubmission.createTime}) filter (where ${FLOWCHART_PASSED})`,
          })
          .from(schema.flowchartSubmission)
          .where(
            and(
              inArray(schema.flowchartSubmission.userId, userIds),
              inArray(schema.flowchartSubmission.problemId, ids),
            ),
          )
          .groupBy(schema.flowchartSubmission.userId, schema.flowchartSubmission.problemId)
      : [],
    /**
     * 每人每题今天交的每一次代码，从早到晚。最后一次给没做对的格子点开讲错误、按错法归堆，
     * 整串给做对了的格子看轨迹。范围和 cells 一样（非比赛、布置的语言），只多一个「今天」
     */
    ids.length && userIds.length
      ? db
          .select({
            userId: schema.submission.userId,
            problemId: schema.submission.problemId,
            id: schema.submission.id,
            result: schema.submission.result,
            createTime: schema.submission.createTime,
            runtimeError: sql<
              StatisticInfo["runtime_error"] | null
            >`${schema.submission.statisticInfo}->'runtime_error'`,
            sampleCheck: sql<
              StatisticInfo["sample_check"] | null
            >`${schema.submission.statisticInfo}->'sample_check'`,
          })
          .from(schema.submission)
          .where(
            and(
              isNull(schema.submission.contestId),
              inArray(schema.submission.userId, userIds),
              inArray(schema.submission.problemId, ids),
              gte(schema.submission.createTime, start),
              lessonLanguageFilter(lesson.language),
            ),
          )
          .orderBy(schema.submission.createTime)
      : [],
    seenToday(userIds),
  ])
  const todayByKey = Map.groupBy(todays, (row) => `${row.userId}:${row.problemId}`)
  const cellByKey = new Map(cells.map((row) => [`${row.userId}:${row.problemId}`, row]))
  const drawnByKey = new Map(drawn.map((row) => [`${row.userId}:${row.problemId}`, row]))
  const lastByUser = new Map(lastSubmits.map((row) => [row.userId, row.lastAt]))
  const codeTodayUsers = new Set(
    lastSubmits.filter((row) => row.lastPublicAt).map((row) => row.userId),
  )
  const drawnTodayUsers = new Set(lastDrawn.map((row) => row.userId))
  for (const row of lastDrawn) {
    const known = lastByUser.get(row.userId)
    if (!known || Date.parse(row.lastAt) > Date.parse(known)) lastByUser.set(row.userId, row.lastAt)
  }
  const earliest = (a: string | null | undefined, b: string | null | undefined) =>
    !a ? (b ?? null) : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b
  const attendedByUser = new Map(attendance.map((row) => [row.userId, row.days]))

  return success(c, {
    className,
    day,
    source: lesson.source,
    language: lesson.language,
    assignedAt: lesson.assignedAt,
    assignedBy: lesson.assignedBy,
    lastLanguage: last?.language ?? null,
    problems: lesson.problems.map((problem) => ({
      problemId: problem.id,
      problemDisplayId: problem.displayId,
      title: problem.title,
      isSql: problem.isSql,
      hasChallenges: (liveChallenges.get(problem.id)?.size ?? 0) > 0,
    })),
    students: roster.map(
      (student) =>
        ({
          userId: student.userId,
          username: student.username,
          realName: student.realName ?? null,
          cells: ids.map((id) => {
            const key = `${student.userId}:${id}`
            const cell = cellByKey.get(key)
            const flow = drawnByKey.get(key)
            const acceptedAt = earliest(cell?.firstAcceptedAt, flow?.firstPassedAt)
            const today = todayByKey.get(key) ?? []
            const latest = acceptedAt ? undefined : today.at(-1)
            const firstTry =
              acceptedAt && Date.parse(acceptedAt) >= Date.parse(start)
                ? today.findIndex((row) => isAccepted(row.result))
                : -1
            return {
              status: !cell && !flow ? "none" : acceptedAt ? "accepted" : "tried",
              attempts: (cell?.attempts ?? 0) + (flow?.attempts ?? 0),
              codeAttempts: cell?.attempts ?? 0,
              flowchartAttempts: flow?.attempts ?? 0,
              acceptedAt,
              latest: latest
                ? {
                    submissionId: latest.id,
                    result: latest.result,
                    runtimeError: latest.runtimeError ?? undefined,
                    sampleCheck: latest.sampleCheck ?? undefined,
                  }
                : null,
              trail: acceptedAt
                ? today.map((row) => ({
                    id: row.id,
                    result: row.result,
                    createTime: row.createTime,
                  }))
                : [],
              acceptedTry: firstTry >= 0 ? firstTry + 1 : null,
              challenge:
                !acceptedAt || !liveChallenges.get(id)?.size
                  ? null
                  : challengeDoneKeys.has(key)
                    ? "done"
                    : today.some((row) => Date.parse(row.createTime) > Date.parse(acceptedAt))
                      ? "doing"
                      : null,
            }
          }),
          lastSubmitAt: lastByUser.get(student.userId) ?? null,
          codeToday: codeTodayUsers.has(student.userId),
          drawnToday: drawnTodayUsers.has(student.userId),
          recentAttended: attendedByUser.get(student.userId) ?? 0,
          editing: presenceOf(student.userId)?.problemId ?? null,
          online: seen.get(student.userId)?.online ?? false,
          seenAt: seen.has(student.userId)
            ? new Date(seen.get(student.userId)!.at).toISOString()
            : null,
        }) satisfies ClassBoardStudent,
    ),
    recentLessons: recentDays.length,
  } satisfies ClassBoard)
})

/**
 * 老师首页「今天的课」：今天在上课的每个班一行。在上课 = 同班 ≥5 人今天一起交过题（和「班里在做」
 * 同一个门槛），或者老师今天在看板上布置过题（刚布置、还没人交也要列出来）。每个班的题和人数
 * 和看板同一套取法（classLessonProblems），「全做对」看这几道题做没做对过，不限今天
 */
classroomRoutes.get("/classroom/today", requireTeacher, async (c) => {
  const start = dayStart()
  const today = calendarDay()
  const activity = activityRows({ since: start })
  const users = sql<number>`count(distinct ${activity.userId})::int`
  const lastAt = sql<string>`max(${activity.createTime})`
  const [active, lessons] = await Promise.all([
    db
      .select({ className: schema.user.className, users, lastAt })
      .from(activity)
      .innerJoin(schema.user, eq(schema.user.id, activity.userId))
      .where(
        and(
          isNotNull(schema.user.className),
          eq(schema.user.isDisabled, false),
          inArray(schema.user.adminType, [...STUDENT_ROLES]),
        ),
      )
      .groupBy(schema.user.className),
    db
      .select({ className: schema.classLesson.className })
      .from(schema.classLesson)
      .where(eq(schema.classLesson.day, today)),
  ])
  const activeByClass = new Map(
    active
      .filter((row) => row.className && row.users >= CLASS_ACTIVITY_MIN_USERS)
      .map((row) => [row.className!, row]),
  )
  const names = [...new Set([...activeByClass.keys(), ...lessons.map((row) => row.className)])]

  const classes = await Promise.all(
    names.map(async (className) => {
      const [lesson, [roster]] = await Promise.all([
        classLessonProblems(className, 1),
        db
          .select({ value: sql<number>`count(*)::int` })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.className, className),
              eq(schema.user.isDisabled, false),
              inArray(schema.user.adminType, [...STUDENT_ROLES]),
            ),
          ),
      ])
      const ids = lesson.problems.map((problem) => problem.id)
      let allDoneCount = 0
      if (ids.length) {
        // 做没做对不限今天（和看板的格子一样：以前做对的也算做完），语言跟着布置走
        const done = activityRows({
          since: new Date(0).toISOString(),
          users: classMemberIds(className),
          problemIds: ids,
          language: lesson.language,
        })
        const rows = await db
          .select({
            userId: done.userId,
            solved: sql<number>`count(distinct ${done.problemId})::int`,
          })
          .from(done)
          .where(sql`${done.solved}`)
          .groupBy(done.userId)
        allDoneCount = rows.filter((row) => row.solved >= ids.length).length
      }
      const today = activeByClass.get(className)
      return {
        className,
        source: lesson.source,
        assignedAt: lesson.assignedAt,
        assignedBy: lesson.assignedBy,
        problems: lesson.problems.map((problem) => ({
          problemDisplayId: problem.displayId,
          title: problem.title,
          userCount: problem.userCount,
          acceptedCount: problem.acceptedCount,
        })),
        activeCount: today?.users ?? 0,
        rosterCount: roster?.value ?? 0,
        allDoneCount,
        lastSubmitAt: today?.lastAt ? new Date(today.lastAt).toISOString() : null,
      }
    }),
  )
  // 正在交的在前，只布置了还没人交的放最后
  classes.sort((a, b) => (b.lastSubmitAt ?? "").localeCompare(a.lastSubmitAt ?? ""))
  return success(c, { classes } satisfies ClassToday)
})

/**
 * 提交列表「这节课」按钮：这个班这节课是哪几道题，取法同课堂看板（老师布置的优先，
 * 否则按今天同班提交推断）。不传班级就猜最近两小时在交题的班
 */
classroomRoutes.get("/classroom/lesson", requireTeacher, async (c) => {
  const className = c.req.query("className")?.trim() || (await suggestActiveClass())
  if (!className)
    return success(c, {
      className: null,
      source: null,
      language: null,
      problems: [],
    } satisfies ClassLesson)
  // 和看板一样只回看今天：「这节课」不该冒出昨天的题
  const lesson = await classLessonProblems(className, 1)
  // C / Python 的作业夹了 SQL 题就不筛语言（见契约 classLessonSchema.language）
  const mixed = lesson.problems.some((problem) => problem.isSql !== (lesson.language === "SQL"))
  return success(c, {
    className,
    source: lesson.source,
    language: mixed ? null : lesson.language,
    problems: lesson.problems.map((problem) => ({
      problemDisplayId: problem.displayId,
      title: problem.title,
    })),
  } satisfies ClassLesson)
})

/**
 * 老师给这个班布置今天的题。按展示题号给、不分大小写，存 problem.id 并保留输入顺序；
 * 有对不上的题号就整个拒掉并点名是哪几个，免得存下半张单子老师还不知道。空数组 = 清掉，
 * 学生那边退回推断。
 */
classroomRoutes.put("/classroom/lesson", requireTeacher, async (c) => {
  const parsed = await parseBody(c, classLessonRequestSchema, "题号或语言不对")
  if (!parsed.success) return parsed.response
  const user = c.get("user")!
  const { className, problemDisplayIds } = parsed.data
  const language = parsed.data.language ?? null
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
    .select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      languages: schema.problem.languages,
    })
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

  // 选了语言就得每道都能用它交，不然学生点开才发现交不了（提交接口会拒：language-not-allowed）。
  // SQL 题除外：它只收 SQL，C 的作业里夹一道也不会让人选错语言，计数那边也放行了 SQL
  if (language) {
    const unsupported = found
      .filter((row) => !row.languages.includes(language) && !isSqlProblem(row))
      .map((row) => row.displayId)
    if (unsupported.length) {
      return failure(
        c,
        400,
        "language-not-allowed",
        `这些题不能用 ${language} 交：${unsupported.join("、")}`,
      )
    }
  }

  const problemIds = wanted.map((id) => idByDisplay.get(id)!)
  const now = new Date().toISOString()
  await db
    .insert(schema.classLesson)
    .values({
      className,
      day,
      problemIds,
      language,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.classLesson.className, schema.classLesson.day],
      // 「改」不换布置的人，和 createdAt 一样认第一次
      set: { problemIds, language, updatedAt: now },
    })
  return success(c, null)
})

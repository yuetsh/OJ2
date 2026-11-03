import {
  STUDENT_ROLES,
  classLessonRequestSchema,
  type ClassToday,
  type TaskBoard,
  type TaskBoardStudent,
  type ClassLesson,
  type StatisticInfo,
} from '@oj2/contract'
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireTeacher, type AppEnv } from '../auth/middleware'
import { seenToday } from '../auth/presence'
import { presenceOf } from '../collab/state'
import { db, schema } from '../db'
import { challengeSuccessesOf } from '../services/challenge'
import { failure, parseBody, success } from '../http'
import { isAccepted } from '../judge/status'
import { activityRows, classMemberIds, FLOWCHART_PASSED, lessonLanguageFilter, SOLVED_RESULTS, suggestActiveClass } from '../services/class-activity'
import {
  announceLessonChange,
  CLASS_ACTIVITY_MIN_USERS,
  classDayGroups,
  classLessonProblems,
  lessonDoneCounts,
  resolveLessonProblems,
  todayLessonSnapshot,
} from '../services/lesson'
import { calendarDay, dayStart, localTime } from '../time'

/**
 * 课堂任务（老师）：布置这节课的题、看全班做到哪、老师首页的「今天的课」。
 * 「这节课是哪几道题」的取法在 services/lesson.ts，学生首页的「班里在做」也用它（routes/home.ts）
 */
export const taskRoutes = new Hono<AppEnv>()

/**
 * 一张流程图走对了几组、一共几组：2026-10 起的「走例子」报告（ai_criteria_details version 2，
 * 形状见契约 FlowchartCaseReport）里数。老评法、还没评完的、评失败的都是 null
 */
function flowchartCaseCounts() {
  const details = schema.flowchartSubmission.aiCriteriaDetails
  const isReport = sql`${schema.flowchartSubmission.status} = 2 and ${details}->>'version' = '2' and jsonb_typeof(${details}->'cases') = 'array'`
  return {
    passed: sql<number | null>`case when ${isReport} then (select count(*) from jsonb_array_elements(${details}->'cases') e where e->>'ok' = 'true')::int end`,
    total: sql<number | null>`case when ${isReport} then jsonb_array_length(${details}->'cases') end`,
  }
}

/**
 * 任务页上的「最近几节课交了几节」：分清「今天没来」和「一直不动手」。2025 秋至少上过
 * 5 节课的学生里，12.5% 七成以上的课一道都没交，37% 的学生贡献了一半以上的「没交」
 * —— 当堂那份名单把这两种人排在同一行里，老师分不出来。
 */
const RECENT_LESSONS = 5
/** 往回找最近几节课时最多看多远：寒暑假之后开学第一节课，前面几节是上学期的，没意义 */
const RECENT_LESSONS_WINDOW_DAYS = 45

/**
 * 课堂任务：这个班、今天、这节课的几道题 × 全班学生。老师在课上用它看谁还没开始、
 * 谁卡住了 —— 2025 秋平均每节课有 14 个平时在用的学生一道都没交（占三分之一），
 * 而交了 3 次以上还没过的平均不到 1 个，所以「还没开始」才是这张表的重点，排序在前端。
 */
taskRoutes.get('/task/board', requireTeacher, async (c) => {
  const day = calendarDay()
  const className = c.req.query('className')?.trim() || (await suggestActiveClass())
  if (!className) {
    return success(c, {
      className: null,
      day,
      source: null,
      lessonId: null,
      language: null,
      mode: null,
      assignedAt: null,
      assignedBy: null,
      lastLanguage: null,
      problems: [],
      students: [],
      recentLessons: 0,
    } satisfies TaskBoard)
  }

  // 推断只看今天（回看 1 天）：任务页是给这节课用的，昨天的题不该冒出来。
  // lastLanguage 给语言下拉当默认值：这个班上一次布置选的什么（一个班一般一学期只学一种）
  const [lesson, [last]] = await Promise.all([
    classLessonProblems(className, 1),
    db
      .select({ language: schema.classLesson.language })
      .from(schema.classLesson)
      .where(and(eq(schema.classLesson.className, className), isNotNull(schema.classLesson.language)))
      .orderBy(desc(schema.classLesson.day), desc(schema.classLesson.createdAt))
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
    .where(and(eq(schema.user.className, className), eq(schema.user.isDisabled, false), inArray(schema.user.adminType, [...STUDENT_ROLES])))
  const userIds = roster.map((row) => row.userId)

  // 最近几节课：这个班同学一起做题的那些天（不含今天）
  const windowStart = dayStart(Date.now() - RECENT_LESSONS_WINDOW_DAYS * 86_400_000)
  const recentDays = [...new Set((await classDayGroups(className, windowStart, { minUsers: CLASS_ACTIVITY_MIN_USERS })).map((row) => row.day))]
    .filter((d) => d < day)
    .sort()
    .slice(-RECENT_LESSONS)

  // 「来了几次」代码和流程图合起来数：那天只画了流程图的也算来过，和 recentDays 同一个口径
  const recentActivity = activityRows({ since: windowStart, users: userIds })
  const localDay = sql<string>`to_char(${localTime(recentActivity.createTime)}, 'YYYY-MM-DD')`
  const [challengeConfigs, challengeDone] = await Promise.all([
    ids.length ? db.select({ id: schema.problem.id, challenges: schema.problem.challenges }).from(schema.problem).where(inArray(schema.problem.id, ids)) : [],
    challengeSuccessesOf(userIds, ids),
  ])
  // 只认现在还配着的挑战：规则改过的旧 id 不算
  const liveChallenges = new Map(challengeConfigs.map((row) => [row.id, new Set(Object.values(row.challenges ?? {}).flatMap((list) => list.map((c) => c.id)))]))
  const challengeDoneKeys = new Set(
    challengeDone.filter((row) => liveChallenges.get(row.problemId)?.has(row.challengeId)).map((row) => `${row.userId}:${row.problemId}`),
  )
  // 老师布置的这节做什么；推断出来的课为 null，代码交对或流程图画对都算（和加「做什么」之前一样）。
  // 格子按每道题合起来的要求算（todayNeeds）：先画流程图一节、再写代码一节，没画图的照样标「缺图」，
  // 和学生那边的「做完」对得上。代码按的语言也是合起来那份：最后一节只画流程图时，用前面写代码那节的
  const mode = lesson.source === 'teacher' ? lesson.mode : null
  const steps = lesson.steps
  const needsOf = (problemId: number) => steps?.needsOf(problemId) ?? null
  const anyDraw = ids.some((id) => needsOf(id)?.draw)
  const codeLanguage = steps ? steps.language : lesson.language
  const [cells, lastSubmits, lastDrawn, attendance, drawn, todays, seen, lastFlows] = await Promise.all([
    ids.length && userIds.length
      ? db
          .select({
            userId: schema.submission.userId,
            problemId: schema.submission.problemId,
            attempts: sql<number>`count(*) filter (where ${gte(schema.submission.createTime, start)})::int`,
            firstAcceptedAt: sql<string | null>`min(${schema.submission.createTime}) filter (where ${inArray(schema.submission.result, SOLVED_RESULTS)})`,
          })
          .from(schema.submission)
          .where(
            and(
              isNull(schema.submission.contestId),
              inArray(schema.submission.userId, userIds),
              inArray(schema.submission.problemId, ids),
              lessonLanguageFilter(codeLanguage),
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
            lastPublicAt: sql<string | null>`max(${schema.submission.createTime}) filter (where ${isNull(schema.submission.contestId)})`,
          })
          .from(schema.submission)
          .where(and(inArray(schema.submission.userId, userIds), gte(schema.submission.createTime, start)))
          .groupBy(schema.submission.userId)
      : [],
    // 今天只画了流程图的学生，「最后一次提交」也得算上画图，不然他在任务页上是一直没动手。
    // 和上面代码那条同一个范围：今天、所有题、不论评没评完
    userIds.length
      ? db
          .select({
            userId: schema.flowchartSubmission.userId,
            lastAt: sql<string>`max(${schema.flowchartSubmission.createTime})`,
          })
          .from(schema.flowchartSubmission)
          .where(and(inArray(schema.flowchartSubmission.userId, userIds), gte(schema.flowchartSubmission.createTime, start)))
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
     * 有的题这节课整个班都在画流程图，只数代码提交的话，任务页上满屏「没开始」。
     * 和代码那条（cells）同一个范围：交过就算尝试，评分中、评失败的也算
     */
    ids.length && userIds.length
      ? db
          .select({
            userId: schema.flowchartSubmission.userId,
            problemId: schema.flowchartSubmission.problemId,
            attempts: sql<number>`count(*) filter (where ${gte(schema.flowchartSubmission.createTime, start)})::int`,
            firstPassedAt: sql<string | null>`min(${schema.flowchartSubmission.createTime}) filter (where ${FLOWCHART_PASSED})`,
          })
          .from(schema.flowchartSubmission)
          .where(and(inArray(schema.flowchartSubmission.userId, userIds), inArray(schema.flowchartSubmission.problemId, ids)))
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
            runtimeError: sql<StatisticInfo['runtime_error'] | null>`${schema.submission.statisticInfo}->'runtime_error'`,
            sampleCheck: sql<StatisticInfo['sample_check'] | null>`${schema.submission.statisticInfo}->'sample_check'`,
          })
          .from(schema.submission)
          .where(
            and(
              isNull(schema.submission.contestId),
              inArray(schema.submission.userId, userIds),
              inArray(schema.submission.problemId, ids),
              gte(schema.submission.createTime, start),
              lessonLanguageFilter(codeLanguage),
            ),
          )
          .orderBy(schema.submission.createTime)
      : [],
    seenToday(userIds),
    /**
     * 要画流程图的课：每人每题最后一张图（不限今天，和 drawn 的 firstPassedAt 同一个范围），
     * 还没画对的格子点开讲它哪里错、按走对几组归堆。走对几组从 2026-10 起的「走例子」报告里数，
     * 老评法和还没评完的为 null
     */
    anyDraw && ids.length && userIds.length
      ? db
          .selectDistinctOn([schema.flowchartSubmission.userId, schema.flowchartSubmission.problemId], {
            userId: schema.flowchartSubmission.userId,
            problemId: schema.flowchartSubmission.problemId,
            id: schema.flowchartSubmission.id,
            status: schema.flowchartSubmission.status,
            grade: schema.flowchartSubmission.aiGrade,
            ...flowchartCaseCounts(),
          })
          .from(schema.flowchartSubmission)
          .where(and(inArray(schema.flowchartSubmission.userId, userIds), inArray(schema.flowchartSubmission.problemId, ids)))
          .orderBy(schema.flowchartSubmission.userId, schema.flowchartSubmission.problemId, desc(schema.flowchartSubmission.createTime))
      : [],
  ])
  const lastFlowByKey = new Map(lastFlows.map((row) => [`${row.userId}:${row.problemId}`, row]))
  const todayByKey = Map.groupBy(todays, (row) => `${row.userId}:${row.problemId}`)
  const cellByKey = new Map(cells.map((row) => [`${row.userId}:${row.problemId}`, row]))
  const drawnByKey = new Map(drawn.map((row) => [`${row.userId}:${row.problemId}`, row]))
  const lastByUser = new Map(lastSubmits.map((row) => [row.userId, row.lastAt]))
  const codeTodayUsers = new Set(lastSubmits.filter((row) => row.lastPublicAt).map((row) => row.userId))
  const drawnTodayUsers = new Set(lastDrawn.map((row) => row.userId))
  for (const row of lastDrawn) {
    const known = lastByUser.get(row.userId)
    if (!known || Date.parse(row.lastAt) > Date.parse(known)) lastByUser.set(row.userId, row.lastAt)
  }
  const earliest = (a: string | null | undefined, b: string | null | undefined) => (!a ? (b ?? null) : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b)
  const latestOf = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b)
  type Step = 'accepted' | 'tried' | 'none'
  const attendedByUser = new Map(attendance.map((row) => [row.userId, row.days]))

  return success(c, {
    className,
    day,
    source: lesson.source,
    lessonId: lesson.lessonId,
    language: lesson.language,
    mode,
    assignedAt: lesson.assignedAt,
    assignedBy: lesson.assignedBy,
    lastLanguage: last?.language ?? null,
    problems: lesson.problems.map((problem) => ({
      problemId: problem.id,
      problemDisplayId: problem.displayId,
      title: problem.title,
      isSql: problem.isSql,
      hasChallenges: (liveChallenges.get(problem.id)?.size ?? 0) > 0,
      mode: steps?.modeOf(problem.id) ?? null,
    })),
    students: roster.map(
      (student) =>
        ({
          userId: student.userId,
          username: student.username,
          realName: student.realName ?? null,
          cells: ids.map((id) => {
            const needs = needsOf(id)
            const key = `${student.userId}:${id}`
            const cell = cellByKey.get(key)
            const flow = drawnByKey.get(key)
            const codeAt = cell?.firstAcceptedAt ?? null
            const flowAt = flow?.firstPassedAt ?? null
            const codeStatus: Step = codeAt ? 'accepted' : cell ? 'tried' : 'none'
            const drawStatus: Step = flowAt ? 'accepted' : flow ? 'tried' : 'none'
            let status: Step
            let acceptedAt: string | null
            let attempts: number
            if (!needs) {
              acceptedAt = earliest(codeAt, flowAt)
              status = !cell && !flow ? 'none' : acceptedAt ? 'accepted' : 'tried'
              attempts = (cell?.attempts ?? 0) + (flow?.attempts ?? 0)
            } else {
              // 要哪几步看哪几步：两步都做到的时刻是晚的那一步
              const wanted = [needs.draw ? { status: drawStatus, at: flowAt } : null, needs.code ? { status: codeStatus, at: codeAt } : null].filter(
                (step) => step !== null,
              )
              acceptedAt = wanted.every((step) => step.at) ? wanted.map((step) => step.at!).reduce(latestOf) : null
              status = acceptedAt ? 'accepted' : wanted.some((step) => step.status !== 'none') ? 'tried' : 'none'
              attempts = (needs.code ? (cell?.attempts ?? 0) : 0) + (needs.draw ? (flow?.attempts ?? 0) : 0)
            }
            // 下面几样都是代码那一步的：只画流程图的课没有
            const codeWanted = !needs || needs.code
            const today = codeWanted ? (todayByKey.get(key) ?? []) : []
            const codeDone = needs ? codeAt : acceptedAt
            const latest = codeDone ? undefined : today.at(-1)
            const firstTry = codeDone && Date.parse(codeDone) >= Date.parse(start) ? today.findIndex((row) => isAccepted(row.result)) : -1
            const lastFlow = lastFlowByKey.get(key)
            return {
              status,
              attempts,
              codeAttempts: cell?.attempts ?? 0,
              flowchartAttempts: flow?.attempts ?? 0,
              acceptedAt,
              codeStatus,
              flowchart: needs?.draw
                ? {
                    status: drawStatus,
                    passedAt: flowAt,
                    latest:
                      !flowAt && lastFlow
                        ? { id: lastFlow.id, status: lastFlow.status, grade: lastFlow.grade, passed: lastFlow.passed, total: lastFlow.total }
                        : null,
                  }
                : null,
              latest: latest
                ? {
                    submissionId: latest.id,
                    result: latest.result,
                    runtimeError: latest.runtimeError ?? undefined,
                    sampleCheck: latest.sampleCheck ?? undefined,
                  }
                : null,
              trail: codeDone
                ? today.map((row) => ({
                    id: row.id,
                    result: row.result,
                    createTime: row.createTime,
                  }))
                : [],
              acceptedTry: firstTry >= 0 ? firstTry + 1 : null,
              // 整道题做完了才谈挑战：先画再写只交对了代码、图还没画的，格子是「缺图」，不挂挑战的圈
              challenge:
                !codeWanted || !codeDone || !acceptedAt || !liveChallenges.get(id)?.size
                  ? null
                  : challengeDoneKeys.has(key)
                    ? 'done'
                    : today.some((row) => Date.parse(row.createTime) > Date.parse(codeDone))
                      ? 'doing'
                      : null,
            }
          }),
          lastSubmitAt: lastByUser.get(student.userId) ?? null,
          codeToday: codeTodayUsers.has(student.userId),
          drawnToday: drawnTodayUsers.has(student.userId),
          recentAttended: attendedByUser.get(student.userId) ?? 0,
          editing: presenceOf(student.userId)?.problemId ?? null,
          online: seen.get(student.userId)?.online ?? false,
          seenAt: seen.has(student.userId) ? new Date(seen.get(student.userId)!.at).toISOString() : null,
        }) satisfies TaskBoardStudent,
    ),
    recentLessons: recentDays.length,
  } satisfies TaskBoard)
})

/**
 * 老师首页「今天的课」：今天在上课的每个班一行。在上课 = 同班 ≥5 人今天一起交过题（和「班里在做」
 * 同一个门槛），或者老师今天在任务页上布置过题（刚布置、还没人交也要列出来）。每个班的题和人数
 * 和任务页同一套取法（classLessonProblems），「全做对」看这几道题做没做对过，不限今天
 */
taskRoutes.get('/task/today', requireTeacher, async (c) => {
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
      .where(and(isNotNull(schema.user.className), eq(schema.user.isDisabled, false), inArray(schema.user.adminType, [...STUDENT_ROLES])))
      .groupBy(schema.user.className),
    db.select({ className: schema.classLesson.className }).from(schema.classLesson).where(eq(schema.classLesson.day, today)),
  ])
  const activeByClass = new Map(active.filter((row) => row.className && row.users >= CLASS_ACTIVITY_MIN_USERS).map((row) => [row.className!, row]))
  const names = [...new Set([...activeByClass.keys(), ...lessons.map((row) => row.className)])]

  const classes = await Promise.all(
    names.map(async (className) => {
      const [lesson, [roster]] = await Promise.all([
        classLessonProblems(className, 1),
        db
          .select({ value: sql<number>`count(*)::int` })
          .from(schema.user)
          .where(and(eq(schema.user.className, className), eq(schema.user.isDisabled, false), inArray(schema.user.adminType, [...STUDENT_ROLES]))),
      ])
      const ids = lesson.problems.map((problem) => problem.id)
      let allDoneCount = 0
      if (ids.length && lesson.source === 'teacher' && lesson.lessonId && lesson.mode) {
        // 老师布置的：和任务页同一个口径（每道题按今天几节合起来的要求，要画的看图、要写的看代码）
        const counts = await lessonDoneCounts([
          {
            id: lesson.lessonId,
            className,
            day: calendarDay(),
            problemIds: ids,
            language: lesson.steps?.language ?? lesson.language,
            mode: lesson.mode,
            modeOf: lesson.steps?.modeOf,
          },
        ])
        allDoneCount = counts.get(lesson.lessonId) ?? 0
      } else if (ids.length) {
        // 推断出来的：做没做对不限今天（和任务页的格子一样：以前做对的也算做完），代码或流程图都算
        const done = activityRows({
          since: new Date(0).toISOString(),
          users: classMemberIds(className),
          problemIds: ids,
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
  classes.sort((a, b) => (b.lastSubmitAt ?? '').localeCompare(a.lastSubmitAt ?? ''))
  return success(c, { classes } satisfies ClassToday)
})

/**
 * 提交列表「这节课」按钮：这个班这节课是哪几道题，取法同课堂任务（老师布置的优先，
 * 否则按今天同班提交推断）。不传班级就猜最近两小时在交题的班
 */
taskRoutes.get('/task/lesson', requireTeacher, async (c) => {
  const className = c.req.query('className')?.trim() || (await suggestActiveClass())
  if (!className)
    return success(c, {
      className: null,
      source: null,
      language: null,
      problems: [],
    } satisfies ClassLesson)
  // 和任务页一样只回看今天：「这节课」不该冒出昨天的题
  const lesson = await classLessonProblems(className, 1)
  // C / Python 的作业夹了 SQL 题就不筛语言（见契约 classLessonSchema.language）
  const mixed = lesson.problems.some((problem) => problem.isSql !== (lesson.language === 'SQL'))
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
 * 老师给这个班布置今天的一节课。按展示题号给、不分大小写，存 problem.id 并保留输入顺序；
 * 有对不上的题号就整个拒掉并点名是哪几个，免得存下半张单子老师还不知道。空数组 = 清掉这一节，
 * 今天一节都不剩时学生那边退回推断。改哪一节、还是新开一节，见契约 classLessonRequestSchema。
 */
taskRoutes.put('/task/lesson', requireTeacher, async (c) => {
  const parsed = await parseBody(c, classLessonRequestSchema, '题号或语言不对')
  if (!parsed.success) return parsed.response
  const user = c.get('user')!
  const { className, problemDisplayIds, lessonId, newLesson, mode } = parsed.data
  // 只画流程图不用语言：存成 null，任务页和学生那边就不会写「C语言」
  const language = mode === 'flowchart' ? null : parsed.data.language
  const day = calendarDay()

  const [exists] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.className, className)).limit(1)
  if (!exists) return failure(c, 400, 'class-not-found', `没有 ${className} 这个班`)
  // 改之前学生看到的那一节，改完比一比、告诉全班改了哪些
  const before = await todayLessonSnapshot(className)

  // 要改的是哪一行：点名的那一节（只认这个班今天的），新开一节就没有，老写法是今天最后布置的那一节
  const [target] = newLesson
    ? []
    : await db
        .select({ id: schema.classLesson.id })
        .from(schema.classLesson)
        .where(
          and(
            eq(schema.classLesson.className, className),
            eq(schema.classLesson.day, day),
            lessonId === undefined ? undefined : eq(schema.classLesson.id, lessonId),
          ),
        )
        .orderBy(desc(schema.classLesson.createdAt), desc(schema.classLesson.id))
        .limit(1)
  if (!problemDisplayIds.length) {
    if (target) await db.delete(schema.classLesson).where(eq(schema.classLesson.id, target.id))
    await announceLessonChange(className, before)
    return success(c, null)
  }

  const resolved = await resolveLessonProblems(problemDisplayIds, language, mode)
  if ('code' in resolved) return failure(c, 400, resolved.code, resolved.message)
  const { problemIds } = resolved
  const now = new Date().toISOString()
  if (target) {
    // 「改」不换布置的人，和 createdAt 一样认第一次
    await db.update(schema.classLesson).set({ problemIds, language, mode, updatedAt: now }).where(eq(schema.classLesson.id, target.id))
  } else {
    // 新开一节、今天还没有，或者点名的那一节已经没了（别的老师清掉了）—— 最后这种也照新开处理，
    // 老师手上的题号不至于白填
    await db.insert(schema.classLesson).values({
      className,
      day,
      problemIds,
      language,
      mode,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    })
  }
  await announceLessonChange(className, before)
  return success(c, null)
})

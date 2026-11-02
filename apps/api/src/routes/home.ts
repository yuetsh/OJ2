import { type ClassActivity, type ClassActivityProblem, type LastVisit, type LessonLanguage, type LessonMode, lessonNeeds } from '@oj2/contract'
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireAuth, type AppEnv } from '../auth/middleware'
import { getLoginWindow } from '../auth/session'
import { db, schema } from '../db'
import { success } from '../http'
import { FLOWCHART_PASSED, lessonLanguageFilter, SOLVED_RESULTS } from '../services/class-activity'
import { accepted } from '../services/learning-stats'
import { CLASS_ACTIVITY_LOOKBACK_DAYS, classLessonProblems } from '../services/lesson'
import { calendarDay } from '../time'

/**
 * 首页上和「这节课」有关的两张卡：学生的「上次来」和「班里在做」。
 * 「这节课是哪几道题」的取法在 services/lesson.ts（课堂任务、后台、统计共用）
 */
export const homeRoutes = new Hono<AppEnv>()

/** 「上次来」超过这么多天就不提那次做了什么，只在问候里说一句隔了多久 */
const LAST_VISIT_MAX_DAYS = 30

/**
 * 首页的「上次来」卡：上次登录到这次登录之间交过什么、哪道还没做对。
 * 原来是登录后弹的「登录速报」，数字外加 AI 两句话 —— AI 只拿到那五个数，说的就是复述，
 * 还要同步等模型（最长 60 秒）弹框才出来；现在拆进首页，没做对的题给「接着做」
 */
homeRoutes.get('/me/last-visit', requireAuth, async (c) => {
  const user = c.get('user')!
  const window = await getLoginWindow(c)
  const previousLogin = window?.previousLogin ?? null
  if (!window || !previousLogin || Date.now() - new Date(previousLogin).getTime() > LAST_VISIT_MAX_DAYS * 864e5) {
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
      lastResult: (typeof rows)[number]['result']
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
homeRoutes.get('/me/class-activity', requireAuth, async (c) => {
  const user = c.get('user')!
  if (!user.className) {
    return success(c, {
      className: null,
      day: null,
      source: null,
      language: null,
      mode: null,
      problems: [],
    } satisfies ClassActivity)
  }

  const lesson = await classLessonProblems(user.className, CLASS_ACTIVITY_LOOKBACK_DAYS)
  const ids = lesson.problems.map((problem) => problem.id)
  const steps = lesson.source === 'teacher' && lesson.mode ? await todaySteps(user.className, ids, lesson) : null
  const codeLanguage = steps ? steps.language : lesson.language
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
              lessonLanguageFilter(codeLanguage),
            ),
          )
          .groupBy(schema.submission.problemId)
      : [],
    // 流程图：交过就算「做过」，评分中、评失败的也算 —— 和代码提交编译错误也算「做过」同一个口径
    ids.length
      ? db
          .select({
            problemId: schema.flowchartSubmission.problemId,
            passed: sql<boolean>`coalesce(bool_or(${FLOWCHART_PASSED}), false)`,
          })
          .from(schema.flowchartSubmission)
          .where(and(eq(schema.flowchartSubmission.userId, user.id), inArray(schema.flowchartSubmission.problemId, ids)))
          .groupBy(schema.flowchartSubmission.problemId)
      : [],
  ])
  type Step = 'accepted' | 'tried' | 'none'
  const stepOf = (value: boolean | undefined): Step => (value === undefined ? 'none' : value ? 'accepted' : 'tried')
  const codeById = new Map(mine.map((row) => [row.problemId, row.accepted]))
  const drawById = new Map(drawn.map((row) => [row.problemId, row.passed]))

  return success(c, {
    className: user.className,
    day: lesson.day,
    source: lesson.source,
    language: codeLanguage,
    mode: lesson.mode,
    problems: lesson.problems.map((problem) => {
      const code = stepOf(codeById.get(problem.id))
      const draw = stepOf(drawById.get(problem.id))
      const needs = steps?.needs.get(problem.id)
      let myStatus: Step
      if (needs) {
        // 老师布置的：要哪几步就看哪几步，全做到才算做完
        const wanted = [needs.draw ? draw : null, needs.code ? code : null].filter((step): step is Step => step !== null)
        myStatus = wanted.every((step) => step === 'accepted') ? 'accepted' : wanted.some((step) => step !== 'none') ? 'tried' : 'none'
      } else {
        // 推断出来的课：代码交对或流程图画到 A / S 都算（有的题全班在画流程图，只看代码的话永远是「没做」）
        myStatus = code === 'accepted' || draw === 'accepted' ? 'accepted' : code === 'tried' || draw === 'tried' ? 'tried' : 'none'
      }
      return {
        problemDisplayId: problem.displayId,
        title: problem.title,
        userCount: problem.userCount,
        acceptedCount: problem.acceptedCount,
        myStatus,
        draw: needs?.draw ? draw : null,
        code: needs?.code ? code : null,
      } satisfies ClassActivityProblem
    }),
  } satisfies ClassActivity)
})

/**
 * 学生那边一道题要画还是要写：今天这个班布置过的每一节里，凡是有这道题的，要求合起来算。
 * 老师先布置一节画流程图、再布置一节同样的题写代码时，还没画完的人照样看得到要画 ——
 * 学生只看得到今天最后布置的那一节，不合起来的话，画流程图那节一布置写代码就没了。
 *
 * 写代码用的语言：今天最后布置的、要写代码的那一节选的（只画流程图的课没有语言）
 */
async function todaySteps(
  className: string,
  problemIds: number[],
  latest: { lessonId: number | null; language: LessonLanguage | null; mode: LessonMode | null },
) {
  const rows = await db
    .select({ id: schema.classLesson.id, problemIds: schema.classLesson.problemIds, language: schema.classLesson.language, mode: schema.classLesson.mode })
    .from(schema.classLesson)
    .where(and(eq(schema.classLesson.className, className), eq(schema.classLesson.day, calendarDay())))
    .orderBy(desc(schema.classLesson.createdAt), desc(schema.classLesson.id))
  const needs = new Map<number, { draw: boolean; code: boolean }>()
  let language: LessonLanguage | null = latest.mode && lessonNeeds(latest.mode).code ? latest.language : null
  let languageFound = !!latest.mode && lessonNeeds(latest.mode).code
  for (const row of rows) {
    const shared = row.id === latest.lessonId ? problemIds : row.problemIds.filter((id) => problemIds.includes(id))
    if (!shared.length) continue
    const rowNeeds = lessonNeeds(row.mode)
    for (const id of shared) {
      const known = needs.get(id) ?? { draw: false, code: false }
      needs.set(id, { draw: known.draw || rowNeeds.draw, code: known.code || rowNeeds.code })
    }
    if (!languageFound && rowNeeds.code) {
      language = row.language ?? null
      languageFound = true
    }
  }
  return { needs, language }
}

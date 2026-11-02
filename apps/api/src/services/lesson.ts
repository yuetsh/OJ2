import { isSqlProblem, lessonNeeds, STUDENT_ROLES, type LessonLanguage, type LessonMode, type LessonUpdate } from '@oj2/contract'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { db, schema } from '../db'
import { publishLessonUpdate } from '../events'
import { calendarDay, dayNumber, dayStart, localTime } from '../time'
import { activityRows, classMemberIds, FLOWCHART_PASSED, SOLVED_RESULTS } from './class-activity'

/**
 * 布置的课（class_lesson）几处共用的口径：课堂任务布置、后台「课堂任务」增改、
 * 数据统计按布置切课。放在一起，免得任务页能布置的题后台布置不上，或者两边「做完」数得不一样。
 */

/**
 * 题号 → problem.id，保留输入顺序、去重、不分大小写。只认题库里公开的题；有对不上的整个拒掉并
 * 点名是哪几个，免得存下半张单子老师还不知道。要写代码的课选了语言就得每道都能用它交（SQL 题除外：
 * 它只收 SQL，C 的作业里夹一道也不会让人选错语言，计数那边也放行了 SQL）；要画流程图的课
 * 每道都得打开了「让学生自己画」，不然学生打开题目根本没有画布
 */
export async function resolveLessonProblems(
  problemDisplayIds: string[],
  language: LessonLanguage | null,
  mode: LessonMode = 'code',
): Promise<{ problemIds: number[] } | { code: 'problem-not-found' | 'language-not-allowed' | 'flowchart-not-allowed'; message: string }> {
  const wanted = [...new Set(problemDisplayIds.map((id) => id.toLowerCase()))]
  const found = await db
    .select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      languages: schema.problem.languages,
      allowFlowchart: schema.problem.allowFlowchart,
    })
    .from(schema.problem)
    .where(and(inArray(sql<string>`lower(${schema.problem.displayId})`, wanted), eq(schema.problem.visible, true), isNull(schema.problem.contestId)))
  const idByDisplay = new Map(found.map((row) => [row.displayId.toLowerCase(), row.id]))
  const missing = wanted.filter((id) => !idByDisplay.has(id))
  if (missing.length) return { code: 'problem-not-found', message: `这些题号不存在或没有公开：${missing.join('、')}` }
  const needs = lessonNeeds(mode)
  if (needs.draw) {
    const undrawable = found.filter((row) => !row.allowFlowchart).map((row) => row.displayId)
    if (undrawable.length) return { code: 'flowchart-not-allowed', message: `这些题没有打开画流程图：${undrawable.join('、')}` }
  }
  if (language && needs.code) {
    const unsupported = found.filter((row) => !row.languages.includes(language) && !isSqlProblem(row)).map((row) => row.displayId)
    if (unsupported.length) return { code: 'language-not-allowed', message: `这些题不能用 ${language} 交：${unsupported.join('、')}` }
  }
  return { problemIds: wanted.map((id) => idByDisplay.get(id)!) }
}

/** 东八区某一天结束（第二天零点）的时刻 */
export function lessonDayEnd(day: string) {
  return dayStart(new Date((dayNumber(day) + 1) * 86_400_000))
}

/**
 * 每节布置的课，班里把布置的题全做对了的人数：那天结束前做对过布置的每一道（以前做对的也算）。
 * 「做对」看这节课做什么（契约 lessonModeSchema）：写代码只认代码交对，代码只认布置的语言
 * （SQL 题放行）；画流程图只认评到 A / S；先画再写两样都要 —— 和任务页的格子同一个口径。
 * 人按花名册（STUDENT_ROLES、没禁用），和「全班几人」对得上
 */
export async function lessonDoneCounts(
  lessons: { id: number; className: string; day: string; problemIds: number[]; language: LessonLanguage | null; mode: LessonMode }[],
) {
  const rows = lessons.flatMap((lesson) =>
    lesson.problemIds.map((problemId) => ({
      k: lesson.id,
      class_name: lesson.className,
      problem_id: problemId,
      language: lesson.language,
      mode: lesson.mode,
      until: lessonDayEnd(lesson.day),
    })),
  )
  if (!rows.length) return new Map<number, number>()
  const solved = sql.join(
    SOLVED_RESULTS.map((value) => sql`${value}`),
    sql`, `,
  )
  const result = await db.execute<{ k: number; done: number }>(sql`
    with p as (
      select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as p(k int, class_name text, problem_id int, language text, mode text, until timestamptz)
    ),
    members as (
      select p.k, p.problem_id, p.language, p.mode, p.until, u.id as user_id
      from p join ${schema.user} u on u.class_name = p.class_name
      where u.is_disabled = false and u.admin_type in (${sql.join(
        STUDENT_ROLES.map((role) => sql`${role}`),
        sql`, `,
      )})
    ),
    solved as (
      select m.k, m.user_id, m.problem_id
      from members m
      where (m.mode = 'flowchart' or exists (
        select 1 from ${schema.submission} s
        where s.user_id = m.user_id and s.problem_id = m.problem_id and s.contest_id is null
          and s.result in (${solved}) and s.create_time < m.until
          and (m.language is null or s.language in (m.language, 'SQL'))
      )) and (m.mode = 'code' or exists (
        select 1 from ${schema.flowchartSubmission}
        where ${schema.flowchartSubmission.userId} = m.user_id and ${schema.flowchartSubmission.problemId} = m.problem_id
          and ${FLOWCHART_PASSED} and ${schema.flowchartSubmission.createTime} < m.until
      ))
    ),
    per_user as (
      select k, user_id from solved group by k, user_id
      having count(distinct problem_id) >= (select count(*) from p p2 where p2.k = solved.k)
    )
    select k, count(*)::int as done from per_user group by k
  `)
  return new Map([...result].map((row) => [row.k, row.done]))
}

interface LessonSnapshot {
  id: number
  problemIds: number[]
  language: LessonLanguage | null
  mode: LessonMode
}

/**
 * 学生此刻看到的那一节：这个班今天最后布置的（和下面 lessonPlan 同一个取法），
 * 没布置为 null。改之前、改之后各拍一张，交给 announceLessonChange 比
 */
export async function todayLessonSnapshot(className: string): Promise<LessonSnapshot | null> {
  const [row] = await db
    .select({ id: schema.classLesson.id, problemIds: schema.classLesson.problemIds, language: schema.classLesson.language, mode: schema.classLesson.mode })
    .from(schema.classLesson)
    .where(and(eq(schema.classLesson.className, className), eq(schema.classLesson.day, calendarDay())))
    .orderBy(desc(schema.classLesson.createdAt), desc(schema.classLesson.id))
    .limit(1)
  return row?.problemIds.length ? { ...row, language: row.language ?? null } : null
}

/**
 * 改完之后再拍一张，和改之前那张比；学生看到的那一节变了，就告诉这个班改了哪些（见契约 lessonUpdateSchema）。
 * 推送失败只记日志：布置已经存下了，不能因为 Redis 抖一下让老师看到报错
 */
export async function announceLessonChange(className: string, before: LessonSnapshot | null) {
  try {
    const after = await todayLessonSnapshot(className)
    if (!before && !after) return
    const sameLesson = !!before && !!after && before.id === after.id
    const sameWay = sameLesson && before.language === after.language && before.mode === after.mode
    if (sameWay && before.problemIds.join() === after.problemIds.join()) return

    const ids = [...new Set([...(before?.problemIds ?? []), ...(after?.problemIds ?? [])])]
    const rows = ids.length
      ? await db
          .select({ id: schema.problem.id, displayId: schema.problem.displayId, title: schema.problem.title })
          .from(schema.problem)
          .where(and(inArray(schema.problem.id, ids), eq(schema.problem.visible, true), isNull(schema.problem.contestId)))
      : []
    const byId = new Map(rows.map((row) => [row.id, { problemDisplayId: row.displayId, title: row.title }]))
    const pick = (list: number[]) => list.flatMap((id) => byId.get(id) ?? [])

    const afterIds = after?.problemIds ?? []
    const beforeIds = sameLesson ? before.problemIds : []
    const added = afterIds.filter((id) => !beforeIds.includes(id))
    const removed = beforeIds.filter((id) => !afterIds.includes(id))
    const kept = afterIds.filter((id) => beforeIds.includes(id))
    const keptBefore = beforeIds.filter((id) => afterIds.includes(id))
    await publishLessonUpdate(className, {
      type: 'lesson_update',
      kind: !after ? 'cleared' : sameLesson ? 'changed' : 'assigned',
      language: after?.language ?? null,
      mode: after?.mode ?? null,
      problems: pick(afterIds),
      added: sameLesson ? pick(added) : [],
      removed: pick(removed),
      languageChanged: sameLesson && !sameWay,
      reordered: sameLesson && kept.join() !== keptBefore.join(),
    } satisfies LessonUpdate)
  } catch (error) {
    console.error('Failed to announce lesson change', error)
  }
}

/**
 * 同班同一天有这么多人做过，就算「班里在做」。2025 秋的实测分布是两极的：
 * (班级, 日, 题) 要么只有 1 个人（自己在刷），要么 13 人以上（老师点的题），
 * 5 落在中间的空档里，最小的那几个班（十来个人）也够得着。
 */
export const CLASS_ACTIVITY_MIN_USERS = 5
/** 往回找几天：上完课第二天在家补作业、请假回来的学生，都还能看到上一次课做了什么 */
export const CLASS_ACTIVITY_LOOKBACK_DAYS = 7
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
 *
 * 给了 `mode`（老师布置的这节做什么）：写代码只数代码、画流程图只数流程图；先画再写两种都数，
 * 「通过」要同一个人两样都做到 —— 所以先按人归一遍再数
 */
export async function classDayGroups(
  className: string,
  since: string,
  options: { minUsers?: number; problemIds?: number[]; language?: LessonLanguage | null; mode?: LessonMode | null } = {},
): Promise<ClassDayGroup[]> {
  const { mode } = options
  const activity = activityRows({
    since,
    users: classMemberIds(className),
    problemIds: options.problemIds,
    language: options.language,
    only: mode === 'code' || mode === 'flowchart' ? mode : undefined,
  })
  const day = sql<string>`to_char(${localTime(activity.createTime)}, 'YYYY-MM-DD')`
  const perUser = db
    .select({
      day: day.as('day'),
      problemId: sql<number>`${activity.problemId}`.as('problem_id'),
      userId: sql<number>`${activity.userId}`.as('user_id'),
      firstAt: sql<string>`min(${activity.createTime})`.as('first_at'),
      solved: (mode === 'both'
        ? sql<boolean>`bool_or(${activity.kind} = 'code' and ${activity.solved}) and bool_or(${activity.kind} = 'flowchart' and ${activity.solved})`
        : sql<boolean>`bool_or(${activity.solved})`
      ).as('solved'),
    })
    .from(activity)
    .groupBy(day, activity.problemId, activity.userId)
    .as('per_user')
  const userCount = sql<number>`count(*)::int`
  const query = db
    .select({
      day: perUser.day,
      problemId: perUser.problemId,
      firstAt: sql<string>`min(${perUser.firstAt})`,
      userCount,
      acceptedCount: sql<number>`(count(*) filter (where ${perUser.solved}))::int`,
    })
    .from(perUser)
    .groupBy(perUser.day, perUser.problemId)
  return options.minUsers ? query.having(sql`${userCount} >= ${options.minUsers}`) : query
}

/** 按 id 取题，只留学生看得见的（题库里、visible），被藏起来的点进去也是 404 */
async function visibleProblems(ids: number[]) {
  if (!ids.length) return new Map<number, { id: number; displayId: string; title: string; isSql: boolean }>()
  const rows = await db
    .select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      title: schema.problem.title,
      isSql: sql<boolean>`${schema.problem.languages} @> '["SQL"]'::jsonb`,
    })
    .from(schema.problem)
    .where(and(inArray(schema.problem.id, ids), eq(schema.problem.visible, true), isNull(schema.problem.contestId)))
  return new Map(rows.map((row) => [row.id, row]))
}

/**
 * 老师给这个班今天布置的题（problem.id，按输入顺序）、选的语言和做什么、布置时刻和布置的老师；
 * 没布置为 null。一天布置过几节的，取最后布置的那一节。老师写真名：老师之间认的是名字，用户名（lwp0201、little）认不出是谁
 */
async function lessonPlan(className: string, day: string) {
  const [row] = await db
    .select({
      id: schema.classLesson.id,
      problemIds: schema.classLesson.problemIds,
      language: schema.classLesson.language,
      mode: schema.classLesson.mode,
      createdAt: schema.classLesson.createdAt,
      createdBy: sql<string>`coalesce(nullif(${schema.userProfile.realName}, ''), ${schema.user.username})`,
    })
    .from(schema.classLesson)
    .innerJoin(schema.user, eq(schema.user.id, schema.classLesson.createdBy))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.classLesson.createdBy))
    .where(and(eq(schema.classLesson.className, className), eq(schema.classLesson.day, day)))
    .orderBy(desc(schema.classLesson.createdAt), desc(schema.classLesson.id))
    .limit(1)
  return row?.problemIds.length ? row : null
}

/**
 * 班里「这节课」的题。老师在课堂任务布置过就用老师的（source = teacher），
 * 否则从同班提交记录推断（source = inferred）：同班同一天 ≥ 5 人做过的题，只取最近的
 * **一天**、按那天第一次有人提交的时间排 —— 大致就是老师点题的顺序。
 *
 * 老师布置的优先，是因为推断在上课头几分钟是空的（还没人交），而那正是没听清题号的
 * 学生最需要它的时候。
 */
export async function classLessonProblems(className: string, lookbackDays: number) {
  const today = calendarDay()
  const plan = await lessonPlan(className, today)
  if (plan) {
    const planned = plan.problemIds
    const [problems, groups] = await Promise.all([
      visibleProblems(planned),
      classDayGroups(className, dayStart(), { problemIds: planned, language: plan.language, mode: plan.mode }),
    ])
    const groupById = new Map(groups.map((row) => [row.problemId, row]))
    return {
      source: 'teacher' as const,
      lessonId: plan.id,
      day: today,
      language: plan.language ?? null,
      mode: plan.mode,
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
  const latest = groups.reduce<string | null>((acc, row) => (!acc || row.day > acc ? row.day : acc), null)
  const picked = groups
    .filter((row) => row.day === latest)
    .sort((a, b) => a.firstAt.localeCompare(b.firstAt))
    .slice(0, CLASS_ACTIVITY_LIMIT)
  const problems = await visibleProblems(picked.map((row) => row.problemId))
  return {
    source: picked.length ? ('inferred' as const) : null,
    lessonId: null,
    day: picked.length ? latest : null,
    // 推断出来的课不知道老师要的是哪种语言、要画还是要写，不限
    language: null,
    mode: null,
    assignedAt: null,
    assignedBy: null,
    problems: picked.flatMap((row) => {
      const problem = problems.get(row.problemId)
      return problem ? [{ ...problem, userCount: row.userCount, acceptedCount: row.acceptedCount }] : []
    }),
  }
}

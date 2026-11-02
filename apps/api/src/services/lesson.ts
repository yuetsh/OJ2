import { isSqlProblem, lessonNeeds, STUDENT_ROLES, type LessonLanguage, type LessonMode, type LessonUpdate } from '@oj2/contract'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { db, schema } from '../db'
import { publishLessonUpdate } from '../events'
import { calendarDay, dayNumber, dayStart } from '../time'
import { FLOWCHART_PASSED, SOLVED_RESULTS } from './class-activity'

/**
 * 布置的课（class_lesson）几处共用的口径：课堂看板布置、后台「课堂作业」增改、
 * 数据统计按布置切课。放在一起，免得看板能布置的题后台布置不上，或者两边「做完」数得不一样。
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
 * （SQL 题放行）；画流程图只认评到 A / S；先画再写两样都要 —— 和看板的格子同一个口径。
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
 * 学生此刻看到的那一节：这个班今天最后布置的（和 routes/classroom.ts 的 lessonPlan 同一个取法），
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

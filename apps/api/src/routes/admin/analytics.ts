/**
 * 学情分析里的「卡点分析」和「历年概况」。
 *
 * 两边共用一个口径：**人 × 题**。原来的卡点数的是「错过一次的人」，全部时间、不分班 ——
 * 阿福讲白搭显示 325 人卡住，交过的 782 人里其实 753 人后来做对了，排在前面的只是做的人多。
 * 课堂驱动的题最后几乎都会做对（这学期「交过还没做对」最多的一道也就 10 人），真正卡人的是
 * 「要交好几次才对」，所以这里给的是：第一次交就对的人、做对的人、做对之前交了几次。
 *
 * - 只算学生（STUDENT_ROLES），只算非比赛提交；没判完的、判题机自己崩了的（SYSTEM_ERROR）
 *   不算一次「交」。
 * - 选了时间段时，只算**第一次交**落在这段时间里的人题对，指标按这对的全部历史算 ——
 *   否则「最近 7 天」会把上周错、这周对的人算成一次就对。
 * - 「做对平均交几次」只数做对那次及之前的，做对以后又交的不算。
 *
 * 路径挂在 /problem-analytics 下，不放进 /problems：Hono 按注册顺序匹配，
 * problem.ts 先注册的 `/problems/:id` 会把它整个吃掉（以前真发生过，见 git 历史）。
 */

import {
  STUDENT_ROLES,
  type StuckProblem,
  type StuckProblemDetail,
  type YearlyOverview,
  type YearlySummary,
} from "@oj2/contract"
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"

import { requireTeacher, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { JudgeStatus } from "../../judge/status"
import { schoolYearOf, schoolYearStart, schoolYearStartOf, shiftMonthsByCalendar } from "../../time"
import { queryInteger } from "../helpers"

export const adminAnalyticsRoutes = new Hono<AppEnv>()

const ACCEPTED = sql.join([JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED], sql`, `)
const NOT_COUNTED = sql.join(
  [JudgeStatus.PENDING, JudgeStatus.JUDGING, JudgeStatus.SYSTEM_ERROR],
  sql`, `,
)
const STUDENTS = sql.join(
  STUDENT_ROLES.map((role) => sql`${role}`),
  sql`, `,
)

/** `start` 是 ISO 时刻，解析不了就当没给（= 全部时间） */
function parseStart(value: string | undefined) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/**
 * 学生的非比赛提交，每条带上「这对人题」第一次做对的时刻和序号。
 * 后面的查询都从这张表聚合成人题对。
 */
function studentSubmissions(where: SQL[]) {
  return sql`
    select s.id, s.user_id, s.problem_id, s.create_time, s.result, s.language, u.class_name,
      min(s.create_time) filter (where s.result in (${ACCEPTED}))
        over (partition by s.user_id, s.problem_id) as ac_at,
      row_number() over (partition by s.user_id, s.problem_id order by s.create_time, s.id) as rn
    from ${schema.submission} s
    join ${schema.user} u on u.id = s.user_id
    where s.contest_id is null
      and s.result not in (${NOT_COUNTED})
      and u.admin_type in (${STUDENTS})
      ${sql.join(
        where.map((condition) => sql`and ${condition}`),
        sql` `,
      )}
  `
}

/** 班级精确匹配、时间段只留「在这段时间里交过」的人题对（第一次交在不在段里由 having 再卡） */
function scope(className: string | undefined, start: string | null, problemId?: number) {
  const where: SQL[] = []
  if (problemId) where.push(sql`s.problem_id = ${problemId}`)
  if (className) where.push(sql`u.class_name = ${className}`)
  if (start)
    where.push(sql`(s.user_id, s.problem_id) in (
      select user_id, problem_id from ${schema.submission}
      where contest_id is null and create_time >= ${start}
      ${problemId ? sql`and problem_id = ${problemId}` : sql``}
    )`)
  return where
}

async function knowledgeTags(problemIds: number[]) {
  const tags = new Map<number, string[]>()
  if (!problemIds.length) return tags
  const rows = await db
    .select({ problemId: schema.problemTags.problemId, name: schema.problemTag.name })
    .from(schema.problemTags)
    .innerJoin(schema.problemTag, eq(schema.problemTag.id, schema.problemTags.problemtagId))
    .where(
      and(
        inArray(schema.problemTags.problemId, problemIds),
        eq(schema.problemTag.category, "knowledge"),
      ),
    )
  for (const row of rows) tags.set(row.problemId, [...(tags.get(row.problemId) ?? []), row.name])
  return tags
}

// ---------------------------------------------------------------- 卡点：每道题一行

adminAnalyticsRoutes.get("/problem-analytics/stuck", requireTeacher, async (c) => {
  const className = c.req.query("className")?.trim() || undefined
  const start = parseStart(c.req.query("start"))
  const rows = await db.execute<{
    id: number
    display_id: string
    title: string
    users: number
    first_try: number
    solved: number
    solved_tries: number
  }>(sql`
    with s as (${studentSubmissions(scope(className, start))}),
    pairs as (
      select problem_id,
        bool_or(rn = 1 and result in (${ACCEPTED})) as first_try,
        min(ac_at) as ac_at,
        count(*) filter (where ac_at is null or create_time <= ac_at) as tries
      from s
      group by user_id, problem_id
      ${start ? sql`having min(create_time) >= ${start}` : sql``}
    )
    select p.id, p._id as display_id, p.title,
      count(*)::int as users,
      count(*) filter (where first_try)::int as first_try,
      count(*) filter (where ac_at is not null)::int as solved,
      coalesce(sum(tries) filter (where ac_at is not null), 0)::int as solved_tries
    from pairs
    join ${schema.problem} p on p.id = pairs.problem_id
    group by p.id
  `)
  const tags = await knowledgeTags(rows.map((row) => row.id))
  return success(
    c,
    rows.map(
      (row) =>
        ({
          id: row.id,
          displayId: row.display_id,
          title: row.title,
          tags: tags.get(row.id) ?? [],
          users: row.users,
          firstTry: row.first_try,
          solved: row.solved,
          solvedTries: row.solved_tries,
        }) satisfies StuckProblem,
    ),
  )
})

// ---------------------------------------------------------------- 卡点：一道题

adminAnalyticsRoutes.get("/problem-analytics/stuck/:id", requireTeacher, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [problem] = await db
    .select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      title: schema.problem.title,
    })
    .from(schema.problem)
    .where(eq(schema.problem.id, id))
  if (!problem) return failure(c, 404, "problem-not-found", "题目不存在")

  const className = c.req.query("className")?.trim() || undefined
  const start = parseStart(c.req.query("start"))
  const pairs = sql`
    with s as (${studentSubmissions(scope(className, start, id))}),
    pairs as (
      select user_id, min(create_time) as first_at, min(ac_at) as ac_at,
        bool_or(rn = 1 and result in (${ACCEPTED})) as first_try,
        count(*) filter (where ac_at is null or create_time <= ac_at) as tries,
        (array_agg(result order by create_time desc, id desc))[1] as last_result,
        (array_agg(id order by create_time desc, id desc))[1] as last_id
      from s
      group by user_id
      ${start ? sql`having min(create_time) >= ${start}` : sql``}
    )
  `
  const [students, errors, history, tags] = await Promise.all([
    db.execute<{
      username: string
      class_name: string | null
      first_try: boolean
      solved: boolean
      tries: number
      minutes: number | null
      last_result: number
      last_id: string
    }>(sql`
      ${pairs}
      select u.username, u.class_name, pairs.first_try, pairs.ac_at is not null as solved,
        pairs.tries::int as tries,
        round(extract(epoch from pairs.ac_at - pairs.first_at) / 60)::int as minutes,
        pairs.last_result, pairs.last_id
      from pairs join ${schema.user} u on u.id = pairs.user_id
    `),
    db.execute<{ result: number; count: number }>(sql`
      ${pairs}
      select s.result, count(*)::int as count
      from s join pairs using (user_id)
      where s.result not in (${ACCEPTED})
      group by s.result
      order by count desc
    `),
    // 历年：全站、全部时间，按第一次交落在哪个学年分
    db.execute<{ year: number; users: number; first_try: number }>(sql`
      with s as (${studentSubmissions([sql`s.problem_id = ${id}`])}),
      pairs as (
        select min(create_time) as first_at, bool_or(rn = 1 and result in (${ACCEPTED})) as first_try
        from s group by user_id
      )
      select ${schoolYearOf(sql`first_at`)} as year, count(*)::int as users,
        count(*) filter (where first_try)::int as first_try
      from pairs group by 1 order by 1
    `),
    knowledgeTags([id]),
  ])
  return success(c, {
    problem: { ...problem, tags: tags.get(id) ?? [] },
    students: students.map((row) => ({
      username: row.username,
      className: row.class_name,
      firstTry: row.first_try,
      solved: row.solved,
      tries: row.tries,
      minutes: row.minutes,
      lastResult: row.last_result,
      lastSubmissionId: row.last_id,
    })),
    errors: errors.map((row) => ({ result: row.result, count: row.count })),
    history: history.map((row) => ({ year: row.year, users: row.users, firstTry: row.first_try })),
  } satisfies StuckProblemDetail)
})

// ---------------------------------------------------------------- 历年概况

/** 「在用的年级」：这段时间里至少这么多人交过题的年级才列 */
const GRADE_MIN_USERS = 20

adminAnalyticsRoutes.get("/problem-analytics/yearly", requireTeacher, async (c) => {
  const now = new Date()
  const current = schoolYearStart(now)
  const [first] = await db.execute<{ year: number | null }>(sql`
    select ${schoolYearOf(sql`min(create_time)`)} as year
    from ${schema.submission} where contest_id is null
  `)
  const firstYear = Math.min(first?.year ?? current.year, current.year)

  // 每个完整学年、进行中的学年（到现在），外加去年同期（上一学年开学到去年的今天）
  const ranges: { key: number; year: number; from: string; to: string }[] = []
  for (let year = firstYear; year <= current.year; year += 1) {
    const to = year === current.year ? now.toISOString() : schoolYearStartOf(year + 1)
    ranges.push({ key: year, year, from: schoolYearStartOf(year), to })
  }
  const hasLastYear = current.year - 1 >= firstYear
  if (hasLastYear)
    ranges.push({
      key: -1,
      year: current.year - 1,
      from: schoolYearStartOf(current.year - 1),
      to: shiftMonthsByCalendar(now, -12).toISOString(),
    })

  const values = sql.join(
    ranges.map(
      (range) => sql`(${range.key}::int, ${range.from}::timestamptz, ${range.to}::timestamptz)`,
    ),
    sql`, `,
  )
  const rows = await db.execute<{
    key: number
    users: number
    submissions: number
    problems: number
    c_submissions: number
    solved_pairs: number
    started_pairs: number
    first_try_pairs: number
    solved_started: number
    solved_tries: number
    grades: string[] | null
  }>(sql`
    with ranges(key, f, t) as (values ${values}),
    s as (${studentSubmissions([])}),
    pairs as (
      select min(create_time) as first_at, min(ac_at) as ac_at,
        bool_or(rn = 1 and result in (${ACCEPTED})) as first_try,
        count(*) filter (where ac_at is null or create_time <= ac_at) as tries
      from s group by user_id, problem_id
    ),
    sub_stats as (
      select r.key, count(distinct s.user_id)::int as users, count(*)::int as submissions,
        count(distinct s.problem_id)::int as problems,
        count(*) filter (where s.language in ('C', 'C++'))::int as c_submissions
      from s join ranges r on s.create_time >= r.f and s.create_time < r.t
      group by r.key
    ),
    pair_stats as (
      select r.key,
        count(*) filter (where p.ac_at >= r.f and p.ac_at < r.t)::int as solved_pairs,
        count(*) filter (where p.first_at >= r.f and p.first_at < r.t)::int as started_pairs,
        count(*) filter (where p.first_at >= r.f and p.first_at < r.t and p.first_try)::int
          as first_try_pairs,
        count(*) filter (where p.first_at >= r.f and p.first_at < r.t and p.ac_at is not null)::int
          as solved_started,
        coalesce(sum(p.tries) filter (
          where p.first_at >= r.f and p.first_at < r.t and p.ac_at is not null
        ), 0)::int as solved_tries
      from pairs p join ranges r
        on (p.first_at >= r.f and p.first_at < r.t) or (p.ac_at >= r.f and p.ac_at < r.t)
      group by r.key
    ),
    grade_stats as (
      select key, json_agg(grade order by grade) as grades from (
        select r.key, left(s.class_name, 2) as grade
        from s join ranges r on s.create_time >= r.f and s.create_time < r.t
        where s.class_name ~ '^[0-9]{3,}$'
        group by r.key, left(s.class_name, 2)
        having count(distinct s.user_id) >= ${GRADE_MIN_USERS}
      ) g group by key
    )
    select r.key, coalesce(sub.users, 0) as users, coalesce(sub.submissions, 0) as submissions,
      coalesce(sub.problems, 0) as problems, coalesce(sub.c_submissions, 0) as c_submissions,
      coalesce(ps.solved_pairs, 0) as solved_pairs, coalesce(ps.started_pairs, 0) as started_pairs,
      coalesce(ps.first_try_pairs, 0) as first_try_pairs,
      coalesce(ps.solved_started, 0) as solved_started,
      coalesce(ps.solved_tries, 0) as solved_tries, gs.grades
    from ranges r
    left join sub_stats sub on sub.key = r.key
    left join pair_stats ps on ps.key = r.key
    left join grade_stats gs on gs.key = r.key
  `)

  const byKey = new Map(rows.map((row) => [row.key, row]))
  const summary = (range: (typeof ranges)[number]): YearlySummary => {
    const row = byKey.get(range.key)
    return {
      year: range.year,
      until: range.to,
      grades: row?.grades ?? [],
      users: row?.users ?? 0,
      submissions: row?.submissions ?? 0,
      problems: row?.problems ?? 0,
      solvedPairs: row?.solved_pairs ?? 0,
      startedPairs: row?.started_pairs ?? 0,
      firstTryPairs: row?.first_try_pairs ?? 0,
      solvedStarted: row?.solved_started ?? 0,
      solvedTries: row?.solved_tries ?? 0,
      cSubmissions: row?.c_submissions ?? 0,
    }
  }
  const lastYear = ranges.find((range) => range.key === -1)
  return success(c, {
    years: ranges.filter((range) => range.key !== -1).map(summary),
    lastYearToDate: lastYear ? summary(lastYear) : null,
  } satisfies YearlyOverview)
})

/**
 * 学情分析里的「卡点分析」和「年度趋势」（这届和往届比）。
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
  type GradeTrend,
} from "@oj2/contract"
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"

import { requireTeacher, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { JudgeStatus } from "../../judge/status"
import { schoolYearOf } from "../../time"
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

// ---------------------------------------------------------------- 年度趋势：这届和往届比

/** 每边至少这么多人做过，这道题才拿来比 */
const GRADE_MIN_USERS = 20
/** 没指定届时，挑最新一届里能和往届比上这么多道题的 */
const GRADE_DEFAULT_MIN_PROBLEMS = 5
const PAST = "past"

type GradeSide = GradeTrend["problems"][number]["mine"]

/**
 * 选一届，和往届（更早几届合在一起，人多的届分量大）或另一届，逐题比「一次就对」。
 * 届 = 班号前两位（253 → 25 级），没有班级或班号不是数字的不算。
 *
 * **按同期比**：每个人以自己第一次交题为起点，两边都只算第一次交这道题时离起点不超过
 * N 天的人题对，N = 两边里学得最短的那届已经学了多久（那届一半人开始做题到现在的天数）。
 * 不这么卡的话，刚学一个月的 25 级会和学了一年多回头做同一道题的 24 级比 —— 本地数据里
 * 同期两边 73% / 75%，全部记录一比成了 73% / 82%。起点按人不按日历：各届开始做题的时间
 * 不一样（23 级入学就做、25 级第二年才做），对「去年同期」是对不上的。
 */
adminAnalyticsRoutes.get("/problem-analytics/grades", requireTeacher, async (c) => {
  const [cells, starts] = await Promise.all([
    db.execute<{
      problem_id: number
      grade: string
      days: number
      users: number
      first_try: number
    }>(sql`
      with s as (${studentSubmissions([sql`u.class_name ~ '^[0-9]{3,}$'`])}),
      starts as (select user_id, min(create_time) as started_at from s group by user_id),
      pairs as (
        select problem_id, left(min(class_name), 2) as grade,
          floor(extract(epoch from min(create_time) - min(started_at)) / 86400)::int as days,
          bool_or(rn = 1 and result in (${ACCEPTED})) as first_try
        from s join starts using (user_id)
        group by user_id, problem_id
      )
      select problem_id, grade, days, count(*)::int as users,
        count(*) filter (where first_try)::int as first_try
      from pairs group by 1, 2, 3
    `),
    // 每届学了多久：一半人开始做题到现在的天数（几个提前注册的人拉不动它）
    db.execute<{ grade: string; days: number }>(sql`
      with starts as (
        select left(min(u.class_name), 2) as grade, min(s.create_time) as started_at
        from ${schema.submission} s join ${schema.user} u on u.id = s.user_id
        where s.contest_id is null and s.result not in (${NOT_COUNTED})
          and u.admin_type in (${STUDENTS}) and u.class_name ~ '^[0-9]{3,}$'
        group by s.user_id
      )
      select grade, floor(extract(epoch from now()
          - percentile_disc(0.5) within group (order by started_at)) / 86400)::int as days
      from starts group by grade
    `),
  ])
  const studied = new Map(starts.map((row) => [row.grade, row.days]))
  const grades = [...new Set(cells.map((cell) => cell.grade))].sort((a, b) => b.localeCompare(a))

  function compare(grade: string, other: string) {
    const isOther = other === PAST ? (g: string) => g < grade : (g: string) => g === other
    const involved = grades.filter((g) => g === grade || isOther(g))
    const limit = Math.min(...involved.map((g) => studied.get(g) ?? Infinity))
    const sides = new Map<number, { mine: GradeSide; theirs: GradeSide }>()
    let trimmed = false
    for (const cell of cells) {
      const mine = cell.grade === grade
      if (!mine && !isOther(cell.grade)) continue
      if (cell.days > limit) {
        trimmed = true
        continue
      }
      const entry = sides.get(cell.problem_id) ?? {
        mine: { users: 0, firstTry: 0 },
        theirs: { users: 0, firstTry: 0 },
      }
      const side = mine ? entry.mine : entry.theirs
      side.users += cell.users
      side.firstTry += cell.first_try
      sides.set(cell.problem_id, entry)
    }
    const problems = [...sides]
      .filter(([, e]) => e.mine.users >= GRADE_MIN_USERS && e.theirs.users >= GRADE_MIN_USERS)
      .map(([id, e]) => ({ id, ...e }))
    return { days: trimmed ? limit : null, problems }
  }

  const asked = c.req.query("grade") ?? ""
  const grade = grades.includes(asked)
    ? asked
    : (grades.find((g) => compare(g, PAST).problems.length >= GRADE_DEFAULT_MIN_PROBLEMS) ??
      grades[0] ??
      "")
  const askedCompare = c.req.query("compare") ?? PAST
  const other = askedCompare !== grade && grades.includes(askedCompare) ? askedCompare : PAST
  const result = grade ? compare(grade, other) : { days: null, problems: [] }

  const titles = result.problems.length
    ? await db
        .select({
          id: schema.problem.id,
          displayId: schema.problem.displayId,
          title: schema.problem.title,
        })
        .from(schema.problem)
        .where(
          inArray(
            schema.problem.id,
            result.problems.map((row) => row.id),
          ),
        )
    : []
  const byId = new Map(titles.map((row) => [row.id, row]))
  return success(c, {
    grades,
    grade,
    compare: other,
    days: result.days,
    problems: result.problems.flatMap((row) => {
      const problem = byId.get(row.id)
      return problem ? [{ ...problem, mine: row.mine, theirs: row.theirs }] : []
    }),
  } satisfies GradeTrend)
})

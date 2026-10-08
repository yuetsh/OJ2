import { STUDENT_ROLES, type ProblemStats } from "@oj2/contract"
import { and, count, eq, inArray, sql } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { UNJUDGED_RESULTS, type JudgeStatusValue } from "../judge/status"
import { canAccessContest, contestDetailsAllowed, findAccessibleContest } from "../services/contest"
import { accepted } from "../services/learning-stats"
import { isAdminRole, isTeacherOrAbove, queryInteger } from "./helpers"

export const problemStatsRoutes = new Hono<AppEnv>()

const EMPTY: ProblemStats = {
  locked: false,
  tried: 0,
  solved: 0,
  tries: { one: 0, few: 0, many: 0 },
  failures: [],
  me: null,
  myClass: null,
  classes: null,
}

// type 而不是 interface：db.execute 的泛型约束是 Record<string, unknown>，interface 不带索引签名
type UserRow = {
  user_id: number
  username: string | null
  class_name: string | null
  attempts: number
  /** 做对之前（含做对那次）交了几次；没做对就是全部次数 */
  tries: number
  solved: boolean
}

/**
 * 题目页「统计」页签：讲的是**这道题**（难不难、几次做对、常错在哪），老师多一张各班的表。
 * 看谁没做对是提交页「数据统计」的活，这里只到班级这一层。
 * id 是内部题号（problem.id）：比赛题的展示题号是 1、2、3，拿 displayId 查会撞上
 * 同号的公开题（原来的「历年 AC 率」就是这么查错的）。
 */
problemStatsRoutes.get("/problems/:id/stats", optionalAuth, async (c) => {
  const user = c.get("user")
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [problem] = await db
    .select({
      id: schema.problem.id,
      contestId: schema.problem.contestId,
      visible: schema.problem.visible,
    })
    .from(schema.problem)
    .where(eq(schema.problem.id, id))
    .limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")

  const inContest = problem.contestId !== null
  if (inContest) {
    const contest = await findAccessibleContest(user, problem.contestId!)
    if (!contest) return failure(c, 404, "problem-not-found", "Problem does not exist")
    const access = await canAccessContest(c, contest, "problems")
    if (!access.ok) return failure(c, 403, access.code, access.message)
    // 比赛没结束：别人几次做对、错在哪一律不给，和题目详情里计数归零同一个口径
    if (!contestDetailsAllowed(user, contest)) {
      return success(c, { ...EMPTY, locked: true } satisfies ProblemStats)
    }
  } else if (!problem.visible && !isAdminRole(user)) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }

  const acceptedList = sql.join(
    accepted.map((value) => sql`${value}`),
    sql`, `,
  )
  const unjudgedList = sql.join(
    UNJUDGED_RESULTS.map((value) => sql`${value}`),
    sql`, `,
  )
  // 每人一行：窗口函数先给每条提交标上这个人第一次做对的时刻，再按人数到那一刻为止交了几次
  const [users, failureRows] = await Promise.all([
    db.execute<UserRow>(sql`
      select s.user_id, u.username, u.class_name,
        count(*)::int as attempts,
        count(*) filter (where s.first_ac is null or s.create_time <= s.first_ac)::int as tries,
        (min(s.first_ac) is not null) as solved
      from (
        select user_id, result, create_time,
          min(create_time) filter (where result in (${acceptedList}))
            over (partition by user_id) as first_ac
        from ${schema.submission}
        where problem_id = ${problem.id} and result not in (${unjudgedList})
      ) s
      left join ${schema.user} u on u.id = s.user_id
      group by s.user_id, u.username, u.class_name
    `),
    db.execute<{ class_name: string | null; result: JudgeStatusValue; n: number }>(sql`
      select u.class_name, s.result, count(*)::int as n
      from ${schema.submission} s
      left join ${schema.user} u on u.id = s.user_id
      where s.problem_id = ${problem.id}
        and s.result not in (${acceptedList})
        and s.result not in (${unjudgedList})
      group by u.class_name, s.result
    `),
  ])

  const solvedUsers = users.filter((row) => row.solved)
  const tries = { one: 0, few: 0, many: 0 }
  for (const row of solvedUsers) {
    if (row.tries <= 1) tries.one++
    else if (row.tries <= 3) tries.few++
    else tries.many++
  }
  const sortFailures = (map: Map<JudgeStatusValue, number>) =>
    [...map].map(([result, count]) => ({ result, count })).sort((a, b) => b.count - a.count)
  const siteFailures = new Map<JudgeStatusValue, number>()
  for (const row of failureRows) {
    siteFailures.set(row.result, (siteFailures.get(row.result) ?? 0) + row.n)
  }

  const mine = user ? users.find((row) => row.user_id === user.id) : undefined
  const myClassName = !inContest && user?.className ? user.className : null
  const classmates = myClassName ? users.filter((row) => row.class_name === myClassName) : []

  let classes: ProblemStats["classes"] = null
  if (!inContest && isTeacherOrAbove(user)) classes = await classRows(problem.id)

  return success(c, {
    locked: false,
    tried: users.length,
    solved: solvedUsers.length,
    tries,
    failures: sortFailures(siteFailures),
    me: user ? { attempts: mine?.attempts ?? 0, solved: mine?.solved ?? false } : null,
    myClass: myClassName
      ? {
          className: myClassName,
          tried: classmates.length,
          solved: classmates.filter((row) => row.solved).length,
        }
      : null,
    classes,
  } satisfies ProblemStats)
})

/**
 * 各班一行，和数据统计「按班级汇总」（statistics/components/ByClass.vue）同一个口径：
 * 只算学生角色、没禁用的号，班级人数也这么数。那边是前端拿逐条提交现算的（最多 5000 条），
 * 这里在库里直接聚合，数是一样的。
 */
async function classRows(problemId: number): Promise<NonNullable<ProblemStats["classes"]>> {
  const acceptedList = sql.join(
    accepted.map((value) => sql`${value}`),
    sql`, `,
  )
  const unjudgedList = sql.join(
    UNJUDGED_RESULTS.map((value) => sql`${value}`),
    sql`, `,
  )
  const rows = await db.execute<{
    class_name: string | null
    tried: number
    solved: number
    accepted: number
    judged: number
    last_time: string
  }>(sql`
    select u.class_name,
      count(distinct s.user_id)::int as tried,
      count(distinct s.user_id) filter (where s.result in (${acceptedList}))::int as solved,
      count(*) filter (where s.result in (${acceptedList}))::int as accepted,
      count(*) filter (where s.result not in (${unjudgedList}))::int as judged,
      max(s.create_time) as last_time
    from ${schema.submission} s
    join ${schema.user} u on u.id = s.user_id
    where s.problem_id = ${problemId} and s.contest_id is null
      and u.admin_type = 'Regular User' and u.is_disabled = false
    group by u.class_name
  `)
  const names = rows.map((row) => row.class_name).filter((name) => name !== null)
  const sizes = names.length
    ? await db
        .select({ className: schema.user.className, value: count() })
        .from(schema.user)
        .where(
          and(
            inArray(schema.user.className, names),
            inArray(schema.user.adminType, [...STUDENT_ROLES]),
            eq(schema.user.isDisabled, false),
          ),
        )
        .groupBy(schema.user.className)
    : []
  return (
    rows
      .map((row) => {
        const classSize =
          (row.class_name && sizes.find((item) => item.className === row.class_name)?.value) ||
          row.tried
        return {
          className: row.class_name,
          classSize,
          solved: row.solved,
          unsolved: row.tried - row.solved,
          untouched: Math.max(0, classSize - row.tried),
          correctRate: row.judged ? Math.round((row.accepted / row.judged) * 100) : null,
          lastTime: row.last_time,
        }
      })
      // 交过的人多的在前：按最近一次排的话，零星一两个人补做的班会压在全班做过的班上面
      .sort(
        (a, b) =>
          b.solved + b.unsolved - (a.solved + a.unsolved) || b.lastTime.localeCompare(a.lastTime),
      )
  )
}

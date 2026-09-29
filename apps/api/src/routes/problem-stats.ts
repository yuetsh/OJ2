import { type ProblemStats } from "@oj2/contract"
import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus, UNJUDGED_RESULTS, type JudgeStatusValue } from "../judge/status"
import { canAccessContest, contestDetailsAllowed, findAccessibleContest } from "../services/contest"
import { accepted } from "../services/learning-stats"
import { localTime } from "../time"
import { isAdminRole, isTeacherOrAbove, queryInteger } from "./helpers"

export const problemStatsRoutes = new Hono<AppEnv>()

/**
 * 同一天班里至少这么多人交过，才算「这个班一起做过这题」。只看总人数不行：
 * 2079 有个班 2 月里零星补做了 6 个人，比 12 月全班 26 人做的那次还「近」，默认就选成了它
 */
const CLASS_MIN_TRIED = 5

const EMPTY: ProblemStats = {
  locked: false,
  tried: 0,
  solved: 0,
  tries: { one: 0, few: 0, many: 0 },
  failures: [],
  wrongAnswerFirstCase: 0,
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
  const day = sql<string>`to_char(${localTime(schema.submission.createTime)}, 'YYYY-MM-DD')`
  const [users, failureRows, firstCase, classDays] = await Promise.all([
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
    // 判题机按测试点回一个数组，test_case 是 "1"、"2"……
    db.execute<{ n: number }>(sql`
      select count(*)::int as n from ${schema.submission}
      where problem_id = ${problem.id} and result = ${JudgeStatus.WRONG_ANSWER}
        and jsonb_typeof(info->'data') = 'array'
        and exists (
          select 1 from jsonb_array_elements(info->'data') e
          where e->>'test_case' = '1' and (e->>'result')::int <> 0
        )
    `),
    // 每个班每天几个人交过，取人最多的那天当「这个班做这题的那天」
    db
      .select({
        className: schema.user.className,
        day,
        users: sql<number>`count(distinct ${schema.submission.userId})::int`,
      })
      .from(schema.submission)
      .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
      .where(and(eq(schema.submission.problemId, problem.id), isNotNull(schema.user.className)))
      .groupBy(schema.user.className, day),
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
  if (!inContest && isTeacherOrAbove(user)) {
    const byClass = new Map<string, UserRow[]>()
    for (const row of users) {
      if (!row.class_name) continue
      byClass.set(row.class_name, [...(byClass.get(row.class_name) ?? []), row])
    }
    const peak = new Map<string, { day: string; users: number }>()
    for (const row of classDays) {
      const current = peak.get(row.className!)
      const later = current && row.users === current.users && row.day > current.day
      if (!current || row.users > current.users || later) {
        peak.set(row.className!, { day: row.day, users: row.users })
      }
    }
    const lessonClasses = [...byClass].filter(
      ([className]) => (peak.get(className)?.users ?? 0) >= CLASS_MIN_TRIED,
    )
    // 花名册只数学生：老师、助教也可能挂着班级
    const sizes = lessonClasses.length
      ? await db
          .select({ className: schema.user.className, value: count() })
          .from(schema.user)
          .where(
            and(
              inArray(
                schema.user.className,
                lessonClasses.map(([className]) => className),
              ),
              eq(schema.user.adminType, "Regular User"),
              eq(schema.user.isDisabled, false),
            ),
          )
          .groupBy(schema.user.className)
      : []
    classes = lessonClasses
      .map(([className, rows]) => {
        const top = failureRows
          .filter((row) => row.class_name === className)
          .sort((a, b) => b.n - a.n)[0]
        return {
          className,
          day: peak.get(className)!.day,
          tried: rows.length,
          solved: rows.filter((row) => row.solved).length,
          classSize: sizes.find((row) => row.className === className)?.value ?? 0,
          topFailure: top ? { result: top.result, count: top.n } : null,
        }
      })
      .sort((a, b) => b.day.localeCompare(a.day))
  }

  return success(c, {
    locked: false,
    tried: users.length,
    solved: solvedUsers.length,
    tries,
    failures: sortFailures(siteFailures),
    wrongAnswerFirstCase: firstCase[0]?.n ?? 0,
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

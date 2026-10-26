/**
 * 智能分析：页面（GET /ai/report）和喂给 AI 小结的学情数据都从这里算。
 *
 * 主线是「每节课」：中职的课八成提交在课上，学生回想自己学了什么，记得的是「周三那节课」，
 * 不是某一周、某个月。所以按天排开，每天分成「班上这节课的题」和「自己练的题」两组。
 * 一节课的题怎么定，和课堂看板 / 首页「班里在做」同一个口径（routes/classroom.ts）：
 * 老师在看板布置过就用布置的，否则同班同一天 ≥ 5 人做过的题。
 *
 * 做对的口径也同看板：代码 AC / AST_CHECK_FAILED、流程图评到 A / S；比赛提交不算
 * （比赛是课堂测验，题目也不在题库里）。
 */
import { FLOWCHART_PASS_GRADES, STUDENT_ROLES, type LearningDay, type LearningItem, type LearningPeriod, type LearningReport } from '@oj2/contract'
import { and, asc, count, desc, eq, gte, inArray, isNull } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

import { db, schema } from '../db'
import { JudgeStatus, type JudgeStatusValue } from '../judge/status'
import { calendarDay, monthStart, termStart, weekStart } from '../time'

export const accepted: JudgeStatusValue[] = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

/** 同 routes/classroom.ts 的 CLASS_ACTIVITY_MIN_USERS：同班同一天几个人做过，才算这节课的题 */
const LESSON_MIN_USERS = 5

/** 不算进「错在哪」的状态：判题机自己崩的、还没判完的 */
const NOT_STUDENT_ERRORS: number[] = [JudgeStatus.SYSTEM_ERROR, JudgeStatus.PENDING, JudgeStatus.JUDGING]

export function periodStart(period: LearningPeriod, now = new Date()): string | null {
  if (period === 'week') return weekStart(now)
  if (period === 'month') return monthStart(now)
  if (period === 'term') return termStart(now)
  return null
}

interface Row {
  userId: number
  problemId: number
  time: number
  solved: boolean
  /** 代码提交的判题状态；流程图为 null */
  result: number | null
}

/** 代码提交（不含比赛）和流程图提交并成一张，按时间先后 */
async function activity(userIds: number[], start: string | null): Promise<Row[]> {
  const epoch = (column: typeof schema.submission.createTime) => sql<number>`extract(epoch from ${column}) * 1000`.mapWith(Number)
  const [code, flow] = await Promise.all([
    db
      .select({
        userId: schema.submission.userId,
        problemId: schema.submission.problemId,
        time: epoch(schema.submission.createTime),
        result: schema.submission.result,
      })
      .from(schema.submission)
      .where(
        and(inArray(schema.submission.userId, userIds), isNull(schema.submission.contestId), start ? gte(schema.submission.createTime, start) : undefined),
      ),
    db
      .select({
        userId: schema.flowchartSubmission.userId,
        problemId: schema.flowchartSubmission.problemId,
        time: sql<number>`extract(epoch from ${schema.flowchartSubmission.createTime}) * 1000`.mapWith(Number),
        status: schema.flowchartSubmission.status,
        grade: schema.flowchartSubmission.aiGrade,
      })
      .from(schema.flowchartSubmission)
      .where(and(inArray(schema.flowchartSubmission.userId, userIds), start ? gte(schema.flowchartSubmission.createTime, start) : undefined)),
  ])
  const pass: readonly string[] = FLOWCHART_PASS_GRADES
  return [
    ...code.map((row) => ({ ...row, solved: accepted.includes(row.result) })),
    ...flow.map((row) => ({
      userId: row.userId,
      problemId: row.problemId,
      time: row.time,
      solved: row.status === 2 && pass.includes(row.grade ?? ''),
      result: null,
    })),
  ].sort((a, b) => a.time - b.time)
}

/** 一个人在一道题上：第一次交的时刻、做对的时刻、到做对为止交了几次、没做对时最后一次的结果 */
interface Track {
  first: number
  solvedAt: number | null
  attempts: number
  last: number | null
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export async function buildReport(
  target: { id: number; username: string; className: string | null },
  period: LearningPeriod,
  options: { neighbors: boolean },
): Promise<LearningReport> {
  const now = new Date()
  const start = periodStart(period, now)
  const members = target.className
    ? await db
        .select({ id: schema.user.id, username: schema.user.username })
        .from(schema.user)
        .where(and(eq(schema.user.className, target.className), eq(schema.user.isDisabled, false), inArray(schema.user.adminType, [...STUDENT_ROLES])))
        .orderBy(asc(schema.user.username))
    : []
  const memberIds = new Set(members.map((item) => item.id))
  const [rows, plans] = await Promise.all([
    activity([...new Set([target.id, ...memberIds])], start),
    target.className
      ? db
          .select({ day: schema.classLesson.day, problemIds: schema.classLesson.problemIds })
          .from(schema.classLesson)
          .where(and(eq(schema.classLesson.className, target.className), start ? gte(schema.classLesson.day, calendarDay(start)) : undefined))
      : [],
  ])

  // 每人每题的轨迹，和同班「某天某题」的人数、最早时刻（推断这节课、排题目顺序用）
  const tracks = new Map<number, Map<number, Track>>()
  const dayUsers = new Map<string, Set<number>>()
  const dayFirst = new Map<string, number>()
  const mine: Row[] = []
  for (const row of rows) {
    if (row.userId === target.id) mine.push(row)
    let byProblem = tracks.get(row.userId)
    if (!byProblem) tracks.set(row.userId, (byProblem = new Map()))
    let track = byProblem.get(row.problemId)
    if (!track) byProblem.set(row.problemId, (track = { first: row.time, solvedAt: null, attempts: 0, last: null }))
    if (track.solvedAt === null) {
      track.attempts += 1
      if (row.solved) track.solvedAt = row.time
      else if (row.result !== null) track.last = row.result
    }
    if (!memberIds.has(row.userId)) continue
    const key = `${calendarDay(row.time)}|${row.problemId}`
    let users = dayUsers.get(key)
    if (!users) dayUsers.set(key, (users = new Set()))
    users.add(row.userId)
    if (!dayFirst.has(key)) dayFirst.set(key, row.time)
  }
  const usersOn = (day: string, problemId: number) => dayUsers.get(`${day}|${problemId}`)?.size ?? 0

  // 一道题只归到一天：老师布置过的归布置的那天（布置了好几天就挑人最多的），
  // 否则在 ≥ 5 人的那些天里挑人最多的，打平取晚的
  const lessonDay = new Map<number, string>()
  const planOrder = new Map<string, number>()
  for (const plan of plans) {
    plan.problemIds.forEach((problemId, index) => {
      planOrder.set(`${plan.day}|${problemId}`, index)
      const current = lessonDay.get(problemId)
      if (!current || usersOn(plan.day, problemId) >= usersOn(current, problemId)) lessonDay.set(problemId, plan.day)
    })
  }
  const planned = new Set(lessonDay.keys())
  for (const [key, users] of dayUsers) {
    if (users.size < LESSON_MIN_USERS) continue
    const [day, id] = key.split('|') as [string, string]
    const problemId = Number(id)
    if (planned.has(problemId)) continue
    const current = lessonDay.get(problemId)
    if (!current || users.size > usersOn(current, problemId) || (users.size === usersOn(current, problemId) && day > current)) lessonDay.set(problemId, day)
  }

  const myTracks = tracks.get(target.id) ?? new Map<number, Track>()
  const problemIds = [...new Set([...lessonDay.keys(), ...myTracks.keys()])]
  const [problems, knowledgeTags, myTags] = await Promise.all([
    problemIds.length
      ? db
          .select({
            id: schema.problem.id,
            displayId: schema.problem.displayId,
            title: schema.problem.title,
            visible: schema.problem.visible,
            contestId: schema.problem.contestId,
          })
          .from(schema.problem)
          .where(inArray(schema.problem.id, problemIds))
      : [],
    db
      .select({ name: schema.problemTag.name, total: count() })
      .from(schema.problemTag)
      .innerJoin(schema.problemTags, eq(schema.problemTags.problemtagId, schema.problemTag.id))
      .innerJoin(schema.problem, eq(schema.problem.id, schema.problemTags.problemId))
      .where(and(eq(schema.problemTag.category, 'knowledge'), eq(schema.problem.visible, true), isNull(schema.problem.contestId)))
      .groupBy(schema.problemTag.name)
      .orderBy(desc(count()), asc(schema.problemTag.name)),
    myTracks.size
      ? db
          .select({ problemId: schema.problemTags.problemId, name: schema.problemTag.name })
          .from(schema.problemTags)
          .innerJoin(schema.problemTag, eq(schema.problemTags.problemtagId, schema.problemTag.id))
          .where(and(eq(schema.problemTag.category, 'knowledge'), inArray(schema.problemTags.problemId, [...myTracks.keys()])))
      : [],
  ])
  const problemById = new Map(problems.map((item) => [item.id, item]))
  // 被藏起来的题、比赛题不当「这节课的题」—— 学生点进去是 404
  for (const problemId of lessonDay.keys()) {
    const problem = problemById.get(problemId)
    if (!problem?.visible || problem.contestId !== null) lessonDay.delete(problemId)
  }

  function item(problemId: number): LearningItem {
    const problem = problemById.get(problemId)
    const track = myTracks.get(problemId)
    let rank: number | null = null
    let classSolved: number | null = null
    if (memberIds.size) {
      const solvedAt: [number, number][] = []
      for (const id of memberIds) {
        const at = tracks.get(id)?.get(problemId)?.solvedAt
        if (at != null) solvedAt.push([at, id])
      }
      solvedAt.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      classSolved = solvedAt.length
      const index = solvedAt.findIndex(([, id]) => id === target.id)
      rank = index >= 0 ? index + 1 : null
    }
    const status = !track ? 'none' : track.solvedAt === null ? 'fail' : track.attempts === 1 ? 'first' : 'tries'
    return {
      displayId: problem?.displayId ?? '',
      title: problem?.title ?? '',
      status,
      attempts: track?.attempts ?? 0,
      rank,
      classSolved,
      lastResult: track && track.solvedAt === null ? track.last : null,
    }
  }

  const byDay = new Map<string, { lesson: number[]; own: number[] }>()
  const slot = (day: string) => {
    let entry = byDay.get(day)
    if (!entry) byDay.set(day, (entry = { lesson: [], own: [] }))
    return entry
  }
  for (const [problemId, day] of lessonDay) slot(day).lesson.push(problemId)
  for (const [problemId, track] of myTracks) if (!lessonDay.has(problemId)) slot(calendarDay(track.first)).own.push(problemId)
  const order = (day: string, problemId: number) => planOrder.get(`${day}|${problemId}`) ?? 1e6 + (dayFirst.get(`${day}|${problemId}`) ?? 0) / 1e3
  const days: LearningDay[] = [...byDay]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, entry]) => ({
      day,
      lesson: entry.lesson.sort((a, b) => order(day, a) - order(day, b)).map(item),
      own: entry.own.sort((a, b) => myTracks.get(a)!.first - myTracks.get(b)!.first).map(item),
    }))

  const solvedIds = [...myTracks].filter(([, track]) => track.solvedAt !== null)
  const solved = solvedIds.length
  let classStats: LearningReport['classStats'] = null
  if (memberIds.size) {
    const counts: number[] = []
    const firstPercents: number[] = []
    for (const id of memberIds) {
      const byProblem = tracks.get(id)
      if (!byProblem) continue
      let done = 0
      let first = 0
      for (const track of byProblem.values()) {
        if (track.solvedAt === null) continue
        done += 1
        if (track.attempts === 1) first += 1
      }
      counts.push(done)
      if (done) firstPercents.push((first / done) * 100)
    }
    if (counts.length)
      classStats = {
        size: counts.length,
        medianSolved: median(counts),
        medianFirstPercent: Math.round(median(firstPercents)),
        rank: 1 + counts.filter((value) => value > solved).length,
      }
  }

  const errorCounts = new Map<number, number>()
  for (const row of mine) {
    if (row.solved || row.result === null || NOT_STUDENT_ERRORS.includes(row.result)) continue
    errorCounts.set(row.result, (errorCounts.get(row.result) ?? 0) + 1)
  }
  const tagCounts = new Map<string, { solved: number; tried: number }>()
  for (const tag of myTags) {
    const entry = tagCounts.get(tag.name) ?? { solved: 0, tried: 0 }
    entry.tried += 1
    if (myTracks.get(tag.problemId)?.solvedAt != null) entry.solved += 1
    tagCounts.set(tag.name, entry)
  }

  let neighbors: LearningReport['neighbors'] = null
  if (options.neighbors && members.length) {
    const index = members.findIndex((item) => item.id === target.id)
    if (index >= 0)
      neighbors = {
        prev: members[index - 1]?.username ?? null,
        next: members[index + 1]?.username ?? null,
      }
  }

  return {
    username: target.username,
    className: target.className,
    period,
    start,
    end: now.toISOString(),
    solved,
    firstTry: solvedIds.filter(([, track]) => track.attempts === 1).length,
    lessonCount: days.filter((day) => day.lesson.length).length,
    submissionCount: mine.length,
    unsolved: [...myTracks]
      .filter(([, track]) => track.solvedAt === null)
      .sort((a, b) => b[1].attempts - a[1].attempts)
      .map(([problemId]) => item(problemId)),
    classStats,
    days,
    errors: [...errorCounts].map(([result, value]) => ({ result, count: value })).sort((a, b) => b.count - a.count || a.result - b.result),
    knowledge: knowledgeTags.map((tag) => ({
      name: tag.name,
      ...(tagCounts.get(tag.name) ?? { solved: 0, tried: 0 }),
    })),
    neighbors,
  } satisfies LearningReport
}

import { MASCOT_SPOKEN_KINDS, mascotEventSchema, type MascotJournal, type MascotProfile } from '@oj2/contract'
import { and, count, countDistinct, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireAuth, type AppEnv } from '../auth/middleware'
import { db, schema } from '../db'
import { parseBody, success } from '../http'
import { JudgeStatus } from '../judge/status'
import { calendarDay, dayNumber, dayStart, localTime, weekStart } from '../time'

export const mascotRoutes = new Hono<AppEnv>()

/**
 * 每人每分钟最多记这么多条。正常点她一分钟到不了十条（连点只记开头、彩蛋和嫌烦那几下），
 * 拿脚本刷的才会撞上；撞上了就静默丢掉，不报错 —— 前台本来也不等这个结果
 */
const EVENTS_PER_MINUTE = 30
const windows = new Map<number, { start: number; count: number }>()

function allow(userId: number) {
  const now = Date.now()
  const entry = windows.get(userId)
  if (!entry || now - entry.start >= 60_000) {
    windows.set(userId, { start: now, count: 1 })
    // 顺手清掉过期的，免得 Map 跟着在线人数一直涨
    if (windows.size > 2000) for (const [id, it] of windows) if (now - it.start >= 60_000) windows.delete(id)
    return true
  }
  entry.count++
  return entry.count <= EVENTS_PER_MINUTE
}

/** 记一条看板娘互动（种类见契约 mascotEventSchema） */
mascotRoutes.post('/mascot/events', requireAuth, async (c) => {
  const parsed = await parseBody(c, mascotEventSchema, '看板娘记录的格式不对')
  if (!parsed.success) return parsed.response
  const user = c.get('user')!
  if (allow(user.id)) {
    const { kind, situation, line, action, path } = parsed.data
    await db.insert(schema.mascotEvent).values({ userId: user.id, kind, situation, line, action, path })
  }
  return success(c, null)
})

/** 跨天记得的事只翻这么多天以内的 */
const MEMORY_DAYS = 7

/** 几个东八区日历日以前；不在 MEMORY_DAYS 以内、或之后已经说过那句了，就是 null */
function daysAgo(at: string | null, saidAt: string | null) {
  // 按时刻比，别按字符串：库里出来的带微秒、位数不一定一样
  if (!at || (saidAt && Date.parse(saidAt) > Date.parse(at))) return null
  const days = dayNumber(calendarDay()) - dayNumber(calendarDay(at))
  return days >= 1 && days <= MEMORY_DAYS ? days : null
}

/** 跨天记得的事（契约 mascotProfileSchema.memory），一条语句查完 */
async function memoryOf(userId: number) {
  const today = dayStart()
  const since = new Date(Date.parse(today) - MEMORY_DAYS * 86_400_000).toISOString()
  const e = schema.mascotEvent
  /** 7 天内最后一次。`beforeToday`：今天的事不算「记得」，只取今天以前的 */
  const last = (kind: string, situation: string | null, beforeToday: boolean) => sql`(
    select max(${e.createdAt}) from ${e}
    where ${e.userId} = ${userId} and ${e.kind} = ${kind}
      ${situation ? sql`and ${e.situation} = ${situation}` : sql``}
      and ${e.createdAt} >= ${since}
      ${beforeToday ? sql`and ${e.createdAt} < ${today}` : sql``}
  )`
  const s = schema.submission
  const [row] = await db.execute<{
    sulk_at: string | null
    grudge_at: string | null
    pat_at: string | null
    pat_said_at: string | null
    closer_at: string | null
    solved_before: number
  }>(sql`
    select
      ${last('open', 'sulk', true)} as sulk_at,
      ${last('open', 'memory.grudge', false)} as grudge_at,
      ${last('pat', null, true)} as pat_at,
      ${last('open', 'memory.pat', false)} as pat_said_at,
      ${last('open', 'memory.closer', false)} as closer_at,
      (
        select count(distinct ${s.problemId})::int from ${s}
        where ${s.userId} = ${userId} and ${s.result} in (${JudgeStatus.ACCEPTED}, ${JudgeStatus.AST_CHECK_FAILED})
          and ${s.createTime} < ${today}
      ) as solved_before
  `)
  return {
    grudgeDaysAgo: daysAgo(row?.sulk_at ?? null, row?.grudge_at ?? null),
    patDaysAgo: daysAgo(row?.pat_at ?? null, row?.pat_said_at ?? null),
    solvedBeforeToday: row?.solved_before ?? 0,
    closerSaidToday: !!row?.closer_at && Date.parse(row.closer_at) >= Date.parse(today),
  }
}

/** 最近多少次题库提交拿来看学生常犯哪类错 */
const RECENT_SUBMISSIONS = 20

/** 看板娘按学生的行为挑话用的那几个数（契约 mascotProfileSchema） */
mascotRoutes.get('/mascot/profile', requireAuth, async (c) => {
  const userId = c.get('user')!.id
  const s = schema.submission

  const week = weekStart()
  const e = schema.mascotEvent
  const [pokes, solved, memory, today, recent, tooHard, weekSubmits, weekEvents, weekHints, answers] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.mascotEvent)
      .where(and(eq(schema.mascotEvent.userId, userId), eq(schema.mascotEvent.kind, 'open'))),
    // 成就每次判完都重数一遍存进 user_stat，直接读，不再按提交现数
    db
      .select({ value: sql<number>`coalesce((${schema.userStat.metrics}->>'accepted_count')::int, 0)` })
      .from(schema.userStat)
      .where(eq(schema.userStat.userId, userId)),
    memoryOf(userId),
    db
      .select({ value: countDistinct(s.problemId) })
      .from(s)
      .where(and(eq(s.userId, userId), eq(s.result, 0), gte(s.createTime, dayStart()))),
    db
      .select({ result: s.result, errorType: sql<string | null>`${s.statisticInfo}->'runtime_error'->>'type'` })
      .from(s)
      .where(and(eq(s.userId, userId), isNull(s.contestId)))
      .orderBy(desc(s.createTime))
      .limit(RECENT_SUBMISSIONS),
    db
      .select({ value: count() })
      .from(schema.reaction)
      .where(and(eq(schema.reaction.userId, userId), eq(schema.reaction.type, 'too_hard'))),
    db
      .select({ value: count() })
      .from(s)
      .where(and(eq(s.userId, userId), isNull(s.contestId), gte(s.createTime, week))),
    db
      .select({ kind: e.kind, value: count() })
      .from(e)
      .where(and(eq(e.userId, userId), inArray(e.kind, ['trial', 'help']), gte(e.createdAt, week)))
      .groupBy(e.kind),
    db
      .select({ value: count() })
      .from(schema.aiHint)
      .innerJoin(s, eq(s.id, schema.aiHint.submissionId))
      .where(and(eq(s.userId, userId), gte(schema.aiHint.createTime, week))),
    // 闲聊时问过的问题：每题取最后一次的回答
    db
      .selectDistinctOn([e.situation], { situation: e.situation, action: e.action })
      .from(e)
      .where(and(eq(e.userId, userId), eq(e.kind, 'answer')))
      .orderBy(e.situation, desc(e.createdAt)),
  ])
  const eventCount = (kind: string) => weekEvents.find((row) => row.kind === kind)?.value ?? 0

  const types = new Map<string, number>()
  for (const row of recent) if (row.result === 4 && row.errorType) types.set(row.errorType, (types.get(row.errorType) ?? 0) + 1)
  const topType = [...types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const tally = (...results: number[]) => recent.filter((row) => results.includes(row.result)).length

  return success(c, {
    pokes: pokes[0]?.value ?? 0,
    solved: solved[0]?.value ?? 0,
    memory,
    todaySolved: today[0]?.value ?? 0,
    tooHard: tooHard[0]?.value ?? 0,
    answers: Object.fromEntries(answers.filter((row) => row.situation?.startsWith('ask.') && row.action).map((row) => [row.situation!.slice(4), row.action!])),
    week: {
      submits: weekSubmits[0]?.value ?? 0,
      trials: eventCount('trial'),
      helps: eventCount('help'),
      aiHints: weekHints[0]?.value ?? 0,
    },
    recent: {
      total: recent.length,
      wrongAnswer: tally(-1),
      compileError: tally(-2),
      runtimeError: tally(4, 3),
      timeout: tally(1, 2),
      runtimeErrorType: topType,
    },
  } satisfies MascotProfile)
})

/** 和她的相处记录（契约 mascotJournalSchema）：主页那张卡和点开的那一页 */
mascotRoutes.get('/mascot/journal', requireAuth, async (c) => {
  const userId = c.get('user')!.id
  const e = schema.mascotEvent
  // 「碰她」只算对她做的事，跑例子、举手不算
  const touched = inArray(e.kind, ['open', 'action', 'pat', 'overclick', 'move', 'play', 'answer'])
  const mine = eq(e.userId, userId)
  const hour = sql<number>`extract(hour from ${localTime(e.createdAt)})::int`
  const page = sql<string>`split_part(${e.path}, '/', 2)`
  const [summary, hours, pages, lines] = await Promise.all([
    db
      .select({
        firstAt: sql<string | null>`min(${e.createdAt})`,
        days: sql<number>`count(distinct (${localTime(e.createdAt)})::date)::int`,
        opens: sql<number>`(count(*) filter (where ${e.kind} = 'open'))::int`,
        actions: sql<number>`(count(*) filter (where ${e.kind} = 'action'))::int`,
        pats: sql<number>`(count(*) filter (where ${e.kind} = 'pat'))::int`,
        sulks: sql<number>`(count(*) filter (where ${e.kind} = 'open' and ${e.situation} = 'sulk'))::int`,
        moves: sql<number>`(count(*) filter (where ${e.kind} = 'move'))::int`,
        peeks: sql<number>`(count(*) filter (where ${e.kind} = 'move' and ${e.line} like 'peek %'))::int`,
        flings: sql<number>`(count(*) filter (where ${e.kind} = 'play' and ${e.action} = 'fling'))::int`,
        shakes: sql<number>`(count(*) filter (where ${e.kind} = 'play' and ${e.action} = 'shake'))::int`,
        tickles: sql<number>`(count(*) filter (where ${e.kind} = 'play' and ${e.action} = 'tickle'))::int`,
        spoken: sql<number>`(count(*) filter (where ${e.kind} = 'speak'))::int`,
      })
      .from(e)
      .where(and(mine, inArray(e.kind, ['open', 'action', 'pat', 'overclick', 'move', 'play', 'answer', 'speak']))),
    db.select({ hour, value: count() }).from(e).where(and(mine, touched)).groupBy(hour),
    db.select({ page, value: count() }).from(e).where(and(mine, touched)).groupBy(page).orderBy(desc(count())).limit(1),
    db
      .select({ line: e.line })
      .from(e)
      .where(and(mine, inArray(e.kind, [...MASCOT_SPOKEN_KINDS]), sql`${e.line} is not null`))
      .groupBy(e.line)
      .orderBy(desc(sql`max(${e.createdAt})`)),
  ])
  // 没有 group by 的聚合永远回一行，碰都没碰过也是一行（count 是 0、min 是 null）
  const { firstAt, days, ...counts } = summary[0]!
  const byHour = Array.from({ length: 24 }, () => 0)
  for (const it of hours) byHour[it.hour] = it.value
  return success(c, {
    firstAt,
    days,
    counts,
    byHour,
    favoritePage: pages[0]?.page || null,
    lines: lines.map((it) => it.line!),
  } satisfies MascotJournal)
})

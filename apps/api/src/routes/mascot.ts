import {
  MASCOT_DAILY_BONUS,
  MASCOT_FISH_GIFT,
  MASCOT_FISH_SINCE,
  MASCOT_OUTFIT_COST,
  MASCOT_OUTFIT_NONE,
  MASCOT_OUTFITS,
  MASCOT_SPOKEN_KINDS,
  mascotEventSchema,
  type MascotEventKind,
  type MascotJournal,
  type MascotProfile,
  type MascotVisit,
} from '@oj2/contract'
import { and, count, countDistinct, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireAuth, type AppEnv } from '../auth/middleware'
import { db, schema } from '../db'
import { failure, parseBody, success } from '../http'
import { isTeacherOrAbove } from './helpers'
import { JudgeStatus } from '../judge/status'
import { calendarDay, dayNumber, dayStart, localDateTime, localTime, weekStart } from '../time'

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
    // 换衣服花的是小鱼干：衣服得在单子上、鱼得够，不然不记（前台本来就不让点，这里防脚本）
    if (kind === 'dress' && !(await canDress(user.id, action))) return success(c, null)
    // 每天挑的题只有后端记（dailyOf），前台发来的不收：它决定多给几条小鱼干
    if (kind === 'daily') return success(c, null)
    await db.insert(schema.mascotEvent).values({ userId: user.id, kind, situation, line, action, path })
  }
  return success(c, null)
})

async function canDress(userId: number, outfit: string | undefined) {
  if (outfit === MASCOT_OUTFIT_NONE) return true
  if (!outfit || !(MASCOT_OUTFITS as readonly string[]).includes(outfit)) return false
  const fish = await fishOf(userId)
  return MASCOT_FISH_GIFT + fish.earned - fish.fed - fish.spent >= MASCOT_OUTFIT_COST
}

/** 算「来找过她」的事：对她做的，不含跑例子、举手、后端自己记的 */
const TOUCH_KINDS = ['open', 'action', 'pat', 'overclick', 'move', 'play', 'answer', 'feed', 'dress'] as const satisfies readonly MascotEventKind[]

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
    streak_at: string | null
    solved_before: number
  }>(sql`
    select
      ${last('open', 'sulk', true)} as sulk_at,
      ${last('open', 'memory.grudge', false)} as grudge_at,
      ${last('pat', null, true)} as pat_at,
      ${last('open', 'memory.pat', false)} as pat_said_at,
      ${last('open', 'memory.closer', false)} as closer_at,
      ${last('open', 'memory.streak', false)} as streak_at,
      (
        select count(distinct ${s.problemId})::int from ${s}
        where ${s.userId} = ${userId} and ${s.result} in (${JudgeStatus.ACCEPTED}, ${JudgeStatus.AST_CHECK_FAILED})
          and ${s.createTime} < ${today}
      ) as solved_before
  `)
  // 连着几天来找她：今天以前连着的天数 + 今天这一天（这会儿正在找她）
  const days = await db
    .selectDistinct({ day: sql<string>`(${localTime(e.createdAt)})::date::text` })
    .from(e)
    .where(
      and(
        eq(e.userId, userId),
        inArray(e.kind, [...TOUCH_KINDS]),
        gte(e.createdAt, new Date(Date.parse(today) - 60 * 86_400_000).toISOString()),
        sql`${e.createdAt} < ${today}`,
      ),
    )
  const visited = new Set(days.map((it) => dayNumber(it.day)))
  let streak = 1
  for (let day = dayNumber(calendarDay()) - 1; visited.has(day); day--) streak++
  return {
    streakDays: streak,
    streakSaidToday: !!row?.streak_at && Date.parse(row.streak_at) >= Date.parse(today),
    grudgeDaysAgo: daysAgo(row?.sulk_at ?? null, row?.grudge_at ?? null),
    patDaysAgo: daysAgo(row?.pat_at ?? null, row?.pat_said_at ?? null),
    solvedBeforeToday: row?.solved_before ?? 0,
    closerSaidToday: !!row?.closer_at && Date.parse(row.closer_at) >= Date.parse(today),
  }
}

/** 小鱼干（契约 mascotProfileSchema.fish）：MASCOT_FISH_SINCE 以后第一次做对的题各一条，喂掉的按 feed 事件数 */
async function fishOf(userId: number) {
  const s = schema.submission
  const e = schema.mascotEvent
  const since = localDateTime(MASCOT_FISH_SINCE, '00:00')
  const [row] = await db.execute<{ earned: number; fed: number; spent: number }>(sql`
    select
      (
        select count(*)::int from (
          select ${s.problemId} from ${s}
          where ${s.userId} = ${userId} and ${s.result} in (${JudgeStatus.ACCEPTED}, ${JudgeStatus.AST_CHECK_FAILED})
          group by ${s.problemId}
          having min(${s.createTime}) >= ${since}
        ) first_solved
      ) + ${MASCOT_DAILY_BONUS} * (
        -- 她每天挑的题（一天取最早记的那条），当天做对了的天数
        select count(*)::int from (
          select distinct on ((${localTime(e.createdAt)})::date) ${e.action} as problem, (${localTime(e.createdAt)})::date as day
          from ${e} where ${e.userId} = ${userId} and ${e.kind} = 'daily'
          order by (${localTime(e.createdAt)})::date, ${e.createdAt}
        ) d
        where exists (
          select 1 from ${s}
          where ${s.userId} = ${userId} and ${s.problemId} = d.problem::int
            and ${s.result} in (${JudgeStatus.ACCEPTED}, ${JudgeStatus.AST_CHECK_FAILED})
            and (${localTime(s.createTime)})::date = d.day
        )
      ) as earned,
      (select count(*)::int from ${e} where ${e.userId} = ${userId} and ${e.kind} = 'feed') as fed,
      (
        select count(*)::int * ${MASCOT_OUTFIT_COST} from ${e}
        where ${e.userId} = ${userId} and ${e.kind} = 'dress' and ${e.action} <> ${MASCOT_OUTFIT_NONE}
      ) as spent
  `)
  return { earned: row?.earned ?? 0, fed: row?.fed ?? 0, spent: row?.spent ?? 0 }
}

/** 她今天穿的衣服：今天（东八区）最后一次 dress，换回来了（none）就是 null */
async function outfitOf(userId: number) {
  const e = schema.mascotEvent
  const [row] = await db
    .select({ outfit: e.action })
    .from(e)
    .where(and(eq(e.userId, userId), eq(e.kind, 'dress'), gte(e.createdAt, dayStart())))
    .orderBy(desc(e.createdAt))
    .limit(1)
  return row?.outfit && row.outfit !== MASCOT_OUTFIT_NONE ? row.outfit : null
}

/**
 * 她今天给挑的题：今天第一次问到时挑一道记下（daily 事件），之后都是这道。挑的是公开的、不是比赛的、
 * 难度不是「难」、能用 Python 或 C 写、这个学生没做对过的题，随机一道；都做完了就是 null
 */
async function dailyOf(userId: number) {
  const e = schema.mascotEvent
  const s = schema.submission
  const p = schema.problem
  const today = dayStart()
  const accepted = inArray(s.result, [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED])
  const [picked] = await db
    .select({ action: e.action })
    .from(e)
    .where(and(eq(e.userId, userId), eq(e.kind, 'daily'), gte(e.createdAt, today)))
    .orderBy(e.createdAt)
    .limit(1)
  let id = picked?.action ? Number(picked.action) : null
  if (!id) {
    const [row] = await db
      .select({ id: p.id })
      .from(p)
      .where(
        and(
          eq(p.visible, true),
          isNull(p.contestId),
          sql`${p.difficulty} <> 'High'`,
          sql`${p.languages} ?| array['Python', 'C', 'C++']`,
          sql`not exists (select 1 from ${s} where ${s.userId} = ${userId} and ${s.problemId} = ${p.id} and ${accepted})`,
        ),
      )
      .orderBy(sql`random()`)
      .limit(1)
    if (!row) return null
    id = row.id
    await db.insert(e).values({ userId, kind: 'daily', action: String(id), path: '/' })
  }
  const [[problem], [done]] = await Promise.all([
    db.select({ displayId: p.displayId }).from(p).where(eq(p.id, id)).limit(1),
    db
      .select({ id: s.id })
      .from(s)
      .where(and(eq(s.userId, userId), eq(s.problemId, id), accepted, gte(s.createTime, today)))
      .limit(1),
  ])
  return problem ? { problemId: problem.displayId, done: !!done } : null
}

/** 见过她哪些样子：pose 事件的姿势名，去重 */
async function posesOf(userId: number) {
  const e = schema.mascotEvent
  const rows = await db
    .selectDistinct({ pose: e.action })
    .from(e)
    .where(and(eq(e.userId, userId), eq(e.kind, 'pose'), sql`${e.action} is not null`))
  return rows.map((row) => row.pose!)
}

/** 最近多少次题库提交拿来看学生常犯哪类错 */
const RECENT_SUBMISSIONS = 20

/** 看板娘按学生的行为挑话用的那几个数（契约 mascotProfileSchema） */
mascotRoutes.get('/mascot/profile', requireAuth, async (c) => {
  const userId = c.get('user')!.id
  const s = schema.submission

  const week = weekStart()
  const e = schema.mascotEvent
  const [pokes, solved, memory, today, recent, tooHard, weekSubmits, weekEvents, weekHints, answers, fish, poses, outfit, daily] = await Promise.all([
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
    fishOf(userId),
    posesOf(userId),
    outfitOf(userId),
    dailyOf(userId),
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
    fish,
    daily,
    outfit,
    poses,
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

/** 她指出过的代码错误（契约 mascotMistakesSchema）：说出口的次数，多的在前 */
async function mistakesOf(userId: number) {
  const e = schema.mascotEvent
  return db
    .select({ situation: sql<string>`${e.situation}`, count: count() })
    .from(e)
    .where(and(eq(e.userId, userId), inArray(e.kind, ['speak', 'open']), sql`(${e.situation} like 'lint.%' or ${e.situation} like 'problem.chinesePunct%')`))
    .groupBy(e.situation)
    .orderBy(desc(count()))
}

/** 回忆（契约 mascotJournalSchema.moments）：几件「第一次」和喂到第 10 条的时刻 */
async function momentsOf(userId: number) {
  const e = schema.mascotEvent
  const first = (where: ReturnType<typeof sql>) => sql<string | null>`min(${e.createdAt}) filter (where ${where})`
  const [[row], [tenth]] = await Promise.all([
    db
      .select({
        first: first(sql`${e.kind} in ('open', 'pat', 'move', 'play', 'feed', 'dress')`),
        sulk: first(sql`${e.kind} = 'open' and ${e.situation} = 'sulk'`),
        pat: first(sql`${e.kind} = 'pat'`),
        feed: first(sql`${e.kind} = 'feed'`),
        dress: first(sql`${e.kind} = 'dress' and ${e.action} <> ${MASCOT_OUTFIT_NONE}`),
        fling: first(sql`${e.kind} = 'play' and ${e.action} = 'fling'`),
        tickle: first(sql`${e.kind} = 'play' and ${e.action} = 'tickle'`),
        answer: first(sql`${e.kind} = 'answer'`),
      })
      .from(e)
      .where(eq(e.userId, userId)),
    db
      .select({ at: e.createdAt })
      .from(e)
      .where(and(eq(e.userId, userId), eq(e.kind, 'feed')))
      .orderBy(e.createdAt)
      .offset(9)
      .limit(1),
  ])
  const moments = Object.entries({ ...row, feed10: tenth?.at ?? null }).flatMap(([kind, at]) => (at ? [{ kind, at }] : []))
  return moments.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** 和她的相处记录（契约 mascotJournalSchema）：主页那张卡和点开的那一页 */
mascotRoutes.get('/mascot/journal', requireAuth, async (c) => {
  const userId = c.get('user')!.id
  const e = schema.mascotEvent
  // 「碰她」只算对她做的事，跑例子、举手不算
  const touched = inArray(e.kind, ['open', 'action', 'pat', 'overclick', 'move', 'play', 'answer', 'feed', 'dress'])
  const mine = eq(e.userId, userId)
  const hour = sql<number>`extract(hour from ${localTime(e.createdAt)})::int`
  const page = sql<string>`split_part(${e.path}, '/', 2)`
  const [summary, hours, pages, lines, poses, mistakes, moments] = await Promise.all([
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
        feeds: sql<number>`(count(*) filter (where ${e.kind} = 'feed'))::int`,
        dresses: sql<number>`(count(*) filter (where ${e.kind} = 'dress' and ${e.action} <> ${MASCOT_OUTFIT_NONE}))::int`,
        tickles: sql<number>`(count(*) filter (where ${e.kind} = 'play' and ${e.action} = 'tickle'))::int`,
        spoken: sql<number>`(count(*) filter (where ${e.kind} = 'speak'))::int`,
      })
      .from(e)
      .where(and(mine, inArray(e.kind, ['open', 'action', 'pat', 'overclick', 'move', 'play', 'answer', 'feed', 'dress', 'speak']))),
    db.select({ hour, value: count() }).from(e).where(and(mine, touched)).groupBy(hour),
    db.select({ page, value: count() }).from(e).where(and(mine, touched)).groupBy(page).orderBy(desc(count())).limit(1),
    db
      .select({ line: e.line })
      .from(e)
      .where(and(mine, inArray(e.kind, [...MASCOT_SPOKEN_KINDS]), sql`${e.line} is not null`))
      .groupBy(e.line)
      .orderBy(desc(sql`max(${e.createdAt})`)),
    posesOf(userId),
    mistakesOf(userId),
    momentsOf(userId),
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
    poses,
    mistakes,
    moments,
  } satisfies MascotJournal)
})

/** 串门：同学的小鲸鱼今天穿着什么（契约 mascotVisitSchema） */
mascotRoutes.get('/mascot/of/:username', requireAuth, async (c) => {
  const [target] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(sql`lower(${schema.user.username}) = lower(${c.req.param('username')})`, eq(schema.user.isDisabled, false)))
    .limit(1)
  if (!target) return failure(c, 404, 'user-not-found', '没有这个用户')
  const e = schema.mascotEvent
  // 指出过的错只给老师看：同学之间不给
  const teacher = isTeacherOrAbove(c.get('user')!)
  const [first, outfit, poses, mistakes] = await Promise.all([
    db
      .select({ at: sql<string | null>`min(${e.createdAt})` })
      .from(e)
      .where(and(eq(e.userId, target.id), inArray(e.kind, ['open', 'pat', 'move', 'play', 'feed', 'dress']))),
    outfitOf(target.id),
    posesOf(target.id),
    teacher ? mistakesOf(target.id) : null,
  ])
  return success(c, { firstAt: first[0]?.at ?? null, outfit, poses: poses.length, mistakes } satisfies MascotVisit)
})

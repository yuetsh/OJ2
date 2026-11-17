import { mascotFestival } from '@oj2/contract'
import { and, eq, inArray, like, sql } from 'drizzle-orm'

import { db, schema } from '../db'
import { publishAchievementNotification } from '../events'
import { JudgeStatus } from '../judge/status'
import { localTime } from '../time'
import { unlockAchievements } from './achievements'

/**
 * 「小鲸鱼」那一组成就（0047）：指标全从 mascot_event 现数，键都以 `mascot_` 开头。
 *
 * 和别的成就不一样的地方：
 * - **不算进「奖杯收藏家」**（已解锁数只数别的），不然光玩她就能凑出白金。凡是数「已解锁几个」的地方都用
 *   achievements.ts 的 countsTowardCollector 排掉它们。
 * - 结算不在判题时，在她的互动记下来以后（routes/mascot.ts，同一个人几秒内的合成一次）；
 *   只有「她点的菜」（她挑的题当天做对）要等判题，判完做对了也结算一次。
 *
 * 数法尽量和主页「相处记录」、小鱼干同一个口径（routes/mascot.ts 的 fishOf / journal），改一边记得看另一边。
 * 0047 迁移里有一份同样口径的 SQL 给存量补发，那份是当时的快照，不用跟着改。
 */
export const MASCOT_METRIC_PREFIX = 'mascot_'

export function isMascotMetric(metric: string) {
  return metric.startsWith(MASCOT_METRIC_PREFIX)
}

/** 几种说的是同一种错，合成一种数（和前台 shared/mascot/mistakes.ts 的 NAMES 合并的一致） */
const MISTAKE_ALIASES: Record<string, string> = {
  'problem.chinesePuncts': 'problem.chinesePunct',
  'lint.wrongLangPython': 'lint.wrongLangC',
  'lint.undefinedNameGuess': 'lint.undefinedName',
  'lint.extraBracket': 'lint.unclosedBracket',
}

const ACCEPTED = sql.join([sql`${JudgeStatus.ACCEPTED}`, sql`${JudgeStatus.AST_CHECK_FAILED}`], sql`, `)

/**
 * 按 mascot_event 数出这些人的「小鲸鱼」指标。不传 `userIds` 就是全体碰过她的人（后台重扫用）。
 * 没碰过她的人不在结果里。
 */
async function mascotMetricsOf(userIds?: number[]) {
  if (userIds && userIds.length === 0) return new Map<number, Record<string, number>>()
  const e = schema.mascotEvent
  const s = schema.submission
  const scope = userIds ? sql`where ${e.userId} in ${userIds}` : sql``
  const aliasCase = sql.join(
    Object.entries(MISTAKE_ALIASES).map(([from, to]) => sql`when ${from} then ${to}`),
    sql` `,
  )
  // 下面都是从 CTE（mine）里取，列名不能带表名
  const day = sql`(${localTime(sql`created_at`)})::date`
  const rows = await db.execute<Record<string, number> & { user_id: number }>(sql`
    with mine as (select * from ${e} ${scope}),
    daily as (
      -- 她每天挑的题（一天取最早记的那条）当天做对了的天数，和 fishOf 一个口径
      select d.user_id, count(*)::int as n from (
        select distinct on (user_id, ${day}) user_id, action::int as problem, ${day} as day
        from mine where kind = 'daily'
        order by user_id, ${day}, created_at
      ) d
      where exists (
        select 1 from ${s}
        where ${s.userId} = d.user_id and ${s.problemId} = d.problem and ${s.result} in (${ACCEPTED})
          and (${localTime(s.createTime)})::date = d.day
      )
      group by d.user_id
    )
    select m.user_id,
      count(distinct ${day}) filter (where kind in ('open', 'action', 'pat', 'overclick', 'move', 'play', 'answer', 'feed', 'dress'))::int as mascot_days,
      (count(*) filter (where kind = 'feed'))::int as mascot_fed,
      coalesce(max(daily.n), 0)::int as mascot_daily,
      count(distinct action) filter (where kind = 'pose')::int as mascot_poses,
      count(distinct line) filter (where kind in ('open', 'speak', 'pat', 'overclick', 'play', 'feed'))::int as mascot_lines,
      count(distinct action) filter (where kind = 'dress' and action <> 'none')::int as mascot_outfits,
      count(distinct situation) filter (where kind = 'answer' and situation like 'ask.%')::int as mascot_answers,
      count(distinct case situation ${aliasCase} else situation end)
        filter (where kind in ('speak', 'open') and (situation like 'lint.%' or situation like 'problem.chinesePunct%'))::int as mascot_mistakes,
      (count(*) filter (where kind = 'open' and situation = 'sulk'))::int as mascot_sulk,
      (count(*) filter (where kind = 'pat' and situation = 'sulk.forgive'))::int as mascot_forgive_pat,
      (count(*) filter (where kind = 'feed' and situation = 'feed.forgive'))::int as mascot_forgive_fish,
      (count(*) filter (where kind = 'open' and situation = 'wake'))::int as mascot_wake,
      (count(*) filter (where kind = 'feed' and situation = 'feed.wake'))::int as mascot_feed_wake,
      (count(*) filter (where kind = 'open' and situation = 'peek.found'))::int as mascot_peek_found,
      (count(*) filter (where kind = 'play' and action = 'fling'))::int as mascot_fling,
      (count(*) filter (where kind = 'play' and action = 'shake'))::int as mascot_shake,
      (count(*) filter (where kind = 'play' and action = 'tickle'))::int as mascot_tickle,
      (count(*) filter (where kind = 'pose' and action = 'tail-grabbed'))::int as mascot_tail,
      (count(*) filter (where kind = 'open' and situation = 'feed.full'))::int as mascot_full,
      (count(*) filter (where kind = 'overclick'))::int as mascot_overclick
    from mine m
    left join daily on daily.user_id = m.user_id
    group by m.user_id
  `)
  const result = new Map<number, Record<string, number>>()
  for (const { user_id, ...metrics } of rows) result.set(user_id, { ...metrics, mascot_festival: 0 })

  // 节日当天给她穿上那天的节日装：哪天是什么节日在契约里（农历节日查表），SQL 里不好写，拿出来对
  const festive = await db
    .select({ userId: e.userId, outfit: e.action, at: e.createdAt })
    .from(e)
    .where(and(eq(e.kind, 'dress'), like(e.action, 'festival-%'), userIds ? inArray(e.userId, userIds) : undefined))
  for (const row of festive) {
    const metrics = result.get(row.userId)
    if (metrics && mascotFestival(Date.parse(row.at)) === row.outfit) metrics.mascot_festival = (metrics.mascot_festival ?? 0) + 1
  }
  return result
}

/** 一条 upsert 塞多少人，3 个参数一行 */
const STAT_UPSERT_CHUNK = 1000

/**
 * 把算好的指标并进 user_stat。jsonb 浅合并（`||`）只盖这几个键，并发判题写的别的指标不受影响，
 * 和 refreshContestJoinedForAll 一个写法。返回合并后的整份 metrics。
 */
async function mergeMetrics(byUser: Map<number, Record<string, number>>) {
  const entries = [...byUser]
  const now = new Date().toISOString()
  const merged = new Map<number, Record<string, unknown>>()
  for (let start = 0; start < entries.length; start += STAT_UPSERT_CHUNK) {
    const chunk = entries.slice(start, start + STAT_UPSERT_CHUNK)
    const rows = await db
      .insert(schema.userStat)
      .values(chunk.map(([userId, metrics]) => ({ userId, metrics, updateTime: now })))
      .onConflictDoUpdate({
        target: schema.userStat.userId,
        set: {
          metrics: sql`${schema.userStat.metrics} || excluded.metrics`,
          updateTime: sql`excluded.update_time`,
        },
      })
      .returning({ userId: schema.userStat.userId, metrics: schema.userStat.metrics })
    for (const row of rows) merged.set(row.userId, row.metrics as Record<string, unknown>)
  }
  return merged
}

/** 重扫「小鲸鱼」成就之前把全体的指标刷一遍（rescanAchievement 调） */
export async function refreshMascotMetricsForAll() {
  await mergeMetrics(await mascotMetricsOf())
}

/** 重算一个人的「小鲸鱼」指标，解锁达标的，返回这次新解锁的（不推通知，调用方推） */
export async function settleMascotAchievements(userId: number) {
  const byUser = await mascotMetricsOf([userId])
  if (!byUser.size) return []
  const metrics = (await mergeMetrics(byUser)).get(userId)
  if (!metrics) return []
  const unlocked = await unlockAchievements(userId, metrics)
  // 别的成就的指标也在 metrics 里，正常不会在这里命中（判题时已经结算过）；万一命中了也照发，不碍事
  return unlocked
}

/** 同一个人的互动几秒内合成一次结算：点她、拖她一下就是好几条记录 */
const SETTLE_DELAY_MS = 3000
const pending = new Map<number, ReturnType<typeof setTimeout>>()

/** 记下一条互动以后调。不等结算完，出错只打日志：成就晚一点到不要紧，别让记录接口报错 */
export function scheduleMascotSettle(userId: number) {
  if (pending.has(userId)) return
  pending.set(
    userId,
    setTimeout(() => {
      pending.delete(userId)
      settleMascotAchievements(userId)
        .then((unlocked) =>
          publishAchievementNotification(
            userId,
            unlocked.map((achievement) => ({
              id: achievement.id,
              name: achievement.name,
              description: achievement.description,
              icon: achievement.icon,
              rarity: achievement.rarity,
              metric: achievement.metric,
              kind: 'achievement',
            })),
          ),
        )
        .catch((error: unknown) => console.error(`[mascot] 成就结算失败 user=${userId}:`, error))
    }, SETTLE_DELAY_MS),
  )
}

import {
  rankHiddenRequestSchema,
  rankPeriodSchema,
  rankScopeSchema,
  STUDENT_ROLES,
  type ClassBattleItem,
  type RankBoard,
  type RankPeriod,
  type RankRow,
  type RankScope,
  type SampleUser,
  type WeeklyChampion,
} from "@oj2/contract"
import {
  and,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  min,
  ne,
  type SQL,
} from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireTeacher, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, parseBody, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { dayStart, termStart, weekStart } from "../time"
import { isTeacherOrAbove, rounded, sampleUser } from "./helpers"

/**
 * 排名页（设计稿「排名重设计」G1–G3）。口径见契约 `ranking.ts` 的注释：
 * 做对多的在前，一样多的先做到的在前；「做对」= 这道题第一次做对落在这段时间里。
 */
export const rankingRoutes = new Hono<AppEnv>()

/** AST_CHECK_FAILED 也是答案对了，与周榜、课堂条同口径 */
const SOLVED_RESULTS = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

/** 本年级 / 全服的榜面：前面这么多人 + 我附近一段，中间折起来 */
const BOARD_HEAD = 16
/** 我附近一段：前面 5 个、后面 7 个（前面的人是要追的，多给后面几个看「谁在追我」） */
const WINDOW_BEFORE = 5
const WINDOW_AFTER = 7
/** 没有「我」（老师、没上榜）时榜面给多少 */
const BOARD_HEAD_NO_ME = 30
/** 走势图往回看几周 */
const TREND_WEEKS = 4
/** 每周冠军列几周 */
const CHAMPION_WEEKS = 3

const WEEK_MS = 7 * 86_400_000

/** 入榜人群：正常状态的学生与学生管理员，老师设成不计入排名的不算 */
const rankedStudents = and(
  inArray(schema.user.adminType, [...STUDENT_ROLES]),
  eq(schema.user.isDisabled, false),
  isNull(schema.user.rankHiddenAt),
)!

interface Entrant {
  id: number
  username: string
  className: string | null
  avatar: string | null
  /** 每道题第一次做对的时刻，升序；毫秒数用来比较，原文留着给出参 */
  times: number[]
  stamps: string[]
}

interface Standing {
  entrant: Entrant
  rank: number
  solved: number
  reachedAt: string | null
}

function audienceWhere(scope: RankScope, className: string | null) {
  if (scope === "class") return and(rankedStudents, eq(schema.user.className, className!))!
  if (scope === "grade") return and(rankedStudents, like(schema.user.className, `${className}%`))!
  return rankedStudents
}

function avatarOf(avatar: string | null) {
  return !avatar || avatar.endsWith("/default.png") ? null : avatar
}

/**
 * 这群人、从 `since` 起每道题第一次做对的时刻。
 *
 * 先按 (人, 题) 取全部历史里的最早一次，再用 having 卡 `>= since` —— 这样「这学期」数的是
 * 这学期**第一次**做对的题，以前做对过的老题这学期重交一遍不算。比赛里的提交不算。
 * 走 `submission_public_metrics_idx`（user_id, problem_id, result, create_time，WHERE
 * contest_id IS NULL），全服全部历史实测 24ms。
 */
async function loadEntrants(where: SQL, since: string | null): Promise<Entrant[]> {
  const firstSolved = min(schema.submission.createTime)
  const [people, solves] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        className: schema.user.className,
        avatar: schema.userProfile.avatar,
      })
      .from(schema.user)
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(where),
    db
      .select({ userId: schema.submission.userId, at: firstSolved })
      .from(schema.submission)
      .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
      .where(
        and(
          where,
          isNull(schema.submission.contestId),
          inArray(schema.submission.result, SOLVED_RESULTS),
        ),
      )
      .groupBy(schema.submission.userId, schema.submission.problemId)
      .having(since ? gte(firstSolved, since) : undefined),
  ])

  const byUser = new Map<number, string[]>()
  for (const row of solves) {
    if (!row.at) continue
    const list = byUser.get(row.userId)
    if (list) list.push(row.at)
    else byUser.set(row.userId, [row.at])
  }
  return people.map((person) => {
    const pairs = (byUser.get(person.id) ?? [])
      .map((stamp) => [Date.parse(stamp), stamp] as const)
      .sort((a, b) => a[0] - b[0])
    return {
      id: person.id,
      username: person.username,
      className: person.className,
      avatar: avatarOf(person.avatar),
      times: pairs.map(([time]) => time),
      stamps: pairs.map(([, stamp]) => stamp),
    }
  })
}

/**
 * `cutoff` 那一刻的名次（不给就是现在）。一样多的先做到的在前，再一样按 id ——
 * 第三档不是凑数：同一秒做到的确实有（一节课的最后一道），没有稳定的兜底键名次会跳。
 * `includeZero`：本班把一道没做对的也排上（全班名单），本年级 / 全服不排。
 */
function standings(entrants: Entrant[], cutoff: number | null, includeZero: boolean) {
  const list = entrants
    .map((entrant) => {
      let solved = entrant.times.length
      if (cutoff !== null) {
        solved = 0
        while (solved < entrant.times.length && entrant.times[solved]! < cutoff) solved++
      }
      return {
        entrant,
        solved,
        reached: solved ? entrant.times[solved - 1]! : Number.POSITIVE_INFINITY,
        reachedAt: solved ? entrant.stamps[solved - 1]! : null,
      }
    })
    .filter((row) => includeZero || row.solved > 0)
    .sort((a, b) => b.solved - a.solved || a.reached - b.reached || a.entrant.id - b.entrant.id)
  return list.map((row, index): Standing => ({
    entrant: row.entrant,
    rank: index + 1,
    solved: row.solved,
    reachedAt: row.reachedAt,
  }))
}

function toRow(standing: Standing, change: number | null): RankRow {
  const { entrant } = standing
  return {
    rank: standing.rank,
    user: sampleUser(entrant, null),
    avatar: entrant.avatar,
    className: entrant.className,
    solved: standing.solved,
    reachedAt: standing.reachedAt,
    change,
  } satisfies RankRow
}

function periodStart(period: RankPeriod) {
  if (period === "week") return weekStart()
  if (period === "term") return termStart()
  return null
}

/**
 * 老师打开排名页默认看哪个班：自己最近布置过作业的班 → 最近一周交题人数最多的班。
 * 不记老师上次选的：统计面板吃过那个亏（上一节课的班悄悄留在框里）。
 */
async function defaultClassFor(teacherId: number) {
  const [lesson] = await db
    .select({ className: schema.classLesson.className })
    .from(schema.classLesson)
    .where(eq(schema.classLesson.createdBy, teacherId))
    .orderBy(desc(schema.classLesson.day), desc(schema.classLesson.updatedAt))
    .limit(1)
  if (lesson) return lesson.className

  const users = countDistinct(schema.submission.userId)
  const [busiest] = await db
    .select({ className: schema.user.className, users })
    .from(schema.submission)
    .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
    .where(
      and(
        rankedStudents,
        isNotNull(schema.user.className),
        ne(schema.user.className, ""),
        gte(schema.submission.createTime, new Date(Date.now() - WEEK_MS).toISOString()),
      ),
    )
    .groupBy(schema.user.className)
    .orderBy(desc(users))
    .limit(1)
  if (busiest?.className) return busiest.className

  // 放假回来第一次打开：一周里没人交过题，就看最后一个交题的学生是哪个班
  const [latest] = await db
    .select({ className: schema.user.className })
    .from(schema.submission)
    .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
    .where(and(rankedStudents, isNotNull(schema.user.className), ne(schema.user.className, "")))
    .orderBy(desc(schema.submission.createTime))
    .limit(1)
  return latest?.className ?? null
}

/**
 * 这次请求看的是哪个班 / 哪个年级。学生只能看自己的班和年级；老师用 `className` 选，
 * 不给就猜（`defaultClassFor`）。返回 undefined 表示该报「没有班级」。
 */
async function resolveGroup(
  user: AppEnv["Variables"]["user"],
  scope: RankScope,
  requested: string | undefined,
): Promise<string | null | undefined> {
  if (scope === "all") return null
  let className = user?.className || null
  if (isTeacherOrAbove(user)) className = requested || (await defaultClassFor(user!.id))
  if (!className) return undefined
  return scope === "class" ? className : className.slice(0, 2)
}

rankingRoutes.get("/rankings/board", optionalAuth, async (c) => {
  const user = c.get("user")
  const scope = rankScopeSchema.safeParse(c.req.query("scope"))
  const period = rankPeriodSchema.safeParse(c.req.query("period"))
  if (!scope.success || !period.success)
    return failure(c, 400, "invalid-query", "排名范围或时间段不对")
  const group = await resolveGroup(user, scope.data, c.req.query("className")?.trim())
  if (group === undefined) return failure(c, 400, "class-missing", "没有班级，看不了本班和本年级")
  if (scope.data === "grade" && !/^\d{2}$/.test(group!))
    return failure(c, 400, "invalid-grade", "年级不对")

  const start = periodStart(period.data)
  const changeSince = period.data === "week" ? dayStart() : weekStart()
  const includeZero = scope.data === "class"
  const isTeacher = isTeacherOrAbove(user)

  const [entrants, mine, hiddenUsers] = await Promise.all([
    loadEntrants(audienceWhere(scope.data, group), start),
    user && !isTeacher
      ? db
          .select({ rankHiddenAt: schema.user.rankHiddenAt })
          .from(schema.user)
          .where(eq(schema.user.id, user.id))
          .then(([row]) => row)
      : undefined,
    isTeacher && scope.data === "class"
      ? db
          .select({ id: schema.user.id, username: schema.user.username })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.className, group!),
              inArray(schema.user.adminType, [...STUDENT_ROLES]),
              eq(schema.user.isDisabled, false),
              isNotNull(schema.user.rankHiddenAt),
            ),
          )
          .orderBy(schema.user.username)
      : [],
  ])

  const now = standings(entrants, null, includeZero)
  const before = new Map(
    standings(entrants, Date.parse(changeSince), includeZero)
      .filter((row) => row.solved > 0)
      .map((row) => [row.entrant.id, row.rank]),
  )
  const rowOf = (standing: Standing | undefined) =>
    standing
      ? toRow(
          standing,
          before.has(standing.entrant.id) ? before.get(standing.entrant.id)! - standing.rank : null,
        )
      : null

  // 一道没做对就不算上榜（本班的全班名单里也列着他，但没有名次可说，也没有对手）
  const meIndex = user ? now.findIndex((row) => row.entrant.id === user.id && row.solved > 0) : -1
  const me = meIndex >= 0 ? now[meIndex] : undefined

  const full = includeZero || c.req.query("full") === "1"
  let picked = now
  if (!full) {
    const head = me ? BOARD_HEAD : BOARD_HEAD_NO_ME
    picked = now.filter(
      (_, index) =>
        index < head || (me && index >= meIndex - WINDOW_BEFORE && index <= meIndex + WINDOW_AFTER),
    )
  }

  let trend: RankBoard["trend"] = null
  if (me && period.data !== "week") {
    const thisWeek = Date.parse(weekStart())
    const points = Array.from(
      { length: TREND_WEEKS },
      (_, k) => thisWeek - (TREND_WEEKS - 1 - k) * WEEK_MS,
    ).filter((point) => !start || point > Date.parse(start))
    const tracked = [now[meIndex - 1], me, now[meIndex + 1]].filter((row): row is Standing => !!row)
    const snapshots = points.map((point) => {
      const ranks = new Map(
        standings(entrants, point, includeZero)
          .filter((row) => row.solved > 0)
          .map((row) => [row.entrant.id, row.rank]),
      )
      return ranks
    })
    trend = {
      points: [...points.map((point) => new Date(point).toISOString()), new Date().toISOString()],
      series: tracked.map((row) => ({
        userId: row.entrant.id,
        ranks: [...snapshots.map((ranks) => ranks.get(row.entrant.id) ?? null), row.rank],
      })),
    }
  }

  return success(c, {
    scope: scope.data,
    period: period.data,
    className: group,
    start,
    changeSince,
    total: now.length,
    rows: picked.map((row) => rowOf(row)!),
    complete: picked.length === now.length,
    me: rowOf(me),
    ahead: rowOf(meIndex > 0 ? now[meIndex - 1] : undefined),
    behind: rowOf(meIndex >= 0 ? now[meIndex + 1] : undefined),
    trend,
    hidden: !!mine?.rankHiddenAt,
    hiddenUsers: hiddenUsers.map((row): SampleUser => sampleUser(row, null)),
  } satisfies RankBoard)
})

/**
 * 班级对抗：全服每个班这学期人均做对几道，外加这周人均涨了多少。人均而不是总数 ——
 * 班级人数从 11 到 58 都有，比总数等于比人多。这学期一道没做对的班不列（还没开始用）。
 * 不计入排名的人分子分母都不算：抄来的题不该替全班加分。
 */
rankingRoutes.get("/rankings/classes", async (c) => {
  const where = and(
    rankedStudents,
    isNotNull(schema.user.className),
    ne(schema.user.className, ""),
  )!
  const term = termStart()
  const week = Date.parse(weekStart())
  const entrants = await loadEntrants(where, term)

  const classes = new Map<string, { members: number; term: number; week: number }>()
  for (const entrant of entrants) {
    const entry = classes.get(entrant.className!) ?? { members: 0, term: 0, week: 0 }
    entry.members++
    entry.term += entrant.times.length
    entry.week += entrant.times.filter((time) => time >= week).length
    classes.set(entrant.className!, entry)
  }

  const result = [...classes]
    .filter(([, entry]) => entry.term > 0)
    .map(([className, entry]) => ({
      className,
      members: entry.members,
      perCapita: rounded(entry.term / entry.members, 1),
      weekGain: rounded(entry.week / entry.members, 1),
    }))
    .sort((a, b) => b.perCapita - a.perCapita || b.weekGain - a.weekGain)
  return success(
    c,
    result.map((item, index) => ({ ...item, rank: index + 1 }) satisfies ClassBattleItem),
  )
})

/** 本班每周冠军：最近几个已经结束的周，每周新做对最多的那个人（一样多先做到的） */
rankingRoutes.get("/rankings/champions", optionalAuth, async (c) => {
  const className = await resolveGroup(c.get("user"), "class", c.req.query("className")?.trim())
  if (!className) return failure(c, 400, "class-missing", "没有班级")

  const thisWeek = Date.parse(weekStart())
  const since = new Date(thisWeek - CHAMPION_WEEKS * WEEK_MS).toISOString()
  const entrants = await loadEntrants(audienceWhere("class", className), since)

  const champions: WeeklyChampion[] = []
  for (let k = 1; k <= CHAMPION_WEEKS; k++) {
    const from = thisWeek - k * WEEK_MS
    const inWeek = entrants.map((entrant) => {
      const keep = entrant.times
        .map((time, index) => [time, entrant.stamps[index]!] as const)
        .filter(([time]) => time >= from && time < from + WEEK_MS)
      return {
        ...entrant,
        times: keep.map(([time]) => time),
        stamps: keep.map(([, stamp]) => stamp),
      }
    })
    const [top] = standings(inWeek, null, false)
    if (!top) continue
    champions.push({
      weekStart: new Date(from).toISOString(),
      user: sampleUser(top.entrant, null),
      avatar: top.entrant.avatar,
      solved: top.solved,
    } satisfies WeeklyChampion)
  }
  return success(c, champions)
})

/**
 * 老师把一个学生设成不计入排名 / 恢复。怀疑抄代码时用（用户 2026-10-10 定的）。
 * 所有排名页的榜和首页周榜都不出现他；他自己看得到「不计入排名」；比赛排名不受影响。
 */
rankingRoutes.put("/rankings/hidden/:userId", requireTeacher, async (c) => {
  const userId = Number(c.req.param("userId"))
  if (!Number.isInteger(userId)) return failure(c, 400, "invalid-user", "用户不对")
  const body = await parseBody(c, rankHiddenRequestSchema)
  if (!body.success) return body.response

  const updated = await db
    .update(schema.user)
    .set({ rankHiddenAt: body.data.hidden ? new Date().toISOString() : null })
    .where(and(eq(schema.user.id, userId), inArray(schema.user.adminType, [...STUDENT_ROLES])))
    .returning({ id: schema.user.id })
  if (!updated.length) return failure(c, 404, "user-not-found", "没有这个学生")
  return success(c, null)
})

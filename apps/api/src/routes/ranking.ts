import {
  classPkPeriodSchema,
  rankHiddenRequestSchema,
  rankPeriodSchema,
  rankScopeSchema,
  STUDENT_ROLES,
  type RankBoard,
  type RankPeriod,
  type RankRow,
  type RankScope,
  type SampleUser,
  type WeeklyChampion,
} from "@oj2/contract"
import { and, countDistinct, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireAuth, requireTeacher, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, parseBody, success } from "../http"
import { dayStart, termStart, weekStart } from "../time"
import {
  audienceWhere,
  classBattle,
  classDetail,
  classPk,
  loadEntrants,
  PK_MAX_CLASSES,
  pkPartner,
  rankedStudents,
  standings,
  WEEK_MS,
  type Standing,
} from "../services/ranking"
import { isTeacherOrAbove, sampleUser } from "./helpers"

/**
 * 排名页（设计稿「排名重设计」G1–G3）。口径见契约 `ranking.ts` 的注释：
 * 做对多的在前，一样多的先做到的在前；「做对」= 这道题第一次做对落在这段时间里。
 */
export const rankingRoutes = new Hono<AppEnv>()

/** 本年级 / 全服的榜面：前面这么多人 + 我附近一段，中间折起来 */
const BOARD_HEAD = 16
/** 我附近一段：前面 5 个、后面 7 个（多给后面几个：看得到后面的人离自己多近） */
const WINDOW_BEFORE = 5
const WINDOW_AFTER = 7
/** 没有「我」（老师、没上榜）时榜面给多少 */
const BOARD_HEAD_NO_ME = 30
/** 全服名单最多列到第几名，展开也到此为止（一千五百多人全摊开页面会卡死） */
const ALL_CAP = 100
/** 走势图往回看几周 */
const TREND_WEEKS = 4
/** 每周冠军列几周 */
const CHAMPION_WEEKS = 3

function toRow(standing: Standing, change: number | null): RankRow {
  const { entrant } = standing
  return {
    rank: standing.rank,
    user: sampleUser(entrant, null),
    avatar: entrant.avatar,
    className: entrant.className,
    mood: entrant.mood,
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

  // 一道没做对就不算上榜（本班的全班名单里也列着他，但没有名次可说，也没有前后一名）
  const meIndex = user ? now.findIndex((row) => row.entrant.id === user.id && row.solved > 0) : -1
  const me = meIndex >= 0 ? now[meIndex] : undefined

  const cap = scope.data === "all" ? ALL_CAP : null
  const listable = cap ? now.slice(0, cap) : now
  const full = includeZero || c.req.query("full") === "1"
  let picked = listable
  if (!full) {
    const head = me ? BOARD_HEAD : BOARD_HEAD_NO_ME
    picked = listable.filter(
      (_, index) =>
        index < head || (me && index >= meIndex - WINDOW_BEFORE && index <= meIndex + WINDOW_AFTER),
    )
  }

  // 全服 100 名以外：不报具体名次，前后一名、走势都不给，只给第 100 名算还差几道
  const beyond = !!(cap && me && me.rank > cap)

  let trend: RankBoard["trend"] = null
  if (me && !beyond && period.data !== "week") {
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
    complete: picked.length === listable.length,
    cap,
    lastListed: beyond ? rowOf(listable.at(-1)) : null,
    me: rowOf(me),
    ahead: beyond ? null : rowOf(meIndex > 0 ? now[meIndex - 1] : undefined),
    behind: beyond ? null : rowOf(meIndex >= 0 ? now[meIndex + 1] : undefined),
    trend,
    hidden: !!mine?.rankHiddenAt,
    hiddenUsers: hiddenUsers.map((row): SampleUser => sampleUser(row, null)),
  } satisfies RankBoard)
})

/**
 * 班级对抗：全服每个班这学期人均做对几道，外加这周人均涨了多少（口径见 services/ranking.ts
 * 的 classBattle）
 */
rankingRoutes.get("/rankings/classes", async (c) => {
  const { items } = await classBattle()
  return success(c, items)
})

/** 班级详情：谁都能看（原来的弹框就是），「要多关心的同学」只给老师 */
rankingRoutes.get("/rankings/class-detail", optionalAuth, async (c) => {
  const className = c.req.query("className")?.trim()
  if (!className) return failure(c, 400, "class-missing", "没有班级")
  return success(c, await classDetail(className, isTeacherOrAbove(c.get("user"))))
})

/**
 * 班级 PK（设计稿「班级 PK 重设计」定稿）：`classes` 逗号分隔。谁登录了都能看 —— 只有班级
 * 层面的数，没有点名到人。只给一个班（或者不给，用自己的班 / 老师默认的班）就配一个对手，
 * 见 `pkPartner`。
 */
rankingRoutes.get("/rankings/pk", requireAuth, async (c) => {
  const user = c.get("user")!
  const period = classPkPeriodSchema.safeParse(c.req.query("period") ?? "term")
  if (!period.success) return failure(c, 400, "invalid-query", "时间段不对")
  const requested = [
    ...new Set(
      (c.req.query("classes") ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name && name.length <= 32),
    ),
  ]
  if (requested.length > PK_MAX_CLASSES)
    return failure(c, 400, "too-many-classes", `一次最多比 ${PK_MAX_CLASSES} 个班`)

  const isTeacher = isTeacherOrAbove(user)
  const mine = isTeacher ? null : user.className || null
  const classNames = requested.length
    ? requested
    : [isTeacher ? await defaultClassFor(user.id) : mine].filter((name): name is string => !!name)
  if (classNames.length === 1) {
    const partner = await pkPartner(classNames[0]!)
    if (partner) classNames.push(partner)
  }
  return success(c, await classPk(classNames, period.data, mine))
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

/**
 * 老师清空一个学生的个性签名。签名在排名上挂出来以后更显眼，拿同学开涮、留电话号码的
 * 得有人能拿掉（用户 2026-10-10 定的）。只清这一句，他之后还能重新写。
 */
rankingRoutes.delete("/rankings/mood/:userId", requireTeacher, async (c) => {
  const userId = Number(c.req.param("userId"))
  if (!Number.isInteger(userId)) return failure(c, 400, "invalid-user", "用户不对")

  const updated = await db
    .update(schema.userProfile)
    .set({ mood: null })
    .where(
      and(
        eq(schema.userProfile.userId, userId),
        inArray(
          schema.userProfile.userId,
          db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(inArray(schema.user.adminType, [...STUDENT_ROLES])),
        ),
      ),
    )
    .returning({ id: schema.userProfile.userId })
  if (!updated.length) return failure(c, 404, "user-not-found", "没有这个学生")
  return success(c, null)
})

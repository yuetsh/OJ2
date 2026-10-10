import {
  STUDENT_ROLES,
  type ClassBattleItem,
  type ClassDetail,
  type ClassPk,
  type ClassPkCell,
  type ClassPkClass,
  type ClassPkPeriod,
  type RankScope,
} from "@oj2/contract"
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  min,
  ne,
  sql,
  type SQL,
} from "drizzle-orm"

import { db, schema } from "../db"
import { JudgeStatus } from "../judge/status"
import { sampleUser, rounded } from "../routes/helpers"
import { termStart, weekStart } from "../time"

/**
 * 排名页和班级详情、班级 AI 分析共用的口径（routes/ranking.ts、routes/ai.ts）：
 * 「做对」= 这道题第一次做对落在这段时间里，比赛里的提交不算；入榜人群是正常状态的学生，
 * 老师设成不计入排名的不算。
 */

/** AST_CHECK_FAILED 也是答案对了，与周榜、课堂条同口径 */
export const SOLVED_RESULTS = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

export const WEEK_MS = 7 * 86_400_000

/** 入榜人群：正常状态的学生与学生管理员，老师设成不计入排名的不算 */
export const rankedStudents = and(
  inArray(schema.user.adminType, [...STUDENT_ROLES]),
  eq(schema.user.isDisabled, false),
  isNull(schema.user.rankHiddenAt),
)!

export interface Entrant {
  id: number
  username: string
  className: string | null
  avatar: string | null
  mood: string | null
  /** 每道题第一次做对的时刻，升序；毫秒数用来比较，原文留着给出参 */
  times: number[]
  stamps: string[]
}

export interface Standing {
  entrant: Entrant
  rank: number
  solved: number
  reachedAt: string | null
}

export function audienceWhere(scope: RankScope, className: string | null) {
  if (scope === "class") return and(rankedStudents, eq(schema.user.className, className!))!
  if (scope === "grade") return and(rankedStudents, like(schema.user.className, `${className}%`))!
  return rankedStudents
}

export function avatarOf(avatar: string | null) {
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
export async function loadEntrants(where: SQL, since: string | null): Promise<Entrant[]> {
  const firstSolved = min(schema.submission.createTime)
  const [people, solves] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        className: schema.user.className,
        avatar: schema.userProfile.avatar,
        mood: schema.userProfile.mood,
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
      mood: person.mood?.trim() || null,
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
export function standings(entrants: Entrant[], cutoff: number | null, includeZero: boolean) {
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

/** 「要多关心的同学」：这学期做对不到这么多道 */
const CARE_BELOW = 3
/** 一档同分至少这么多人，才说「N 个人停在 x 道」 */
const PLATEAU_MIN = 5
/** 班级详情的每周人均列最近几周 */
const DETAIL_WEEKS = 6

/** 有班级的学生，这学期的做对时刻 —— 班级对抗和班级详情都从这一份算 */
async function classedEntrants() {
  const term = termStart()
  const where = and(
    rankedStudents,
    isNotNull(schema.user.className),
    ne(schema.user.className, ""),
  )!
  return { term, entrants: await loadEntrants(where, term) }
}

function battleFrom(entrants: Entrant[]) {
  const week = Date.parse(weekStart())
  const classes = new Map<string, { members: number; term: number; week: number }>()
  for (const entrant of entrants) {
    const entry = classes.get(entrant.className!) ?? { members: 0, term: 0, week: 0 }
    entry.members++
    entry.term += entrant.times.length
    entry.week += entrant.times.filter((time) => time >= week).length
    classes.set(entrant.className!, entry)
  }
  return [...classes]
    .filter(([, entry]) => entry.term > 0)
    .map(([className, entry]) => ({
      className,
      members: entry.members,
      perCapita: rounded(entry.term / entry.members, 1),
      weekGain: rounded(entry.week / entry.members, 1),
    }))
    .sort((a, b) => b.perCapita - a.perCapita || b.weekGain - a.weekGain)
    .map((item, index) => ({ ...item, rank: index + 1 }) satisfies ClassBattleItem)
}

/**
 * 班级对抗：全服每个班这学期人均做对几道，外加这周人均涨了多少。人均而不是总数 ——
 * 班级人数从 11 到 58 都有，比总数等于比人多。这学期一道没做对的班不列（还没开始用）。
 * 不计入排名的人分子分母都不算：抄来的题不该替全班加分。
 */
export async function classBattle() {
  const { entrants } = await classedEntrants()
  return { items: battleFrom(entrants) }
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * 班级详情，抽屉里的全部数字（也是班级 AI 分析的输入）。`withCare` 只对老师开：
 * 「要多关心的同学」点了名，学生不该看到别人被点名。
 */
export async function classDetail(className: string, withCare: boolean): Promise<ClassDetail> {
  const { term, entrants } = await classedEntrants()
  const battle = battleFrom(entrants)
  const mine = entrants.filter((entrant) => entrant.className === className)
  const solved = mine.map((entrant) => entrant.times.length)
  const desc = [...solved].sort((a, b) => b - a)
  const tenth = Math.max(1, Math.ceil(mine.length / 10))

  // 同年级在用的班：班级对抗里列着的（这学期做对过题）、班号前两位相同
  const grade = className.slice(0, 2)
  const gradeClasses = new Set(
    battle.filter((item) => item.className.slice(0, 2) === grade).map((item) => item.className),
  )
  const gradeEntrants = entrants.filter((entrant) => gradeClasses.has(entrant.className!))
  const gradeAvg = gradeEntrants.length
    ? rounded(average(gradeEntrants.map((entrant) => entrant.times.length)), 1)
    : null

  const groups = new Map<number, number>()
  for (const value of solved) if (value > 0) groups.set(value, (groups.get(value) ?? 0) + 1)
  const [plateau] = [...groups]
    .filter(([, n]) => n >= PLATEAU_MIN)
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])

  // 每周：周一零点起算，从这学期第一周到这周，只留最近几周
  const firstWeek = Date.parse(weekStart(term))
  const thisWeek = Date.parse(weekStart())
  const weeks: ClassDetail["weeks"] = []
  for (let from = firstWeek; from <= thisWeek; from += WEEK_MS) {
    const inWeek = (entrant: Entrant) =>
      entrant.times.filter((time) => time >= from && time < from + WEEK_MS).length
    weeks.push({
      weekStart: new Date(from).toISOString(),
      perCapita: mine.length ? rounded(average(mine.map(inWeek)), 1) : 0,
      gradeAvg: gradeEntrants.length ? rounded(average(gradeEntrants.map(inWeek)), 1) : null,
    })
  }

  let care: ClassDetail["care"] = null
  if (withCare) {
    const low = mine
      .filter((entrant) => entrant.times.length < CARE_BELOW)
      .sort((a, b) => a.times.length - b.times.length || a.id - b.id)
    const submitted = low.length
      ? await db
          .select({ userId: schema.submission.userId, n: count() })
          .from(schema.submission)
          .where(
            and(
              inArray(
                schema.submission.userId,
                low.map((entrant) => entrant.id),
              ),
              isNull(schema.submission.contestId),
              gte(schema.submission.createTime, term),
            ),
          )
          .groupBy(schema.submission.userId)
      : []
    const counts = new Map(submitted.map((row) => [row.userId, row.n]))
    care = low.map((entrant) => ({
      user: sampleUser(entrant, null),
      avatar: entrant.avatar,
      solved: entrant.times.length,
      submissions: counts.get(entrant.id) ?? 0,
    }))
  }

  const item = battle.find((entry) => entry.className === className)
  return {
    className,
    start: term,
    members: mine.length,
    rank: item?.rank ?? null,
    battleSize: battle.length,
    perCapita: mine.length ? rounded(average(solved), 1) : 0,
    gradeAvg,
    median: median(solved),
    solvedMembers: solved.filter((value) => value > 0).length,
    top10Avg: rounded(average(desc.slice(0, tenth)), 1),
    bottom10Avg: rounded(average(desc.slice(-tenth)), 1),
    plateau: plateau ? { solved: plateau[0], count: plateau[1] } : null,
    distribution: solved,
    weeks: weeks.slice(-DETAIL_WEEKS),
    care,
  } satisfies ClassDetail
}

/** 一次最多比几个班（对照格再宽就放不下了） */
export const PK_MAX_CLASSES = 8

interface PkPair {
  className: string
  problemId: number
  solved: boolean
  firstSolved: boolean
  submissions: number
}

/**
 * 这几个班从 `since` 起每个人每道题：交了几次、做对没有、第一次交就对没有。比赛里的提交不算，
 * 入榜人群和排名页一样（不计入排名的人不算）。「第一次」是这段时间里的第一次。
 */
async function pkPairs(classNames: string[], since: string): Promise<PkPair[]> {
  const rows = await db
    .select({
      className: schema.user.className,
      problemId: schema.submission.problemId,
      submissions: count(),
      solved: sql<boolean>`bool_or(${inArray(schema.submission.result, SOLVED_RESULTS)})`,
      first: sql<number>`(array_agg(${schema.submission.result} order by ${schema.submission.createTime}, ${schema.submission.id}))[1]`,
    })
    .from(schema.submission)
    .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
    .where(
      and(
        rankedStudents,
        inArray(schema.user.className, classNames),
        isNull(schema.submission.contestId),
        gte(schema.submission.createTime, since),
      ),
    )
    .groupBy(schema.user.className, schema.submission.userId, schema.submission.problemId)
  return rows.map((row) => ({
    className: row.className!,
    problemId: row.problemId,
    solved: row.solved,
    firstSolved: (SOLVED_RESULTS as number[]).includes(row.first),
    submissions: row.submissions,
  }))
}

/** 每个班布置过哪些题：过半的人交过就算 */
function assignedSets(pairs: PkPair[], members: Map<string, number>) {
  const tried = new Map<string, Map<number, number>>()
  for (const pair of pairs) {
    const byProblem = tried.get(pair.className) ?? new Map<number, number>()
    byProblem.set(pair.problemId, (byProblem.get(pair.problemId) ?? 0) + 1)
    tried.set(pair.className, byProblem)
  }
  const sets = new Map<string, Set<number>>()
  for (const [className, byProblem] of tried) {
    const n = members.get(className) ?? 0
    sets.set(
      className,
      new Set([...byProblem].filter(([, people]) => n > 0 && people * 2 >= n).map(([id]) => id)),
    )
  }
  return sets
}

function memberCounts(entrants: Entrant[]) {
  const members = new Map<string, number>()
  for (const entrant of entrants)
    members.set(entrant.className!, (members.get(entrant.className!) ?? 0) + 1)
  return members
}

/**
 * 只给了一个班（或者没给、用看的人自己的班）时，配一个对手：同年级在用的班里，和它一起
 * 布置过的题最多的那个；一样多挑班级对抗里排得更前的（用户 2026-10-10 定的）。
 * 同年级没有别的在用的班就不配。
 */
export async function pkPartner(className: string) {
  const { term, entrants } = await classedEntrants()
  const battle = battleFrom(entrants)
  const grade = className.slice(0, 2)
  const candidates = battle.filter(
    (item) => item.className !== className && item.className.slice(0, 2) === grade,
  )
  if (!candidates.length) return null
  const names = [className, ...candidates.map((item) => item.className)]
  const sets = assignedSets(
    await pkPairs(names, term),
    memberCounts(entrants.filter((entrant) => names.includes(entrant.className!))),
  )
  const mine = sets.get(className) ?? new Set<number>()
  const common = (name: string) => [...(sets.get(name) ?? [])].filter((id) => mine.has(id)).length
  return candidates.sort((a, b) => common(b.className) - common(a.className) || a.rank - b.rank)[0]!
    .className
}

/**
 * 班级 PK 的全部数字（页面和 AI 分析共用）。人均、分布按 `period` 算；每周人均（赛跑）
 * 一直按这学期，横轴才有东西。
 */
export async function classPk(
  classNames: string[],
  period: ClassPkPeriod,
  mine: string | null,
): Promise<ClassPk> {
  const { term, entrants: all } = await classedEntrants()
  const since = period === "week" ? weekStart() : term
  const sinceMs = Date.parse(since)
  const battle = battleFrom(all)
  const entrants = all.filter((entrant) => classNames.includes(entrant.className!))
  const members = memberCounts(entrants)
  const pairs = await pkPairs(classNames, since)
  const assigned = assignedSets(pairs, members)

  const firstWeek = Date.parse(weekStart(term))
  const thisWeek = Date.parse(weekStart())
  const weeks: number[] = []
  for (let from = firstWeek; from <= thisWeek; from += WEEK_MS) weeks.push(from)

  // 每道题、每个班：交过 / 做对 / 一次就对 / 提交次数
  const cells = new Map<
    number,
    Map<string, Omit<ClassPkCell, "percent" | "firstPercent" | "best">>
  >()
  for (const pair of pairs) {
    if (!assigned.get(pair.className)?.has(pair.problemId)) continue
    const byClass = cells.get(pair.problemId) ?? new Map()
    const cell = byClass.get(pair.className) ?? { tried: 0, solved: 0, firstTry: 0, submissions: 0 }
    cell.tried++
    if (pair.solved) cell.solved++
    if (pair.firstSolved) cell.firstTry++
    cell.submissions += pair.submissions
    byClass.set(pair.className, cell)
    cells.set(pair.problemId, byClass)
  }
  const titles = cells.size
    ? await db
        .select({
          id: schema.problem.id,
          displayId: schema.problem.displayId,
          title: schema.problem.title,
        })
        .from(schema.problem)
        .where(inArray(schema.problem.id, [...cells.keys()]))
    : []
  const titleOf = new Map(titles.map((row) => [row.id, row]))

  const lead = new Map<string, number>()
  const problems: ClassPk["problems"] = []
  const solo: ClassPk["solo"] = []
  for (const [problemId, byClass] of [...cells].sort((a, b) => a[0] - b[0])) {
    const meta = titleOf.get(problemId)
    if (!meta) continue
    if (byClass.size === 1) {
      const [className] = byClass.keys()
      solo.push({ problemId, displayId: meta.displayId, title: meta.title, className: className! })
      continue
    }
    const row = classNames.map((className) => {
      const cell = byClass.get(className)
      if (!cell) return null
      return {
        ...cell,
        percent: Math.round((cell.solved / members.get(className)!) * 100),
        firstPercent: Math.round((cell.firstTry / cell.tried) * 100),
        best: false,
      }
    })
    const top = Math.max(...row.map((cell) => cell?.percent ?? -1))
    row.forEach((cell, index) => {
      if (!cell || cell.percent !== top) return
      cell.best = true
      lead.set(classNames[index]!, (lead.get(classNames[index]!) ?? 0) + 1)
    })
    problems.push({ problemId, displayId: meta.displayId, title: meta.title, cells: row })
  }

  const classes = classNames.map((className) => {
    const people = entrants.filter((entrant) => entrant.className === className)
    const solved = people.map((entrant) => entrant.times.filter((time) => time >= sinceMs).length)
    const own = pairs.filter((pair) => pair.className === className)
    return {
      className,
      members: people.length,
      perCapita: people.length ? rounded(average(solved), 1) : 0,
      median: median(solved),
      solvedMembers: solved.filter((value) => value > 0).length,
      firstPercent: own.length
        ? Math.round((own.filter((pair) => pair.firstSolved).length / own.length) * 100)
        : null,
      lead: lead.get(className) ?? 0,
      battleRank: battle.find((item) => item.className === className)?.rank ?? null,
      distribution: solved,
      weekly: weeks.map((from) =>
        people.length
          ? rounded(
              average(
                people.map(
                  (entrant) =>
                    entrant.times.filter((time) => time >= from && time < from + WEEK_MS).length,
                ),
              ),
              1,
            )
          : 0,
      ),
    } satisfies ClassPkClass
  })

  return {
    period,
    start: since,
    weeks: weeks.map((from) => new Date(from).toISOString()),
    classes,
    mine,
    problems,
    solo,
  } satisfies ClassPk
}

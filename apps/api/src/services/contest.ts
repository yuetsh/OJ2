import { createHash } from "node:crypto"

import {
  isExamTag,
  STUDENT_ROLES,
  TEACHER_ROLES,
  type ContestClassView,
  type ContestScoreboard,
  type ContestScoreRow,
  type ContestSubmissionInfo,
} from "@oj2/contract"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { Context, MiddlewareHandler } from "hono"

import type { AppEnv } from "../auth/middleware"
import type { AuthUser } from "../auth/session"
import { getContestPassword } from "../auth/session"
import { db, schema } from "../db"
import { failure } from "../http"

export type ContestRow = typeof schema.contest.$inferSelect

/**
 * 走过 requireContestAccess 的路由，可以从 c.var.contest 直接拿到已鉴权的比赛。
 *
 * 类型上是可选的（同一个 router 里还有不涉及比赛的路由），所以 handler 里要写 `!`。
 * 万一漏挂中间件，这里会在运行时抛错变成 500 —— 吵闹但安全，
 * 而漏调 canAccessContest 是静默放行，两者不可同日而语。
 */
export interface ContestEnv extends AppEnv {
  Variables: AppEnv["Variables"] & { contest?: ContestRow }
}

export function contestStatus(contest: ContestRow) {
  const now = Date.now()
  if (Date.parse(contest.startTime) > now) return "1" as const
  if (Date.parse(contest.endTime) < now) return "-1" as const
  return "0" as const
}

export function isContestAdmin(user: AuthUser | null | undefined, contest: ContestRow) {
  return Boolean(user && (user.id === contest.createdById || user.adminType === "Super Admin"))
}

export function contestDetailsAllowed(user: AuthUser | null | undefined, contest: ContestRow) {
  return contestStatus(contest) === "-1" || isContestAdmin(user, contest)
}

export function checkContestPassword(
  candidate: string | null | undefined,
  expected: string | null,
) {
  if (!candidate || !expected) return false
  if (candidate === expected) return true
  const parts = candidate.split("#")
  if (parts.length !== 2) return false
  const [signature, expiresAt] = parts
  if (!signature || !expiresAt || !/^\d+$/.test(expiresAt)) return false
  const expectedSignature = createHash("sha256")
    .update(`${expected}${expiresAt}`)
    .digest("hex")
    .slice(0, 8)
  return signature === expectedSignature && Date.now() < Number(expiresAt) * 1000
}

/**
 * 取一场「这个人看得见」的比赛：公开（visible）的谁都取得到，隐藏的只有比赛管理员
 * （出题人本人 / 超管）取得到，对其余人一律当作不存在。
 *
 * 原来这里一律卡 visible，于是老师赛后把比赛收起来之后，核查页的「查看代码」必然 404：
 * 那个页面自己**故意不卡** visible（赛后核查恰恰发生在比赛收起来之后，见
 * admin/contest.ts 的说明），它调的比赛提交列表却卡着，两边对不上。
 *
 * 放宽的只有出题人自己的视角，学生看隐藏比赛照旧是 404。
 */
export async function findAccessibleContest(user: AuthUser | null | undefined, id: number) {
  const [contest] = await db.select().from(schema.contest).where(eq(schema.contest.id, id)).limit(1)
  if (!contest) return null
  return contest.visible || isContestAdmin(user, contest) ? contest : null
}

// 泛型而不是写死 Context<AppEnv>：requireContestAccess 传进来的是 Context<ContestEnv>，
// 它比 AppEnv 多一个变量，而 Hono 的 Context 在 Variables 上是逆变的，写死会类型不兼容。
export async function canAccessContest<E extends AppEnv>(
  c: Context<E>,
  contest: ContestRow,
  checkType: "details" | "problems" | "ranks" | "submissions",
) {
  const user = c.get("user")
  if (!user) return { ok: false as const, code: "login-required", message: "请先登录" }
  if (isContestAdmin(user, contest)) return { ok: true as const }
  if (contest.password) {
    const stored = await getContestPassword(c, contest.id)
    if (!checkContestPassword(stored, contest.password)) {
      return {
        ok: false as const,
        code: "wrong-password",
        message: "比赛密码不对，或者已经过期了，请重新输入",
      }
    }
  }
  if (contestStatus(contest) === "1" && checkType !== "details") {
    return {
      ok: false as const,
      code: "contest-not-started",
      message: "比赛还没有开始",
    }
  }
  return { ok: true as const }
}

/**
 * 比赛内容路由的守卫中间件。旧后端用 `@check_contest_permission` 装饰器，漏挂一眼看得出来；
 * 手工在 handler 里调 `canAccessContest` 则漏调一次就是静默放行，而且这类路由挂的是
 * `optionalAuth`（本身不拦人），从路由注册那一行完全看不出它受保护。这个中间件把
 * 「取比赛 → 404 → 鉴权 → 401/403」四步收进注册行里，恢复旧后端那种显眼程度。
 *
 * 通过后比赛对象放进 `c.var.contest`，handler 直接取，不必再查一次库。
 *
 * 注意：`POST /submissions` 用不了它 —— 那里的比赛 id 来自请求体而非路径参数，
 * 中间件跑的时候还没解析 body。那一处仍是手工调用，见 submission.ts 内的说明。
 */
export function requireContestAccess(
  checkType: "details" | "problems" | "ranks" | "submissions",
  paramName = "id",
): MiddlewareHandler<ContestEnv> {
  return async (c, next) => {
    const id = Number(c.req.param(paramName))
    const contest =
      Number.isInteger(id) && id > 0 ? await findAccessibleContest(c.get("user"), id) : null
    if (!contest) return failure(c, 404, "contest-not-found", "比赛不存在")
    const access = await canAccessContest(c, contest, checkType)
    if (!access.ok) {
      return failure(c, access.code === "login-required" ? 401 : 403, access.code, access.message)
    }
    c.set("contest", contest)
    await next()
  }
}

/** 老师（含出题人、超管）：看得到真名、全班情况，期中期末进行中也看得到排名 */
export function isContestTeacher(user: AuthUser | null | undefined, contest: ContestRow) {
  return Boolean(user && (isContestAdmin(user, contest) || TEACHER_ROLES.includes(user.adminType)))
}

/** 期中、期末进行中，学生看不到排名和每题做对人数（见契约 isExamTag） */
export function rankHiddenFor(user: AuthUser | null | undefined, contest: ContestRow) {
  return (
    isExamTag(contest.tag) && contestStatus(contest) === "0" && !isContestTeacher(user, contest)
  )
}

const PENALTY_SECONDS = 20 * 60
/** 「5 分钟里上升 3 名」的 5 分钟 */
const RANK_MOVE_WINDOW_SECONDS = 5 * 60

type RankRow = {
  rankId: number
  userId: number
  username: string
  realName: string | null
  className: string | null
  solved: number
  totalTime: number
  info: Record<string, ContestSubmissionInfo>
}

/**
 * 只算 `cutoff` 秒之前做对的题，得到那一刻的名次（用户 id → 名次）。
 * 做对前的错误次数都发生在做对之前，所以「那时做对的题 + 它们的罚时」就是那一刻的榜；
 * 那时还没做对的题当时错了几次不影响名次（ACM 只罚做对的题）
 */
function ranksAt(rows: RankRow[], cutoff: number) {
  const scored = rows.map((row) => {
    let solved = 0
    let time = 0
    for (const info of Object.values(row.info)) {
      if (info.is_ac && info.ac_time <= cutoff) {
        solved += 1
        time += info.ac_time + info.error_number * PENALTY_SECONDS
      }
    }
    return { row, solved, time }
  })
  scored.sort((a, b) => b.solved - a.solved || a.time - b.time || a.row.rankId - b.row.rankId)
  return new Map(scored.map((item, index) => [item.row.userId, index + 1]))
}

/**
 * 整张榜。名次按 做对数 ↓、罚时 ↑ 排，同分的按 rank 行 id 定个稳定顺序（不并列名次，和原来一样）。
 * 只算学生、不算禁用的号；老师赛中试做的提交不上榜，也不占「最先做对」。
 */
export async function buildScoreboard(
  contest: ContestRow,
  viewer: AuthUser | null | undefined,
): Promise<ContestScoreboard> {
  const teacher = isContestTeacher(viewer, contest)
  const hidden = rankHiddenFor(viewer, contest)
  const [problems, rankRows] = await Promise.all([
    db
      .select({
        id: schema.problem.id,
        displayId: schema.problem.displayId,
        title: schema.problem.title,
      })
      .from(schema.problem)
      .where(and(eq(schema.problem.contestId, contest.id), eq(schema.problem.visible, true)))
      .orderBy(sql`length(${schema.problem.displayId})`, asc(schema.problem.displayId)),
    db
      .select({
        rankId: schema.acmContestRank.id,
        userId: schema.user.id,
        username: schema.user.username,
        realName: schema.userProfile.realName,
        className: schema.user.className,
        solved: schema.acmContestRank.acceptedNumber,
        totalTime: schema.acmContestRank.totalTime,
        info: schema.acmContestRank.submissionInfo,
      })
      .from(schema.acmContestRank)
      .innerJoin(schema.user, eq(schema.acmContestRank.userId, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(
        and(
          eq(schema.acmContestRank.contestId, contest.id),
          inArray(schema.user.adminType, [...STUDENT_ROLES]),
          eq(schema.user.isDisabled, false),
        ),
      )
      .orderBy(
        desc(schema.acmContestRank.acceptedNumber),
        asc(schema.acmContestRank.totalTime),
        asc(schema.acmContestRank.id),
      ),
  ])

  // 每题学生里最早做对的那一秒
  const firstAcTime = new Map<string, number>()
  for (const row of rankRows) {
    for (const [problemId, info] of Object.entries(row.info)) {
      if (!info.is_ac) continue
      const best = firstAcTime.get(problemId)
      if (best === undefined || info.ac_time < best) firstAcTime.set(problemId, info.ac_time)
    }
  }

  const elapsed = Math.floor((Date.now() - Date.parse(contest.startTime)) / 1000)
  const prev =
    contestStatus(contest) === "0" ? ranksAt(rankRows, elapsed - RANK_MOVE_WINDOW_SECONDS) : null

  const rows: ContestScoreRow[] = rankRows.map((row, index) => ({
    rankId: row.rankId,
    userId: row.userId,
    username: row.username,
    realName: teacher ? row.realName : null,
    className: row.className,
    rank: index + 1,
    prevRank: prev?.get(row.userId) ?? null,
    solved: row.solved,
    totalTime: row.totalTime,
    cells: Object.fromEntries(
      Object.entries(row.info).map(([problemId, info]) => [
        problemId,
        {
          isAc: info.is_ac,
          acTime: info.ac_time,
          errors: info.error_number,
          firstAc: info.is_ac && info.ac_time === firstAcTime.get(problemId),
          checked: info.checked === true,
        },
      ]),
    ),
  }))

  const problemRows = problems.map((problem) => {
    const key = String(problem.id)
    let solvedUsers = 0
    let triedUsers = 0
    let firstSolver: { username: string; acTime: number } | null = null
    for (const row of rows) {
      const cell = row.cells[key]
      if (!cell) continue
      triedUsers += 1
      if (!cell.isAc) continue
      solvedUsers += 1
      if (cell.firstAc && !firstSolver)
        firstSolver = { username: row.username, acTime: cell.acTime }
    }
    return hidden
      ? {
          id: problem.id,
          _id: problem.displayId,
          title: problem.title,
          solvedUsers: 0,
          triedUsers: 0,
          firstSolver: null,
        }
      : {
          id: problem.id,
          _id: problem.displayId,
          title: problem.title,
          solvedUsers,
          triedUsers,
          firstSolver,
        }
  })

  if (hidden) {
    const mine = rows.filter((row) => row.userId === viewer?.id)
    return {
      hidden,
      problems: problemRows,
      // 「全班最先做对」也是别人的信息，考完再说
      rows: mine.map((row) => ({
        ...row,
        rank: null,
        prevRank: null,
        cells: Object.fromEntries(
          Object.entries(row.cells).map(([key, cell]) => [key, { ...cell, firstAc: false }]),
        ),
      })),
    }
  }
  return { hidden, problems: problemRows, rows }
}

/**
 * 老师的「全班情况 / 成绩」：榜单 + 每人最后一次交 + 没进来的人。
 * 比赛不绑班（2026-10 用户定的「都能进」），名单按参赛的人推：一个班来了一半以上，
 * 就把这个班算进来，班里没交过题的人列成「没进来」。技能周那种七个班各来几个人的，一个班也不算
 */
export async function buildClassView(
  contest: ContestRow,
  viewer: AuthUser,
): Promise<ContestClassView> {
  const board = await buildScoreboard(contest, viewer)
  const last = await db.execute<{ user_id: number; create_time: string; problem_id: number }>(sql`
    select distinct on (user_id) user_id, create_time, problem_id
    from submission
    where contest_id = ${contest.id}
    order by user_id, create_time desc
  `)
  const lastSubmit: ContestClassView["lastSubmit"] = {}
  for (const row of last) {
    lastSubmit[String(row.user_id)] = { time: row.create_time, problemId: row.problem_id }
  }

  const came = new Map<string, number>()
  for (const row of board.rows) {
    if (row.className) came.set(row.className, (came.get(row.className) ?? 0) + 1)
  }
  const candidates = [...came.keys()]
  const roster =
    candidates.length === 0
      ? []
      : await db
          .select({
            userId: schema.user.id,
            username: schema.user.username,
            realName: schema.userProfile.realName,
            className: schema.user.className,
          })
          .from(schema.user)
          .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
          .where(
            and(
              inArray(schema.user.className, candidates),
              inArray(schema.user.adminType, [...STUDENT_ROLES]),
              eq(schema.user.isDisabled, false),
            ),
          )
          .orderBy(asc(schema.user.username))
  const size = new Map<string, number>()
  for (const user of roster) size.set(user.className!, (size.get(user.className!) ?? 0) + 1)
  const classes = candidates
    .filter((name) => (came.get(name) ?? 0) * 2 >= (size.get(name) ?? 0))
    .sort()
  const joined = new Set(board.rows.map((row) => row.userId))
  const absent = roster.filter(
    (user) => classes.includes(user.className!) && !joined.has(user.userId),
  )
  return { ...board, lastSubmit, classes, absent }
}

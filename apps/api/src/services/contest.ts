import { createHash } from "node:crypto"

import { and, eq } from "drizzle-orm"
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

export function checkContestPassword(candidate: string | null | undefined, expected: string | null) {
  if (!candidate || !expected) return false
  if (candidate === expected) return true
  const parts = candidate.split("#")
  if (parts.length !== 2) return false
  const [signature, expiresAt] = parts
  if (!signature || !expiresAt || !/^\d+$/.test(expiresAt)) return false
  const expectedSignature = createHash("sha256").update(`${expected}${expiresAt}`).digest("hex").slice(0, 8)
  return signature === expectedSignature && Date.now() < Number(expiresAt) * 1000
}

export async function findVisibleContest(id: number) {
  const [contest] = await db.select().from(schema.contest)
    .where(and(eq(schema.contest.id, id), eq(schema.contest.visible, true))).limit(1)
  return contest ?? null
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
      return { ok: false as const, code: "wrong-password", message: "Wrong password or password expired" }
    }
  }
  if (contestStatus(contest) === "1" && checkType !== "details") {
    return { ok: false as const, code: "contest-not-started", message: "Contest has not started yet." }
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
    const contest = Number.isInteger(id) && id > 0 ? await findVisibleContest(id) : null
    if (!contest) return failure(c, 404, "contest-not-found", "Contest does not exist")
    const access = await canAccessContest(c, contest, checkType)
    if (!access.ok) {
      return failure(c, access.code === "login-required" ? 401 : 403, access.code, access.message)
    }
    c.set("contest", contest)
    await next()
  }
}

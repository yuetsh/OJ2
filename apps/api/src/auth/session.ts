import { randomBytes } from "node:crypto"

import {
  toAdminType,
  toProblemPermission,
  type AdminType,
  type ProblemPermission,
} from "@oj2/contract"

import { eq } from "drizzle-orm"
import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

import { config } from "../config"
import { db, schema } from "../db"
import { redis } from "../redis"

const SESSION_PREFIX = "session:"

interface StoredSession {
  userId: number
  createdAt: string
  previousLogin: string | null
  contestPasswords: Record<string, string>
}

/**
 * 会话里的用户。`adminType` / `problemPermission` 是**联合类型而不是 string** ——
 * 全仓二十多处 `user.adminType === "Super Admin"` 靠它兜底，拼错一个字母就编译不过。
 * 收窄发生在下面读库那一处，是整个后端唯一一个把裸字符串变成角色的地方。
 */
export interface AuthUser {
  id: number
  username: string
  email: string | null
  adminType: AdminType
  problemPermission: ProblemPermission
  isDisabled: boolean
  className: string | null
}

function sessionKey(token: string) {
  return `${SESSION_PREFIX}${token}`
}

export async function createSession(
  c: Context,
  userId: number,
  previousLogin: string | null = null,
) {
  const token = randomBytes(32).toString("base64url")
  const value: StoredSession = {
    userId,
    createdAt: new Date().toISOString(),
    previousLogin,
    contestPasswords: {},
  }
  await redis.set(
    sessionKey(token),
    JSON.stringify(value),
    "EX",
    config.sessionTtlSeconds,
  )
  setCookie(c, config.sessionCookie, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.secureCookies,
    path: "/",
    maxAge: config.sessionTtlSeconds,
  })
}

/** 返回被删掉的 token：调用方要拿它去广播会话吊销，好断掉同一浏览器里其他标签页的连接 */
export async function destroySession(c: Context) {
  const token = getCookie(c, config.sessionCookie)
  if (token) await redis.del(sessionKey(token))
  deleteCookie(c, config.sessionCookie, { path: "/" })
  return token ?? null
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie")
  if (!header) return undefined
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=")
    if (key === name) return decodeURIComponent(value.join("="))
  }
  return undefined
}

/**
 * 会话解析结果。之所以不只返回 `AuthUser | null`：拿不到用户有两种原因，
 * 而它们对应完全不同的前端行为 —— 未登录该弹登录框，已禁用该说「账号已禁用」。
 */
export type SessionResult =
  | { user: AuthUser; reason?: undefined }
  | { user: null; reason: "anonymous" | "disabled" }

async function getUserByToken(token: string | undefined): Promise<SessionResult> {
  if (!token) return { user: null, reason: "anonymous" }

  const raw = await redis.get(sessionKey(token))
  if (!raw) return { user: null, reason: "anonymous" }

  let session: StoredSession
  try {
    session = JSON.parse(raw) as StoredSession
  } catch {
    await redis.del(sessionKey(token))
    return { user: null, reason: "anonymous" }
  }

  const [user] = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      email: schema.user.email,
      adminType: schema.user.adminType,
      problemPermission: schema.user.problemPermission,
      isDisabled: schema.user.isDisabled,
      className: schema.user.className,
    })
    .from(schema.user)
    .where(eq(schema.user.id, session.userId))
    .limit(1)

  if (!user) {
    await redis.del(sessionKey(token))
    return { user: null, reason: "anonymous" }
  }

  if (user.isDisabled) {
    // 会话照删（禁用要立即生效），但要把「是被禁用」这件事告诉调用方。
    // 都返回 null 的话，中途被禁用的学生看到的是 401 login-required，
    // 前端据此弹登录框，登进去又被弹 —— 死循环，而且看不出发生了什么。
    await redis.del(sessionKey(token))
    return { user: null, reason: "disabled" }
  }

  await redis.expire(sessionKey(token), config.sessionTtlSeconds)
  // 唯一的收窄点。库里是 text 列，认不出来的值降成最低权限，见 toAdminType 的注释。
  return {
    user: {
      ...user,
      adminType: toAdminType(user.adminType),
      problemPermission: toProblemPermission(user.problemPermission),
    },
  }
}

/** 要区分「未登录」和「已被禁用」的用这个 —— 目前只有鉴权中间件需要 */
export function resolveSession(c: Context) {
  return getUserByToken(getCookie(c, config.sessionCookie))
}

/** 只关心「是谁」的调用方用这个 */
export async function getSessionUser(c: Context) {
  return (await resolveSession(c)).user
}

export async function getRequestSessionUser(request: Request) {
  return (await getUserByToken(readCookie(request, config.sessionCookie))).user
}

/**
 * WebSocket 升级时把 token 一起存进连接，之后才能定期确认这个会话还有效
 * —— 握手时校验过一次，可这条连接能挂上好几个小时。
 */
export function readRequestSessionToken(request: Request) {
  return readCookie(request, config.sessionCookie) ?? ""
}

/**
 * 会话还在就续期并返回 true，已登出或已过期返回 false。
 *
 * 用 EXPIRE 一条命令同时完成「判断存在」和「续期」，比 GET + EXPIRE 少一趟往返。
 * 续期这件事本身也是要的：HTTP 请求会走 getUserByToken 里的 redis.expire 续期，
 * 而只开着页面挂 WebSocket 的人一次请求都不发，不该因此被算成不活跃踢下线。
 */
export async function touchSession(token: string) {
  if (!token) return false
  return (await redis.expire(sessionKey(token), config.sessionTtlSeconds)) === 1
}

async function getStoredSession(c: Context) {
  const token = getCookie(c, config.sessionCookie)
  if (!token) return null
  const raw = await redis.get(sessionKey(token))
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as StoredSession
    value.contestPasswords ??= {}
    value.previousLogin ??= null
    return { token, value }
  } catch {
    return null
  }
}

export async function setContestPassword(c: Context, contestId: number, password: string) {
  const session = await getStoredSession(c)
  if (!session) return false
  session.value.contestPasswords[String(contestId)] = password
  await redis.set(
    sessionKey(session.token),
    JSON.stringify(session.value),
    "EX",
    config.sessionTtlSeconds,
  )
  return true
}

export async function getContestPassword(c: Context, contestId: number) {
  const session = await getStoredSession(c)
  return session?.value.contestPasswords[String(contestId)] ?? null
}

export async function getPreviousLogin(c: Context) {
  const session = await getStoredSession(c)
  return session?.value.previousLogin ?? null
}

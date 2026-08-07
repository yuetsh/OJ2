import { randomBytes } from "node:crypto"

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

export interface AuthUser {
  id: number
  username: string
  email: string | null
  adminType: string
  problemPermission: string
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

export async function destroySession(c: Context) {
  const token = getCookie(c, config.sessionCookie)
  if (token) await redis.del(sessionKey(token))
  deleteCookie(c, config.sessionCookie, { path: "/" })
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

async function getUserByToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null

  const raw = await redis.get(sessionKey(token))
  if (!raw) return null

  let session: StoredSession
  try {
    session = JSON.parse(raw) as StoredSession
  } catch {
    await redis.del(sessionKey(token))
    return null
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

  if (!user || user.isDisabled) {
    await redis.del(sessionKey(token))
    return null
  }

  await redis.expire(sessionKey(token), config.sessionTtlSeconds)
  return user
}

export function getSessionUser(c: Context) {
  return getUserByToken(getCookie(c, config.sessionCookie))
}

export function getRequestSessionUser(request: Request) {
  return getUserByToken(readCookie(request, config.sessionCookie))
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

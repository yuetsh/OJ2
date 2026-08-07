import { createHash } from "node:crypto"

import { and, eq } from "drizzle-orm"
import type { Context } from "hono"

import type { AppEnv } from "../auth/middleware"
import type { AuthUser } from "../auth/session"
import { getContestPassword } from "../auth/session"
import { db, schema } from "../db"

export type ContestRow = typeof schema.contest.$inferSelect

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

export async function canAccessContest(
  c: Context<AppEnv>,
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

function ipv4Number(value: string) {
  const parts = value.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return parts.reduce((result, part) => (result * 256 + part) >>> 0, 0)
}

export function ipAllowed(ip: string | null, ranges: unknown) {
  if (!Array.isArray(ranges) || ranges.length === 0) return true
  if (!ip) return false
  const target = ipv4Number(ip.replace(/^::ffff:/, ""))
  if (target === null) return false
  return ranges.some((raw) => {
    const value = typeof raw === "string" ? raw : raw && typeof raw === "object" ? String((raw as { value?: unknown }).value ?? "") : ""
    const [address, prefixText = "32"] = value.split("/")
    const network = ipv4Number(address ?? "")
    const prefix = Number(prefixText)
    if (network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return (target & mask) === (network & mask)
  })
}

import type { AuthUser } from "../auth/session"

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

export function queryInteger(
  value: string | undefined,
  fallback: number,
  options: { min?: number; max?: number } = {},
) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  if (options.min !== undefined && parsed < options.min) return fallback
  if (options.max !== undefined && parsed > options.max) return fallback
  return parsed
}

export function isRegularUser(user: AuthUser | null | undefined) {
  return user?.adminType === "Regular User"
}

export function isAdminRole(user: AuthUser | null | undefined) {
  return Boolean(user && user.adminType !== "Regular User")
}

export function isTeacherOrAbove(user: AuthUser | null | undefined) {
  return user?.adminType === "Teacher Admin" || user?.adminType === "Super Admin"
}

export function isSuperAdmin(user: AuthUser | null | undefined) {
  return user?.adminType === "Super Admin"
}

export function publicTemplates(value: unknown) {
  const templates: Record<string, string> = {}
  for (const [language, raw] of Object.entries(objectValue(value))) {
    if (typeof raw !== "string") continue
    const match = raw.match(/\/\/TEMPLATE BEGIN\n([\s\S]+?)\/\/TEMPLATE END/)
    templates[language] = match?.[1] ?? ""
  }
  return templates
}

export function todayStart() {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.toISOString()
}

export function rounded(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

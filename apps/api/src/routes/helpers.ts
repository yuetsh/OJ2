import {
  ADMIN_ROLES,
  TEACHER_ROLES,
  sampleUserSchema,
  type SampleUser,
} from "@oj2/contract"

import type { AuthUser } from "../auth/session"

/**
 * 用户对象的序列化层，对齐旧后端 `utils/api/_serializers.py` 的 `UsernameSerializer`。
 *
 * 旧后端把「是否下发真名」做成 `need_real_name` 开关，**默认关闭**，全仓 11 处调用里只有
 * 比赛榜单一处显式打开。这里保持同一约定：`realName` 默认不下发，需要的地方显式传
 * `{ includeRealName: true }`。
 *
 * 所有下发用户对象的地方都必须走这个函数，不要再手写 `{ id, username, realName }` ——
 * 手写的话下次新增端点必然重犯「学生真名无条件下发」。
 */
export function sampleUser(
  source: { id: number; username: string },
  realName: string | null | undefined,
  options: { includeRealName?: boolean } = {},
): SampleUser {
  return sampleUserSchema.parse({
    id: source.id,
    username: source.username,
    realName: options.includeRealName === true ? (realName ?? null) : null,
  })
}

/**
 * 去掉用户名里的 `ks<班级号>` 前缀，得到学生本人那一段：`ks251张三` + `251` → `张三`。
 * 对齐旧后端 `utils/shortcuts.py:52` 的 `strip_class_prefix`。
 *
 * 用 startsWith + slice 而不是 replace：replace 会删掉字符串中间的匹配，
 * 前缀对不上时从中间截出乱码。前缀不匹配就原样返回。
 */
export function stripClassPrefix(
  username: string,
  className: string | null | undefined,
) {
  if (!className) return username
  const prefix = `ks${className}`
  return username.startsWith(prefix) ? username.slice(prefix.length) : username
}

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

// 角色白名单本身在 `@oj2/contract` 的 roles.ts，那是全仓唯一的定义处；
// 这里只是把它们包成吃 AuthUser 的谓词。为什么必须是白名单，见那边的注释。
export { TEACHER_ROLES }

// 注意：不要再加 isRegularUser(user) 这类「是普通用户才受限」的判断 ——
// 匿名用户 user 为 null 时它返回 false，守卫会整体短路，匿名的权限反而大于登录学生。
// 需要「非管理员即受限」时一律用 !isAdminRole(user)。
export function isAdminRole(user: AuthUser | null | undefined) {
  return Boolean(user && ADMIN_ROLES.includes(user.adminType))
}

export function isTeacherOrAbove(user: AuthUser | null | undefined) {
  return Boolean(user && TEACHER_ROLES.includes(user.adminType))
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

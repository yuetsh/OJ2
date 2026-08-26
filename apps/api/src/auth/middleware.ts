import type { Context, MiddlewareHandler } from "hono"

import { failure } from "../http"
import { getSessionUser, resolveSession, type AuthUser } from "./session"

export interface AppEnv {
  Variables: {
    user: AuthUser | null
  }
}

export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", await getSessionUser(c))
  await next()
}

/**
 * 拿不到用户时该报哪个错。
 *
 * 「账号被禁用」必须和「没登录」分开报：前端拦截器见到 `login-required` 会弹登录框，
 * 于是一个上课上到一半被禁用的学生会陷入「弹登录框 → 登进去 → 又被弹」的死循环，
 * 而且完全看不出发生了什么。旧后端报的是「账号已禁用」，这里对齐。
 *
 * 用 403 而不是 401：凭证是有效的，是这个账号不让用了，和 login 接口对禁用账号
 * 的回法（403 `account-disabled`）也一致。
 */
function denied(c: Context, reason: "anonymous" | "disabled") {
  return reason === "disabled"
    ? failure(c, 403, "account-disabled", "账号已被禁用，请联系老师")
    : failure(c, 401, "login-required", "请先登录")
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await resolveSession(c)
  if (!session.user) return denied(c, session.reason)
  c.set("user", session.user)
  await next()
}

/**
 * 后台接口的角色守卫，对应旧后端 `account/decorators.py` 的四个装饰器。
 *
 * 未登录一律 401 `login-required`、登录但角色不够一律 403 `permission-denied`，
 * 与旧 `BasePermissionDecorator._permission_error` 的两分支一致 —— 前端 `utils/api.ts`
 * 的拦截器就是按这两个 code 分别弹登录框和弹提示的。禁用账号走第三个码，见 denied()。
 */
function requireRole(
  allowed: (user: AuthUser) => boolean,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await resolveSession(c)
    if (!session.user) return denied(c, session.reason)
    if (!allowed(session.user)) return failure(c, 403, "permission-denied", "权限不足")
    c.set("user", session.user)
    await next()
  }
}

const ADMIN_ROLES = ["Student Admin", "Teacher Admin", "Super Admin"]
const TEACHER_ROLES = ["Teacher Admin", "Super Admin"]

/** 旧 `@admin_role_required` */
export const requireAdmin = requireRole((user) => ADMIN_ROLES.includes(user.adminType))

/** 旧 `@teacher_admin_required` */
export const requireTeacher = requireRole((user) => TEACHER_ROLES.includes(user.adminType))

/** 旧 `@super_admin_required` */
export const requireSuperAdmin = requireRole((user) => user.adminType === "Super Admin")

/**
 * 旧 `@problem_permission_required`：先要是管理员，再要 problem_permission 不为 None。
 * 注意它只管「能不能进这个接口」，「能改哪些题」（Own vs All）由各 handler 自己按
 * created_by 过滤 —— 旧后端也是这么分工的，别把两件事混在一起。
 */
export const requireProblemPermission = requireRole(
  (user) => ADMIN_ROLES.includes(user.adminType) && user.problemPermission !== "None",
)

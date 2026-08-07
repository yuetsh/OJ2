import type { MiddlewareHandler } from "hono"

import { failure } from "../http"
import { getSessionUser, type AuthUser } from "./session"

export interface AppEnv {
  Variables: {
    user: AuthUser | null
  }
}

export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", await getSessionUser(c))
  await next()
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getSessionUser(c)
  if (!user) {
    return failure(c, 401, "login-required", "Authentication required")
  }
  c.set("user", user)
  await next()
}

/**
 * 后台接口的角色守卫，对应旧后端 `account/decorators.py` 的四个装饰器。
 *
 * 未登录一律 401 `login-required`、登录但角色不够一律 403 `permission-denied`，
 * 与旧 `BasePermissionDecorator._permission_error` 的两分支一致 —— 前端 `utils/api2.ts`
 * 的拦截器就是按这两个 code 分别弹登录框和弹提示的。
 *
 * 「账号已禁用」这一支不需要单独处理：`getSessionUser` 对禁用用户直接返回 null，
 * 于是落到 401，比旧后端先认证再报 403 更早拦一步。
 */
function requireRole(
  allowed: (user: AuthUser) => boolean,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await getSessionUser(c)
    if (!user) return failure(c, 401, "login-required", "请先登录")
    if (!allowed(user)) return failure(c, 403, "permission-denied", "权限不足")
    c.set("user", user)
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

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

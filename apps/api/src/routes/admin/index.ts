import { Hono } from "hono"

import type { AppEnv } from "../../auth/middleware"
import { adminAccountRoutes } from "./account"
import { adminAchievementRoutes } from "./achievement"
import { adminAiRoutes } from "./ai"
import { adminConfRoutes } from "./conf"
import { adminContestRoutes } from "./contest"
import { adminProblemSetRoutes } from "./problemset"
import { adminAnnouncementRoutes } from "./announcement"
import { adminTutorialRoutes } from "./tutorial"

/**
 * 后台路由总入口，挂在 `/api/admin` 下。
 *
 * 每个子路由自己挂角色守卫（requireAdmin / requireTeacher / requireSuperAdmin /
 * requireProblemPermission），**不在这里统一兜一层** —— 旧后端的权限就是逐个视图不同的，
 * 在总入口兜一个最宽的会让「这个接口到底要什么角色」从注册行上看不出来，
 * 正是阶段 3 的 Minor M2 踩过的坑。
 */
export const adminRoutes = new Hono<AppEnv>()

adminRoutes.route("/", adminAccountRoutes)
adminRoutes.route("/", adminAchievementRoutes)
adminRoutes.route("/", adminAiRoutes)
adminRoutes.route("/", adminConfRoutes)
adminRoutes.route("/", adminContestRoutes)
adminRoutes.route("/", adminProblemSetRoutes)
adminRoutes.route("/", adminAnnouncementRoutes)
adminRoutes.route("/", adminTutorialRoutes)

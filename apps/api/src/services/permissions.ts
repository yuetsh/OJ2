import { eq } from "drizzle-orm"

import type { AuthUser } from "../auth/session"
import { db, schema } from "../db"

/**
 * 后台「谁能改哪一条」的判断，收在这一处。原来同一句「超管或创建者」在比赛、题单、
 * 比赛题目、services/contest.ts 里各抄一遍，「题目全部权限」在题目和标签两个路由里
 * 各写一份 —— 哪天口径要改（比如加助教），漏改一处就是越权。
 */

/**
 * 「只能管自己建的」：超管放行，其余人只能碰自己创建的。对齐旧后端 `ensure_created_by`。
 * 越权时调用方一律报**不存在**而不是无权限 —— 不泄露「有这么个东西但你看不到」。
 */
export function ownsOrSuper(user: AuthUser, row: { createdById: number }) {
  return user.adminType === "Super Admin" || row.createdById === user.id
}

/** 公开题的「全部」权限：超管，或题目权限是 All */
export function canManageAllProblems(user: AuthUser) {
  return user.adminType === "Super Admin" || user.problemPermission === "All"
}

/**
 * 题目归属判断。比赛题看**比赛**的创建者，公开题看题目自己的创建者 ——
 * 对齐旧后端：`ensure_created_by(problem.contest, user)` vs `ensure_created_by(problem, user)`。
 * 一道比赛题的 created_by 可能是克隆时的操作人，跟谁有权改它没关系。
 */
export async function canEditProblem(
  user: AuthUser,
  problem: { contestId: number | null; createdById: number },
) {
  if (user.adminType === "Super Admin") return true
  if (problem.contestId === null) {
    return canManageAllProblems(user) || problem.createdById === user.id
  }
  const [contest] = await db
    .select({ createdById: schema.contest.createdById })
    .from(schema.contest)
    .where(eq(schema.contest.id, problem.contestId))
    .limit(1)
  return Boolean(contest && contest.createdById === user.id)
}

import { z } from "zod"

/**
 * 角色与题目权限的字面量。**全仓唯一的定义处。**
 *
 * 这些字符串是**落库的值** —— Django choices 的遗产，带空格、带大小写，`user` 表
 * 一千多行存的就是它们，前端也按这些值判断菜单。所以只能新增、不能改写已有的。
 *
 * 收到这里之前：`auth/middleware.ts` 和 `routes/helpers.ts` 各抄了一份
 * ADMIN_ROLES / TEACHER_ROLES，`["Regular User", "Student Admin"]` 这个学生口径
 * 在四个文件里各写一遍，另有二十多处散落的 `=== "Super Admin"`。拼错一个字母
 * TypeScript 一个字都不会说，只会在运行时静默放行或静默拒绝。
 */
export const ADMIN_TYPES = [
  "Regular User",
  "Student Admin",
  "Teacher Admin",
  "Super Admin",
] as const
export type AdminType = (typeof ADMIN_TYPES)[number]
export const adminTypeSchema = z.enum(ADMIN_TYPES)

export const PROBLEM_PERMISSIONS = ["None", "Own", "All"] as const
export type ProblemPermission = (typeof PROBLEM_PERMISSIONS)[number]
export const problemPermissionSchema = z.enum(PROBLEM_PERMISSIONS)

/**
 * 三个分组一律是**白名单**，对齐旧后端 `account/models.py:65-73` 的显式列举写法。
 *
 * 不要改成黑名单（`!== "Regular User"`）：当前四种角色下两者等价，但将来新增任何角色
 * （助教、家长……）都会**默认拿到管理员权限**。白名单则默认拒绝，加角色的人必须
 * 回到这里才能放行，而这正是应该被逼着想一遍的地方。
 */

/** 能进后台的三种 */
export const ADMIN_ROLES: readonly AdminType[] = ["Student Admin", "Teacher Admin", "Super Admin"]

/** 老师及以上 */
export const TEACHER_ROLES: readonly AdminType[] = ["Teacher Admin", "Super Admin"]

/**
 * 学生口径：排行榜、班级榜、比赛榜、自学统计都只算这两种，教师和超管不入榜。
 * 注意 Student Admin 算学生 —— 他要参赛、要上榜，只是多了个后台入口。
 */
export const STUDENT_ROLES: readonly AdminType[] = ["Regular User", "Student Admin"]

/**
 * 把库里读出来的裸字符串收成联合类型。**认不出来的一律降成最低权限**，
 * 不抛错：脏数据不该让人登不上，但更不该让人凭一个拼错的角色名拿到权限。
 */
export function toAdminType(value: string): AdminType {
  return (ADMIN_TYPES as readonly string[]).includes(value) ? (value as AdminType) : "Regular User"
}

export function toProblemPermission(value: string): ProblemPermission {
  return (PROBLEM_PERMISSIONS as readonly string[]).includes(value)
    ? (value as ProblemPermission)
    : "None"
}

/**
 * 按名字取值的写法（`USER_TYPE.SUPER_ADMIN`），给前端用 —— 它到处是这种比较，
 * 换成数组反而更难读。和上面 ADMIN_TYPES 是同一批字符串，
 * `satisfies` 保证两边不会各自漂走。
 *
 * 原先 `apps/web/src/utils/constants.ts` 里另抄了一份，那是这四个字符串的第三份副本。
 */
export const USER_TYPE = {
  REGULAR_USER: "Regular User",
  STUDENT_ADMIN: "Student Admin",
  TEACHER_ADMIN: "Teacher Admin",
  SUPER_ADMIN: "Super Admin",
} as const satisfies Record<string, AdminType>

export const PROBLEM_PERMISSION = {
  NONE: "None",
  OWN: "Own",
  ALL: "All",
} as const satisfies Record<string, ProblemPermission>

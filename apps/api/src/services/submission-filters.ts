import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { classCondition, parseDisplayIds } from "../routes/helpers"

/**
 * 两条提交列表（公开列表、比赛里的列表）的筛选条件：用户名、班级、题号。
 * 原来写在 routes/submission-statistics.ts 里，submission.ts 和 flowchart.ts 都要从
 * 另一个路由文件 import —— 挪到 services 来。
 */

/**
 * 两条提交列表的用户名筛选。**两边都要匹配**：
 *
 * - `user_id in (改过名的当前用户名匹配到的账号)` —— 老师用现在的班级前缀查
 *   `ks248`，要能查出这个人改名之前交的那些（生产快照：比赛提交里有 685 条
 *   挂在旧名字下）；
 * - `submission.username ilike` —— 已删号的学生在 `user` 表里没有行，只剩提交里
 *   冻结的那份名字；顺带也让「按记得的旧名字查」还查得到。
 *
 * 统计接口那边只按 user_id 筛（口径是「花名册上这个班谁做完了」，已删号的人本来
 * 就不在花名册里）；这两条是公开列表，不该因为改名或删号少给记录，所以取并集。
 *
 * 账号那一支**先查出 id 再拼成字面列表**，不写成 `user_id in (子查询)`：子查询夹在 OR
 * 里会被做成 hashed SubPlan，整条 OR 就不可索引，加了 trigram 索引照样全表扫。拆开之后
 * 两支各走各的索引（submission_public_metrics_idx + submission_public_username_trgm_idx），
 * 快照实测 count 65ms → 0.6ms。`ks2` 这种匹配上千个账号的宽前缀退回扫表，30~50ms，
 * 和原来持平。
 */
export async function usernameFilter(username: string) {
  const like = `%${username}%`
  const users = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(ilike(schema.user.username, like))
  const frozen = ilike(schema.submission.username, like)
  return users.length
    ? or(
        inArray(
          schema.submission.userId,
          users.map((row) => row.id),
        ),
        frozen,
      )!
    : frozen
}

/**
 * 用户名**精确**匹配。usernameFilter 是「包含」，学号互相包含是常态（ks24a1 包含在 ks24a10 里），
 * 协作中老师看「这个学生」的提交时不能把别人的也捞进来。查无此人留恒假条件
 */
export async function exactUsernameFilter(username: string) {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.username, username))
    .limit(1)
  return row ? eq(schema.submission.userId, row.id) : sql`false`
}

/**
 * 按班级筛：`user.class_name` 精确匹配。原来列表只能拿用户名前缀（`ks253`）当班级，
 * 那是「包含」匹配 —— ks253 会顺带捞进 ks2531 这类撞前缀的号，也要老师记得前缀怎么拼。
 * 查无此班留恒假条件
 */
export async function classNameFilter(className: string) {
  const users = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(classCondition(className))
  return users.length
    ? inArray(
        schema.submission.userId,
        users.map((row) => row.id),
      )
    : sql`false`
}

/**
 * 题号框里查不到的那几个（范围同 problemFilter：公开列表只认公开题，比赛列表只认本场的题）。
 * 列表把它们回给前端，打错一个字的时候老师能看到提示
 */
export async function unknownDisplayIds(displayId: string, contestId: number | null) {
  const ids = parseDisplayIds(displayId)
  if (!ids.length) return []
  const rows = await db
    .select({ displayId: schema.problem.displayId })
    .from(schema.problem)
    .where(
      and(
        inArray(
          sql`lower(${schema.problem.displayId})`,
          ids.map((id) => id.toLowerCase()),
        ),
        contestId === null
          ? isNull(schema.problem.contestId)
          : eq(schema.problem.contestId, contestId),
      ),
    )
  const found = new Set(rows.map((row) => row.displayId.toLowerCase()))
  return ids.filter((id) => !found.has(id.toLowerCase()))
}

/**
 * 两条提交列表的题号筛选：先把题号解析成 problem.id，再按 `submission.problem_id` 筛。
 * 可以一次填几道（`1021,1022`），**任一道**对上就算。
 * 原来是 join problem 之后比 `lower(problem._id)`，条件落在 problem 表上，规划器只能
 * 顺着时间索引倒扫、逐行回表比对，走不上 submission_public_problem_time_idx。
 *
 * 公开列表只认公开题、比赛列表只认本场的题：题号只在这个范围内唯一（比赛题的 `_id`
 * 和公开题撞号是常态），而公开提交从不指向比赛题（快照核过，0 条）。
 * 查无此题时留恒假条件，少推一个 filter 就成了「不筛」。
 */
export async function problemFilter(displayId: string, contestId: number | null) {
  // 一次可以筛几道（「这节课」那颗按钮一带就是五道），分隔符和统计面板同一套
  const lowered = parseDisplayIds(displayId).map((id) => id.toLowerCase())
  if (!lowered.length) return sql`false`
  const problems = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(
      and(
        inArray(sql`lower(${schema.problem.displayId})`, lowered),
        contestId === null
          ? isNull(schema.problem.contestId)
          : eq(schema.problem.contestId, contestId),
      ),
    )
  return problems.length
    ? inArray(
        schema.submission.problemId,
        problems.map((row) => row.id),
      )
    : sql`false`
}

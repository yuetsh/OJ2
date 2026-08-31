import { and, eq, notInArray, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { objectValue } from "../routes/helpers"

type BadgeRow = typeof schema.problemsetBadge.$inferSelect
type ProgressRow = typeof schema.problemsetProgress.$inferSelect
type ProblemLink = { problemId: number; score: number }
type BadgeCheck = Pick<ProgressRow, "completedProblemsCount" | "totalProblemsCount" | "totalScore">

/**
 * 题单进度的唯一算法：学生做出一道题后的增量更新、后台改动题目后的批量重算，都走这一份。
 *
 * 以前两边各写一遍，于是各自漂了一段。后台那份（resyncProgress）只更新分母和百分比：
 *   - 改题目分值时调了它，可它根本不碰 total_score，score 类奖章按陈旧分数判定；
 *   - 不碰 is_completed，加一道题之后分母变大、百分比掉下来，人还标着「已完成」；
 *   - 不清理 progress_detail，删掉一道题之后 least(completed, total) 会把没做的题算成做了。
 * 两边不再分叉的唯一办法是只留一处算法，所以这里做成纯函数，两边都只是调用者。
 */
export function computeProgress(
  detail: Record<string, unknown>,
  links: ProblemLink[],
  previousCompleteTime: string | null,
  now = new Date().toISOString(),
) {
  const scoreByProblem = new Map(links.map((link) => [String(link.problemId), link.score]))
  // 已经移出题单的题目要从 detail 里剔掉，留着它 completed 就会比实际做出的题还多
  const kept: Record<string, unknown> = {}
  let totalScore = 0
  for (const [key, value] of Object.entries(detail)) {
    const score = scoreByProblem.get(key)
    if (score === undefined) continue
    totalScore += score
    // 分值以题单当前的设置为准，detail 里存的是做出那一刻的快照
    kept[key] = { ...objectValue(value), score }
  }
  const completed = Object.keys(kept).length
  const total = links.length
  // total > 0 这个前提不能省：0 === 0 同样成立，没有题目的题单会让人一加入就算「完成」，
  // 还会写下 complete_time、计进「完成题单数」成就，而且后面补上题目也不会自愈。
  const isCompleted = total > 0 && completed === total
  return {
    progressDetail: kept,
    totalProblemsCount: total,
    completedProblemsCount: completed,
    totalScore,
    // 乘 10000 四舍五入再除 100，保留两位小数
    progressPercentage: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
    isCompleted,
    // 完成状态没了，complete_time 也不该留着。学生那一路本来就是这么写的，
    // 后台这一路以前保留旧时间，于是同一行会出现「未完成 + 有完成时间」。
    completeTime: isCompleted ? previousCompleteTime ?? now : null,
  }
}

type ProgressWrite = ReturnType<typeof computeProgress> & { id: number }

/**
 * 一条 UPDATE 刷完整批参与者。逐行 update 的话一个班的题单就是上百次往返，
 * 而每行要写的值都已经在内存里算好了，没有一个依赖数据库现有的值。
 */
async function writeProgress(rows: ProgressWrite[]) {
  // 每行 8 个参数，留足余量避开 Postgres 的 65535 个绑定参数上限
  for (let start = 0; start < rows.length; start += 1000) {
    const chunk = rows.slice(start, start + 1000)
    const values = sql.join(
      chunk.map((row) => sql`(
        ${row.id}::bigint,
        ${JSON.stringify(row.progressDetail)}::jsonb,
        ${row.totalProblemsCount}::int,
        ${row.completedProblemsCount}::int,
        ${row.totalScore}::int,
        ${row.progressPercentage}::double precision,
        ${row.isCompleted}::boolean,
        ${row.completeTime}::timestamptz
      )`),
      sql`, `,
    )
    await db.execute(sql`
      update ${schema.problemsetProgress} as pg set
        progress_detail = v.detail,
        total_problems_count = v.total_count,
        completed_problems_count = v.completed_count,
        total_score = v.total_score,
        progress_percentage = v.percentage,
        is_completed = v.is_completed,
        complete_time = v.complete_time
      from (values ${values}) as v(
        id, detail, total_count, completed_count, total_score, percentage, is_completed, complete_time
      )
      where pg.id = v.id
    `)
  }
}

/** 纯逻辑判定，对齐旧 `ProblemSetBadge._is_eligible` */
export function eligibleForBadge(badge: BadgeRow, progress: BadgeCheck) {
  if (badge.conditionType === "all_problems") {
    return progress.totalProblemsCount > 0 &&
      progress.completedProblemsCount === progress.totalProblemsCount
  }
  if (badge.conditionType === "problem_count") return progress.completedProblemsCount >= badge.conditionValue
  if (badge.conditionType === "score") return progress.totalScore >= badge.conditionValue
  return false
}

/**
 * 重算某枚奖章的获得者，对齐旧 `recalculate_user_badges`（由 post_save 信号触发）。
 * 保留已有记录的 earnedTime —— 只增删差集，不是先清空再重建，
 * 否则每改一次条件所有人的获得时间都会刷新成今天。
 *
 * 调用方手里已经有最新的进度时把它传进来（`known`），省掉一次回表；
 * 更要紧的是别用刚写完库之前的旧值去判定。
 */
export async function recalculateBadge(badge: BadgeRow, known?: (BadgeCheck & { userId: number })[]) {
  const progresses = known ?? await db.select().from(schema.problemsetProgress)
    .where(eq(schema.problemsetProgress.problemsetId, badge.problemsetId))
  const eligibleIds = progresses.filter((item) => eligibleForBadge(badge, item)).map((item) => item.userId)
  await db.transaction(async (tx) => {
    await tx.delete(schema.userBadge).where(and(
      eq(schema.userBadge.badgeId, badge.id),
      eligibleIds.length ? notInArray(schema.userBadge.userId, eligibleIds) : undefined,
    ))
    if (!eligibleIds.length) return
    const existing = await tx.select({ userId: schema.userBadge.userId }).from(schema.userBadge)
      .where(eq(schema.userBadge.badgeId, badge.id))
    const have = new Set(existing.map((item) => item.userId))
    const missing = eligibleIds.filter((id) => !have.has(id))
    if (missing.length) {
      await tx.insert(schema.userBadge).values(missing.map((userId) => ({
        userId,
        badgeId: badge.id,
        earnedTime: new Date().toISOString(),
      })))
    }
  })
}

/**
 * 题目集或分值变动后，把所有参与者的进度整体重算一遍，再重算这份题单的奖章。
 *
 * 旧后端两件事都不做：往题单里加一道题，学生那边的 totalProblemsCount 还是老数字，
 * 进度百分比因此偏高；奖章那边更是没人回头判过，生产快照里因此攒下 53 条应发未发
 * （30 名学生，其中 23 条来自 2026-05-22 那次批量补进度）。
 */
export async function resyncProgress(problemsetId: number) {
  const [links, progresses, badges] = await Promise.all([
    db.select({ problemId: schema.problemsetProblem.problemId, score: schema.problemsetProblem.score })
      .from(schema.problemsetProblem).where(eq(schema.problemsetProblem.problemsetId, problemsetId)),
    db.select().from(schema.problemsetProgress)
      .where(eq(schema.problemsetProgress.problemsetId, problemsetId)),
    db.select().from(schema.problemsetBadge)
      .where(eq(schema.problemsetBadge.problemsetId, problemsetId)),
  ])
  const now = new Date().toISOString()
  const updated = progresses.map((progress) => ({
    ...progress,
    ...computeProgress(objectValue(progress.progressDetail), links, progress.completeTime, now),
  }))
  if (updated.length) await writeProgress(updated)
  for (const badge of badges) await recalculateBadge(badge, updated)
}

/** 按奖章算出「现在应该有谁」，只读，供补发脚本先看后写 */
export async function badgeHolderDiff(badge: BadgeRow) {
  const [progresses, holders] = await Promise.all([
    db.select().from(schema.problemsetProgress)
      .where(eq(schema.problemsetProgress.problemsetId, badge.problemsetId)),
    db.select({ userId: schema.userBadge.userId }).from(schema.userBadge)
      .where(eq(schema.userBadge.badgeId, badge.id)),
  ])
  const eligible = new Set(progresses.filter((item) => eligibleForBadge(badge, item)).map((item) => item.userId))
  const have = new Set(holders.map((item) => item.userId))
  return {
    missing: [...eligible].filter((id) => !have.has(id)),
    extra: [...have].filter((id) => !eligible.has(id)),
    eligible: eligible.size,
    held: have.size,
  }
}

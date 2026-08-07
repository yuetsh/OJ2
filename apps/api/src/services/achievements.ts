import { and, count, countDistinct, eq, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { publishAchievementNotification } from "../events"
import { findMetric } from "./achievement-metrics"
import { isAccepted, JudgeStatus } from "../judge/status"
import { objectValue } from "../routes/helpers"

function numberMetric(metrics: Record<string, unknown>, key: string) {
  const value = metrics[key]
  return typeof value === "number" ? value : 0
}

function localDate(value: string) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

async function unlockAchievements(userId: number, metrics: Record<string, unknown>, onlyMeta = false) {
  const unlocked = await db.select({ id: schema.userAchievement.achievementId }).from(schema.userAchievement)
    .where(eq(schema.userAchievement.userId, userId))
  const filters = [eq(schema.achievement.visible, true)]
  if (unlocked.length) filters.push(notInArray(schema.achievement.id, unlocked.map((row) => row.id)))
  if (onlyMeta) filters.push(eq(schema.achievement.metric, "achievement_unlocked_count"))
  else filters.push(ne(schema.achievement.metric, "achievement_unlocked_count"))
  const candidates = await db.select().from(schema.achievement).where(and(...filters))
  const created: typeof schema.achievement.$inferSelect[] = []
  for (const achievement of candidates) {
    const value = metrics[achievement.metric]
    if (typeof value !== "number") continue
    const hit = achievement.operator === "gte" ? value >= achievement.threshold : value <= achievement.threshold
    if (!hit) continue
    const inserted = await db.insert(schema.userAchievement).values({
      userId,
      achievementId: achievement.id,
      unlockTime: new Date().toISOString(),
      backfilled: false,
      notified: false,
    }).onConflictDoNothing({ target: [schema.userAchievement.achievementId, schema.userAchievement.userId] }).returning({ id: schema.userAchievement.id })
    if (inserted.length) {
      await db.update(schema.achievement).set({ unlockCount: sql`${schema.achievement.unlockCount} + 1` }).where(eq(schema.achievement.id, achievement.id))
      created.push(achievement)
    }
  }
  return created
}

export async function updateAchievementsForSubmission(submissionId: string) {
  const [row] = await db.select({ submission: schema.submission, problem: schema.problem }).from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .where(eq(schema.submission.id, submissionId)).limit(1)
  if (!row || row.submission.contestId !== null) return []

  const priorRows = await db.select({ result: schema.submission.result }).from(schema.submission).where(and(
    eq(schema.submission.userId, row.submission.userId),
    eq(schema.submission.problemId, row.submission.problemId),
    isNull(schema.submission.contestId),
    ne(schema.submission.id, row.submission.id),
  ))
  const priorAccepted = priorRows.some((item) => isAccepted(item.result))
  const accepted = isAccepted(row.submission.result)
  const firstAc = accepted && !priorAccepted
  const firstTry = accepted && priorRows.length === 0
  const date = localDate(row.submission.createTime)
  const hour = new Date(row.submission.createTime).getHours()

  const metrics = await db.transaction(async (tx) => {
    await tx.insert(schema.userStat).values({
      userId: row.submission.userId,
      metrics: {},
      updateTime: new Date().toISOString(),
    }).onConflictDoNothing({ target: schema.userStat.userId })
    const [stat] = await tx.select().from(schema.userStat).where(eq(schema.userStat.userId, row.submission.userId)).for("update")
    if (!stat) throw new Error("User achievement stat could not be created")
    const value = objectValue(stat.metrics)
    value.submission_count = numberMetric(value, "submission_count") + 1
    if (firstAc) {
      value.accepted_count = numberMetric(value, "accepted_count") + 1
      if (row.problem.difficulty === "Mid") value.mid_ac_count = numberMetric(value, "mid_ac_count") + 1
      if (row.problem.difficulty === "High") value.hard_ac_count = numberMetric(value, "hard_ac_count") + 1
      if (firstTry) value.first_try_ac_count = numberMetric(value, "first_try_ac_count") + 1
      value.max_wa_before_ac = Math.max(numberMetric(value, "max_wa_before_ac"), priorRows.length)
      const perDay = objectValue(value._ac_per_day)
      perDay[date] = (typeof perDay[date] === "number" ? perDay[date] : 0) + 1
      value._ac_per_day = perDay
      value.max_ac_in_one_day = Math.max(...Object.values(perDay).filter((item): item is number => typeof item === "number"))
    }
    const activeDates = Array.isArray(value._active_dates) ? value._active_dates.filter((item): item is string => typeof item === "string") : []
    if (!activeDates.includes(date)) activeDates.push(date)
    value._active_dates = activeDates
    value.active_days = activeDates.length
    if (accepted) {
      const last = typeof value._last_ac_date === "string" ? value._last_ac_date : null
      if (last !== date) {
        const current = last && (Date.parse(`${date}T00:00:00`) - Date.parse(`${last}T00:00:00`)) / 86_400_000 === 1
          ? numberMetric(value, "_current_ac_streak") + 1
          : 1
        value._last_ac_date = date
        value._current_ac_streak = current
        value.max_ac_streak_days = Math.max(numberMetric(value, "max_ac_streak_days"), current)
      }
    }
    const languages = Array.isArray(value._languages) ? value._languages.filter((item): item is string => typeof item === "string") : []
    if (!languages.includes(row.submission.language)) languages.push(row.submission.language)
    value._languages = languages
    value.languages_used = languages.length
    if (hour < 5) value.midnight_submissions = numberMetric(value, "midnight_submissions") + 1
    else if (hour < 7) value.early_bird_submissions = numberMetric(value, "early_bird_submissions") + 1
    if (row.submission.result === JudgeStatus.COMPILE_ERROR) value.compile_error_count = numberMetric(value, "compile_error_count") + 1
    value.max_code_lines = Math.max(numberMetric(value, "max_code_lines"), row.submission.code.split(/\r?\n/).length)
    await tx.update(schema.userStat).set({ metrics: value, updateTime: new Date().toISOString() }).where(eq(schema.userStat.id, stat.id))
    return value
  })

  const first = await unlockAchievements(row.submission.userId, metrics)
  if (!first.length) return []
  const [meta] = await db.select({ value: count() }).from(schema.userAchievement)
    .innerJoin(schema.achievement, eq(schema.userAchievement.achievementId, schema.achievement.id))
    .where(and(eq(schema.userAchievement.userId, row.submission.userId), ne(schema.achievement.rarity, "platinum")))
  metrics.achievement_unlocked_count = meta?.value ?? 0
  await db.update(schema.userStat).set({ metrics, updateTime: new Date().toISOString() }).where(eq(schema.userStat.userId, row.submission.userId))
  return [...first, ...(await unlockAchievements(row.submission.userId, metrics, true))]
}

export async function updateAchievementsForProblemSet(userId: number) {
  const [[badgeRow], [completedRow]] = await Promise.all([
    db.select({ value: count() }).from(schema.userBadge).where(eq(schema.userBadge.userId, userId)),
    db.select({ value: count() }).from(schema.problemsetProgress).where(and(
      eq(schema.problemsetProgress.userId, userId),
      eq(schema.problemsetProgress.isCompleted, true),
    )),
  ])
  const metrics = await db.transaction(async (tx) => {
    await tx.insert(schema.userStat).values({
      userId,
      metrics: {},
      updateTime: new Date().toISOString(),
    }).onConflictDoNothing({ target: schema.userStat.userId })
    const [stat] = await tx.select().from(schema.userStat)
      .where(eq(schema.userStat.userId, userId)).for("update").limit(1)
    if (!stat) throw new Error("User achievement stat could not be created")
    const value = objectValue(stat.metrics)
    value.badge_count = badgeRow?.value ?? 0
    value.problemset_completed = completedRow?.value ?? 0
    await tx.update(schema.userStat).set({ metrics: value, updateTime: new Date().toISOString() })
      .where(eq(schema.userStat.id, stat.id))
    return value
  })

  const first = await unlockAchievements(userId, metrics)
  if (!first.length) return []
  const [meta] = await db.select({ value: count() }).from(schema.userAchievement)
    .innerJoin(schema.achievement, eq(schema.userAchievement.achievementId, schema.achievement.id))
    .where(and(eq(schema.userAchievement.userId, userId), ne(schema.achievement.rarity, "platinum")))
  metrics.achievement_unlocked_count = meta?.value ?? 0
  await db.update(schema.userStat).set({ metrics, updateTime: new Date().toISOString() })
    .where(eq(schema.userStat.userId, userId))
  return [...first, ...(await unlockAchievements(userId, metrics, true))]
}

/**
 * 参赛场次。旧后端 `ContestJoined` 只实现了 recompute、不走 on_submission
 * （比赛提交在 build_ctx 就被跳过了），所以它只在 rescan 时刷新。这里保持同样口径：
 * 去重数一遍该用户有过提交的比赛数。
 *
 * 注意：迁移过来时新后端**整个漏掉了这个指标**，配在 contest_joined 上的成就
 * 会永远解锁不了。补上。
 */
async function contestJoinedCount(userId: number) {
  const [row] = await db
    .select({ value: countDistinct(schema.submission.contestId) })
    .from(schema.submission)
    .where(and(eq(schema.submission.userId, userId), isNotNull(schema.submission.contestId)))
  return row?.value ?? 0
}

/**
 * 新建成就、调低阈值、或从下架改成上架之后，把已达标的存量用户补发一遍。
 *
 * 判定平时只在判题结算时发生，后台改了配置不会自动补发，必须显式扫。
 * 对齐旧 `rescan_achievement`：只处理 visible 的成就，逐个用户 unlock，
 * 且标记 backfilled=true —— 这是补发不是刚挣到的，前端据此只显示「已获得」
 * 而不显示日期，否则一次补发会给几百人盖同一个时间戳，把「最近获得」板块冲垮。
 */
export async function rescanAchievement(achievementId: number) {
  const [achievement] = await db.select().from(schema.achievement)
    .where(and(eq(schema.achievement.id, achievementId), eq(schema.achievement.visible, true))).limit(1)
  if (!achievement) return { scanned: 0, unlocked: 0 }

  const metric = findMetric(achievement.metric)
  if (!metric) return { scanned: 0, unlocked: 0 }

  // contest_joined 不由判题结算维护，扫之前先把它刷新一遍，否则永远读到旧值（或没有值）
  if (achievement.metric === "contest_joined") await refreshContestJoinedForAll()

  const already = new Set(
    (await db.select({ userId: schema.userAchievement.userId }).from(schema.userAchievement)
      .where(eq(schema.userAchievement.achievementId, achievement.id))).map((row) => row.userId),
  )

  const stats = await db.select({ userId: schema.userStat.userId, metrics: schema.userStat.metrics })
    .from(schema.userStat)
  let unlocked = 0
  for (const stat of stats) {
    if (already.has(stat.userId)) continue
    const value = objectValue(stat.metrics)[achievement.metric]
    if (typeof value !== "number") continue
    const hit = achievement.operator === "gte"
      ? value >= achievement.threshold
      : value <= achievement.threshold
    if (!hit) continue
    const inserted = await db.insert(schema.userAchievement).values({
      userId: stat.userId,
      achievementId: achievement.id,
      unlockTime: new Date().toISOString(),
      backfilled: true,
      notified: false,
    }).onConflictDoNothing({ target: [schema.userAchievement.achievementId, schema.userAchievement.userId] })
      .returning({ id: schema.userAchievement.id })
    if (inserted.length === 0) continue
    unlocked += 1
    await db.update(schema.achievement)
      .set({ unlockCount: sql`${schema.achievement.unlockCount} + 1` })
      .where(eq(schema.achievement.id, achievement.id))
    await publishAchievementNotification(stat.userId, [{
      id: achievement.id,
      name: achievement.name,
      description: achievement.description,
      icon: achievement.icon,
      rarity: achievement.rarity,
      kind: "achievement",
    }])
  }
  return { scanned: stats.length, unlocked }
}

/** 把所有有过比赛提交的用户的 contest_joined 重算一遍，供 rescan 前置调用 */
async function refreshContestJoinedForAll() {
  const rows = await db
    .selectDistinct({ userId: schema.submission.userId })
    .from(schema.submission)
    .where(isNotNull(schema.submission.contestId))
  for (const { userId } of rows) {
    const value = await contestJoinedCount(userId)
    await db.transaction(async (tx) => {
      await tx.insert(schema.userStat).values({
        userId,
        metrics: {},
        updateTime: new Date().toISOString(),
      }).onConflictDoNothing({ target: schema.userStat.userId })
      const [stat] = await tx.select().from(schema.userStat)
        .where(eq(schema.userStat.userId, userId)).for("update").limit(1)
      if (!stat) return
      const merged = objectValue(stat.metrics)
      merged.contest_joined = value
      await tx.update(schema.userStat)
        .set({ metrics: merged, updateTime: new Date().toISOString() })
        .where(eq(schema.userStat.id, stat.id))
    })
  }
}

import { and, count, eq, isNull, ne, notInArray, sql } from "drizzle-orm"

import { db, schema } from "../db"
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

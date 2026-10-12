import {
  markAchievementsReadSchema,
  STUDENT_ROLES,
  type Achievement,
  type AchievementClassBoard,
  type AchievementList,
  type PendingAchievement,
} from "@oj2/contract"
import { and, asc, count, desc, eq, inArray, isNull, max } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, parseBody, success } from "../http"
import { currentWeekStreak } from "../services/problem-progress"
import { asRecord } from "./helpers"

export const achievementRoutes = new Hono<AppEnv>()

async function resolveUser(requested: string | undefined, currentId: number) {
  if (!requested) {
    const [current] = await db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        className: schema.user.className,
      })
      .from(schema.user)
      .where(eq(schema.user.id, currentId))
      .limit(1)
    return current ?? null
  }
  const [target] = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      className: schema.user.className,
    })
    .from(schema.user)
    .where(and(eq(schema.user.username, requested), eq(schema.user.isDisabled, false)))
    .limit(1)
  return target ?? null
}

function pendingData(row: { achievement: typeof schema.achievement.$inferSelect }) {
  return {
    id: row.achievement.id,
    name: row.achievement.name,
    description: row.achievement.description,
    icon: row.achievement.icon,
    rarity: row.achievement.rarity,
  } satisfies PendingAchievement
}

achievementRoutes.get("/achievements", requireAuth, async (c) => {
  const me = c.get("user")!
  const target = await resolveUser(c.req.query("username"), me.id)
  if (!target) return failure(c, 404, "user-not-found", "用户不存在")
  const [achievements, unlockedRows, statRows] = await Promise.all([
    db
      .select()
      .from(schema.achievement)
      .where(eq(schema.achievement.visible, true))
      .orderBy(asc(schema.achievement.order), asc(schema.achievement.id)),
    db.select().from(schema.userAchievement).where(eq(schema.userAchievement.userId, target.id)),
    db
      .select({ metrics: schema.userStat.metrics })
      .from(schema.userStat)
      .where(eq(schema.userStat.userId, target.id))
      .limit(1),
  ])
  const unlocked = new Map(unlockedRows.map((row) => [row.achievementId, row]))
  const metrics = asRecord(statRows[0]?.metrics)
  const weekStreak = currentWeekStreak(metrics)
  // 隐藏的成就：同一个指标上拿到过一档，这一串就整串亮出来（拿到「一发入魂」就看得到「神射手」）
  const revealedMetrics = new Set(
    achievements.filter((item) => unlocked.has(item.id)).map((item) => item.metric),
  )
  const classHolders = target.className
    ? new Map(
        (
          await db
            .select({ id: schema.userAchievement.achievementId, n: count() })
            .from(schema.userAchievement)
            .innerJoin(schema.user, eq(schema.user.id, schema.userAchievement.userId))
            .where(classMembers(target.className))
            .groupBy(schema.userAchievement.achievementId)
        ).map((row) => [row.id, row.n]),
      )
    : null
  const result = achievements.map((achievement) => {
    const record = unlocked.get(achievement.id)
    const masked = achievement.hidden && !record && !revealedMetrics.has(achievement.metric)
    const progress =
      achievement.metric === "max_ac_week_streak" ? weekStreak : metrics[achievement.metric]
    return {
      id: achievement.id,
      name: masked ? "???" : achievement.name,
      description: masked ? "达成条件保密" : achievement.description,
      icon: masked ? "noto:red-question-mark" : achievement.icon,
      rarity: achievement.rarity,
      hidden: achievement.hidden,
      metric: masked ? null : achievement.metric,
      operator: masked ? null : achievement.operator,
      threshold: masked ? null : achievement.threshold,
      unlocked: Boolean(record),
      unlockTime: record?.unlockTime ?? null,
      backfilled: record?.backfilled ?? false,
      progress: masked ? null : typeof progress === "number" ? progress : 0,
      holders: achievement.unlockCount,
      classHolders: classHolders ? (classHolders.get(achievement.id) ?? 0) : null,
    } satisfies Achievement
  })
  const classBoard = target.id === me.id && target.className ? await buildClassBoard(target) : null
  return success(c, {
    username: target.username,
    achievements: result,
    classBoard,
  } satisfies AchievementList)
})

/** 本班 = 同一个班级的学生（含学生管理员），停用的不算 */
function classMembers(className: string) {
  return and(
    eq(schema.user.className, className),
    inArray(schema.user.adminType, [...STUDENT_ROLES]),
    eq(schema.user.isDisabled, false),
  )
}

const CLASS_RECENT = 5
const CLASS_MOST = 5

async function buildClassBoard(target: {
  id: number
  className: string | null
}): Promise<AchievementClassBoard> {
  const className = target.className!
  const [recent, counts] = await Promise.all([
    db
      .select({
        username: schema.user.username,
        achievementId: schema.userAchievement.achievementId,
        unlockTime: schema.userAchievement.unlockTime,
      })
      .from(schema.userAchievement)
      .innerJoin(schema.user, eq(schema.user.id, schema.userAchievement.userId))
      .innerJoin(
        schema.achievement,
        eq(schema.achievement.id, schema.userAchievement.achievementId),
      )
      .where(
        and(
          classMembers(className),
          eq(schema.achievement.visible, true),
          eq(schema.userAchievement.backfilled, false),
        ),
      )
      .orderBy(desc(schema.userAchievement.unlockTime))
      .limit(CLASS_RECENT),
    // 不计入排名的人（老师在排名里关掉的）也不进「成就最多」
    db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        count: count(schema.achievement.id),
        last: max(schema.userAchievement.unlockTime),
      })
      .from(schema.user)
      .leftJoin(schema.userAchievement, eq(schema.userAchievement.userId, schema.user.id))
      .leftJoin(
        schema.achievement,
        and(
          eq(schema.achievement.id, schema.userAchievement.achievementId),
          eq(schema.achievement.visible, true),
        ),
      )
      .where(and(classMembers(className), isNull(schema.user.rankHiddenAt)))
      .groupBy(schema.user.id, schema.user.username),
  ])
  // 一样多的名次相同；同名次里先拿到的（最后一个成就拿得早的）排前面
  counts.sort(
    (a, b) =>
      b.count - a.count ||
      (a.last ?? "").localeCompare(b.last ?? "") ||
      a.username.localeCompare(b.username),
  )
  const ranked = counts.map((row) => ({
    ...row,
    rank: counts.findIndex((other) => other.count === row.count) + 1,
  }))
  const top = ranked.slice(0, CLASS_MOST)
  const mine = ranked.find((row) => row.id === target.id)
  return {
    className,
    recent,
    most: top.map((row) => ({ username: row.username, count: row.count, rank: row.rank })),
    me:
      mine && !top.some((row) => row.id === target.id)
        ? { rank: mine.rank, count: mine.count }
        : null,
  }
}

achievementRoutes.get("/achievements/pending", requireAuth, async (c) => {
  const rows = await db
    .select({ record: schema.userAchievement, achievement: schema.achievement })
    .from(schema.userAchievement)
    .innerJoin(schema.achievement, eq(schema.userAchievement.achievementId, schema.achievement.id))
    .where(
      and(
        eq(schema.userAchievement.userId, c.get("user")!.id),
        eq(schema.userAchievement.notified, false),
        eq(schema.achievement.visible, true),
      ),
    )
    .orderBy(asc(schema.userAchievement.unlockTime))
  return success(c, rows.map(pendingData))
})

achievementRoutes.post("/achievements/pending/read", requireAuth, async (c) => {
  const parsed = await parseBody(c, markAchievementsReadSchema, "Invalid achievement ids")
  if (!parsed.success) return parsed.response
  if (parsed.data.ids.length > 0) {
    await db
      .update(schema.userAchievement)
      .set({ notified: true })
      .where(
        and(
          eq(schema.userAchievement.userId, c.get("user")!.id),
          inArray(schema.userAchievement.achievementId, parsed.data.ids),
        ),
      )
  }
  return success(c, null)
})

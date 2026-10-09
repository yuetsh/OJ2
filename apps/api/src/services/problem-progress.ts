import { FLOWCHART_PASS_GRADES, type ProblemProgress } from "@oj2/contract"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { isAccepted, UNJUDGED_RESULTS } from "../judge/status"
import { asRecord } from "../routes/helpers"
import { calendarDay, dayNumber, dayText, weekStart } from "../time"
import { accepted } from "./learning-stats"

/**
 * 一个人在公开题库里的做题状态：做对了哪些、交过哪些。
 *
 * 代码看 `acm_problems_status`（列表的状态列一直就是它）；画流程图的题，流程图评到
 * A / S 也算做对、交过流程图就算交过 —— 和题单、课堂条一个口径（题目页设计文档
 * 第 3 节决定 6）。有的题一节课全班都在画流程图，只看代码的话状态列是空的。
 */
export async function problemStates(userId: number) {
  const [[profile], flowRows] = await Promise.all([
    db
      .select({ value: schema.userProfile.acmProblemsStatus })
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, userId))
      .limit(1),
    db
      .select({
        problemId: schema.flowchartSubmission.problemId,
        passed: sql<boolean>`bool_or(${schema.flowchartSubmission.status} = 2 and ${inArray(
          schema.flowchartSubmission.aiGrade,
          [...FLOWCHART_PASS_GRADES],
        )})`,
      })
      .from(schema.flowchartSubmission)
      .where(eq(schema.flowchartSubmission.userId, userId))
      .groupBy(schema.flowchartSubmission.problemId),
  ])
  const solved = new Set<number>()
  const tried = new Set<number>()
  for (const [key, raw] of Object.entries(asRecord(asRecord(profile?.value).problems))) {
    const id = Number(key)
    const status = asRecord(raw).status
    if (!Number.isInteger(id) || typeof status !== "number") continue
    tried.add(id)
    if (isAccepted(status)) solved.add(id)
  }
  for (const row of flowRows) {
    tried.add(row.problemId)
    if (row.passed) solved.add(row.problemId)
  }
  return { solved, tried }
}

/**
 * 每道题做对 / 交过的人数，和题目页「统计」页签（`problem-stats.ts`）同一个口径：
 * 代码提交，不算还在判的，AST_CHECK_FAILED 也是做对。不传 ids 就是全部题（排序用，全表约 85ms）。
 */
export async function problemUserCounts(problemIds?: number[]) {
  const result = new Map<number, { solved: number; tried: number }>()
  if (problemIds && problemIds.length === 0) return result
  const rows = await db
    .select({
      problemId: schema.submission.problemId,
      solved: sql<number>`count(distinct ${schema.submission.userId}) filter (where ${inArray(
        schema.submission.result,
        accepted,
      )})`.mapWith(Number),
      tried: sql<number>`count(distinct ${schema.submission.userId})`.mapWith(Number),
    })
    .from(schema.submission)
    .where(
      and(
        isNull(schema.submission.contestId),
        sql`${schema.submission.result} not in (${sql.join(
          UNJUDGED_RESULTS.map((value) => sql`${value}`),
          sql`, `,
        )})`,
        problemIds ? inArray(schema.submission.problemId, problemIds) : undefined,
      ),
    )
    .groupBy(schema.submission.problemId)
  for (const row of rows) result.set(row.problemId, { solved: row.solved, tried: row.tried })
  return result
}

/**
 * 顶行提示哪个成就。只挑做题能推动的几项（提交次数、编译错误这类不该鼓励），
 * 隐藏成就不提示（会泄露门槛），完成比例最高的那个；一样高按下面的先后挑 ——
 * 新生所有成就都是 0，不按先后的话会挑中「做对 1 道困难题」，把刚来的人往最难的题上引。
 */
const HINT_METRICS = [
  "accepted_count",
  "mid_ac_count",
  "hard_ac_count",
  "active_days",
  "max_ac_week_streak",
]

function numberOf(metrics: Record<string, unknown>, key: string) {
  const value = metrics[key]
  return typeof value === "number" ? value : 0
}

export async function buildProblemProgress(userId: number): Promise<ProblemProgress> {
  const [states, statRows, achievements, unlockedRows] = await Promise.all([
    problemStates(userId),
    db
      .select({ metrics: schema.userStat.metrics })
      .from(schema.userStat)
      .where(eq(schema.userStat.userId, userId))
      .limit(1),
    db
      .select()
      .from(schema.achievement)
      .where(
        and(
          eq(schema.achievement.visible, true),
          eq(schema.achievement.hidden, false),
          eq(schema.achievement.operator, "gte"),
          inArray(schema.achievement.metric, HINT_METRICS),
        ),
      ),
    db
      .select({ id: schema.userAchievement.achievementId })
      .from(schema.userAchievement)
      .where(eq(schema.userAchievement.userId, userId)),
  ])
  const metrics = asRecord(statRows[0]?.metrics)

  // 只数公开可见的题：隐藏题、比赛题在左栏里本来就不出现
  const visibleRows = await db
    .select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      title: schema.problem.title,
    })
    .from(schema.problem)
    .where(and(eq(schema.problem.visible, true), isNull(schema.problem.contestId)))
    .orderBy(asc(sql`length(${schema.problem.displayId})`), asc(schema.problem.displayId))
  const visible = new Set(visibleRows.map((row) => row.id))
  const solvedVisible = [...states.solved].filter((id) => visible.has(id))
  const byTag: Record<string, number> = {}
  if (solvedVisible.length > 0) {
    const rows = await db
      .select({
        tagId: schema.problemTags.problemtagId,
        n: sql<number>`count(*)`.mapWith(Number),
      })
      .from(schema.problemTags)
      .where(inArray(schema.problemTags.problemId, solvedVisible))
      .groupBy(schema.problemTags.problemtagId)
    for (const row of rows) byTag[String(row.tagId)] = row.n
  }
  const almost = visibleRows
    .filter((row) => states.tried.has(row.id) && !states.solved.has(row.id))
    .map((row) => ({ _id: row.displayId, title: row.title }))

  // 这周：_ac_per_day 的键是东八区日历日，周一起算（和周榜、连续周数同一个口径）
  const monday = calendarDay(weekStart())
  let weekSolved = 0
  for (const [day, n] of Object.entries(asRecord(metrics._ac_per_day))) {
    if (day >= monday && typeof n === "number") weekSolved += n
  }
  // 当前连续周数只在最近一次新通过落在本周或上周时还作数，再早就已经断了
  const lastWeek = typeof metrics._last_ac_week === "string" ? metrics._last_ac_week : ""
  const previousMonday = dayText(dayNumber(monday) - 7)
  const weekStreak =
    lastWeek === monday || lastWeek === previousMonday
      ? numberOf(metrics, "_current_ac_week_streak")
      : 0

  const unlocked = new Set(unlockedRows.map((row) => row.id))
  let next: ProblemProgress["next"] = null
  let best = -1
  for (const achievement of achievements) {
    if (unlocked.has(achievement.id) || achievement.threshold <= 0) continue
    // 连续周数看的是「现在连着几周」，不是历史最长：断过的人从头数
    const progress =
      achievement.metric === "max_ac_week_streak"
        ? weekStreak
        : numberOf(metrics, achievement.metric)
    if (progress >= achievement.threshold) continue
    const ratio = progress / achievement.threshold
    // 一样高：先按指标先后，同一个指标挑门槛低的（「初出茅庐」而不是「渐入佳境」）
    const order = HINT_METRICS.indexOf(achievement.metric)
    const tie =
      next !== null &&
      ratio === best &&
      (order < HINT_METRICS.indexOf(next.metric) ||
        (achievement.metric === next.metric && achievement.threshold < next.threshold))
    if (ratio > best || tie) {
      best = ratio
      next = {
        name: achievement.name,
        icon: achievement.icon,
        rarity: achievement.rarity,
        metric: achievement.metric,
        threshold: achievement.threshold,
        progress,
      }
    }
  }

  return {
    solved: numberOf(metrics, "accepted_count"),
    weekSolved,
    weekStreak,
    almost,
    byTag,
    next,
  }
}

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { localTime, TIME_ZONE } from "../time"

/**
 * 一次性数据对账：把「夜猫子」「早起的鸟儿」的历史发放与真实提交时间对齐。
 *
 * ## 背景
 *
 * 2026-08-26 OJ2 上线到 2026-09-14 修好时区之间，`services/achievements.ts` 用
 * `new Date(createTime).getHours()` 判定，而容器是 UTC —— 于是 **UTC 的「凌晨 0–5 点」
 * 其实是北京时间的上午 9–13 点**，学生在上课时间提交被记成熬夜；
 * 「5–7 点」对应北京下午 1–3 点，被记成早起。
 *
 * 旧 Django 栈用的是 `timezone.localtime()`（`TIME_ZONE = "Asia/Shanghai"`），
 * 所以 2022–2026.08 的历史数据**本来就是东八区口径、本来就是对的**。
 * 出问题的只有 OJ2 那两周的增量。
 *
 * ## 为什么不能只删 `user_achievement`
 *
 * `unlockAchievements()` 的判定是**纯粹的阈值比较**（`metrics[metric] >= threshold`），
 * 不是「这次有没有跨过阈值」。所以只要 `user_stat.metrics.midnight_submissions`
 * 还留着虚高的 13，把成就行删掉之后，学生**下一次提交就会原样再发一次**。
 *
 * 必须一起做：按东八区重算小时指标写回 user_stat，再对账发放。
 *
 * ## 两个方向
 *
 * - **撤回**：重算后不达标却持有 → 删行 + `achievement.unlock_count` 下调。
 * - **补发**：重算后达标却没持有 → 插行（`backfilled = true`，前端显示「已获得」
 *   而不编一个解锁时间）+ 计数上调。
 *
 * 2026-09-14 的实测结论：**只有撤回（60 条），补发 0 条** —— 原因是 OJ2 窗口内
 * 1508 条提交里，真正落在北京 0–5 点和 5–7 点的**都是 0 条**（真熬夜的人都在
 * Django 时代活跃过了）。补发分支留着是为了对称和以后重跑，不是为了现在有用。
 *
 * ## 跑法（对齐 migrate / recount：跟着二进制走，生产镜像里没有 bun 也没有源码）
 *
 *   # 本机开发
 *   bun apps/api/src/main.ts fix-achievement-hours
 *   bun apps/api/src/main.ts fix-achievement-hours --apply
 *
 *   # 服务器 / 机房（docker/ 目录下，或照 deploy.sh 用 -f 指定）
 *   docker compose -f docker/compose.debian.yml --env-file docker/.env \
 *     run --rm oj-api oj2-api fix-achievement-hours
 *   # 确认无误后再加 --apply
 *
 * ⚠️ **必须先部署时区修复，再跑这个脚本。** 反过来的话旧代码还在按 UTC 累加，
 * 跑完马上又被写脏、成就又发回来。
 *
 * ⚠️ **--apply 要挑没人做题的时候跑。** 差异在事务外算、事务内写；算完到写完之间
 * 要是学生交了一发并判完，那一笔的小时计数会被覆盖。落库后的复核会报「仍有 N 处差异」
 * 并以 1 退出，不会静默 —— 见到了重跑一次即可。
 *
 * 写回时**只动两个小时键**（jsonb `||` 合并），不整体覆盖 `metrics`：整体写回的是事务外
 * 读的快照，并发时会连带把 `submission_count` / `_last_ac_date` 等一起写旧，而复核只比
 * 小时指标，那种覆盖是查不出来的。
 *
 * 幂等：干净状态下再跑，报 0 处差异并以 0 退出。
 */

/** 受时区影响的小时口径指标 —— 只有这两个 */
const HOUR_METRICS = ["midnight_submissions", "early_bird_submissions"] as const

interface Target {
  id: number
  name: string
  metric: string
  threshold: number
  operator: string
}

interface Plan {
  metricFixes: Array<{ id: number; userId: number; midnight: number; earlyBird: number }>
  revoke: Array<{ userId: number; achievementId: number; name: string; held: number; actual: number }>
  grant: Array<{ userId: number; achievementId: number; name: string; actual: number }>
  cascade: Array<{ userId: number; achievementId: number; name: string; before: number; after: number }>
  targets: Target[]
  meta: Target | undefined
  touched: number[]
}

/**
 * 只读对账：算出「该改的指标 / 该撤的 / 该补的 / 连锁该撤的」。
 * 落库之后再调一次就是复核。
 */
async function audit(): Promise<Plan> {
  // 用 SQL 一次算完，口径和 apps/api/src/time.ts 完全一致（东八区墙上时钟的钟点）。
  // 只统计非比赛提交 —— 和 updateAchievementsForSubmission 的 contestId !== null 提前返回对齐。
  const hour = sql`extract(hour from ${localTime(schema.submission.createTime)})`
  const recomputed = await db
    .select({
      userId: schema.submission.userId,
      midnight: sql<number>`count(*) filter (where ${hour} < 5)`.mapWith(Number),
      earlyBird: sql<number>`count(*) filter (where ${hour} >= 5 and ${hour} < 7)`.mapWith(Number),
    })
    .from(schema.submission)
    .where(isNull(schema.submission.contestId))
    .groupBy(schema.submission.userId)
  const truth = new Map(recomputed.map((row) => [row.userId, row]))
  const actualOf = (userId: number, metric: string) => {
    const fresh = truth.get(userId)
    return (metric === "midnight_submissions" ? fresh?.midnight : fresh?.earlyBird) ?? 0
  }

  // 哪些 user_stat 的小时指标要改
  const stats = await db.select().from(schema.userStat)
  const statByUser = new Map(stats.map((row) => [row.userId, row]))
  const metricFixes: Plan["metricFixes"] = []
  for (const row of stats) {
    const fresh = truth.get(row.userId)
    const corrected = { midnight_submissions: fresh?.midnight ?? 0, early_bird_submissions: fresh?.earlyBird ?? 0 }
    const changed = HOUR_METRICS.filter((key) => (row.metrics as Record<string, unknown>)[key] !== corrected[key])
    if (changed.length) {
      metricFixes.push({ id: row.id, userId: row.userId, midnight: corrected.midnight_submissions, earlyBird: corrected.early_bird_submissions })
    }
  }

  const targets = await db
    .select({
      id: schema.achievement.id,
      name: schema.achievement.name,
      metric: schema.achievement.metric,
      threshold: schema.achievement.threshold,
      operator: schema.achievement.operator,
    })
    .from(schema.achievement)
    .where(and(eq(schema.achievement.visible, true), inArray(schema.achievement.metric, [...HOUR_METRICS])))
  const targetById = new Map(targets.map((item) => [item.id, item]))
  const met = (target: Target, userId: number) => {
    const value = actualOf(userId, target.metric)
    return target.operator === "gte" ? value >= target.threshold : value <= target.threshold
  }

  const grants = await db
    .select({ achievementId: schema.userAchievement.achievementId, userId: schema.userAchievement.userId })
    .from(schema.userAchievement)
    .where(inArray(schema.userAchievement.achievementId, targets.map((item) => item.id)))
  const heldByUser = new Map<number, Set<number>>()
  for (const grant of grants) {
    heldByUser.set(grant.userId, (heldByUser.get(grant.userId) ?? new Set()).add(grant.achievementId))
  }

  const revoke: Plan["revoke"] = []
  for (const grant of grants) {
    const target = targetById.get(grant.achievementId)
    if (!target || met(target, grant.userId)) continue
    revoke.push({
      userId: grant.userId,
      achievementId: grant.achievementId,
      name: target.name,
      held: Number((statByUser.get(grant.userId)?.metrics as Record<string, unknown> | undefined)?.[target.metric] ?? 0),
      actual: actualOf(grant.userId, target.metric),
    })
  }

  // 补发只针对「被成就系统结算过」的用户（有 user_stat 行）—— 从没结算过的是另一件事
  // （备份里还有 31 个有提交却没有 user_stat 行的用户），不在这个脚本的职责内。
  const grant: Plan["grant"] = []
  for (const target of targets) {
    for (const userId of truth.keys()) {
      if (!statByUser.has(userId)) continue
      if (heldByUser.get(userId)?.has(target.id)) continue
      if (!met(target, userId)) continue
      grant.push({ userId, achievementId: target.id, name: target.name, actual: actualOf(userId, target.metric) })
    }
  }

  // 连锁：`achievement_unlocked_count` = 「已解锁的非白金成就数」，是 奖杯收藏家 的判据。
  // 撤回会让它降、补发会让它升；降破了阈值的 奖杯收藏家 要一起撤。
  const touched = [...new Set([...revoke.map((item) => item.userId), ...grant.map((item) => item.userId)])]
  const meta = (
    await db
      .select({
        id: schema.achievement.id,
        name: schema.achievement.name,
        metric: schema.achievement.metric,
        threshold: schema.achievement.threshold,
        operator: schema.achievement.operator,
      })
      .from(schema.achievement)
      .where(and(eq(schema.achievement.visible, true), eq(schema.achievement.metric, "achievement_unlocked_count")))
  )[0]

  const cascade: Plan["cascade"] = []
  if (meta && touched.length) {
    const unlocked = await db
      .select({
        userId: schema.userAchievement.userId,
        achievementId: schema.userAchievement.achievementId,
        rarity: schema.achievement.rarity,
      })
      .from(schema.userAchievement)
      .innerJoin(schema.achievement, eq(schema.userAchievement.achievementId, schema.achievement.id))
    const held = new Map<number, Array<{ achievementId: number; rarity: string }>>()
    for (const row of unlocked) {
      const list = held.get(row.userId) ?? []
      list.push({ achievementId: row.achievementId, rarity: row.rarity })
      held.set(row.userId, list)
    }
    for (const userId of touched) {
      const mine = held.get(userId) ?? []
      const gone = new Set(revoke.filter((item) => item.userId === userId).map((item) => item.achievementId))
      const coming = new Set(grant.filter((item) => item.userId === userId).map((item) => item.achievementId))
      const before = mine.filter((item) => item.rarity !== "platinum").length
      const after = mine.filter((item) => item.rarity !== "platinum" && !gone.has(item.achievementId)).length + coming.size
      if (before === after) continue
      const holdsMeta = mine.some((item) => item.achievementId === meta.id)
      const ok = meta.operator === "gte" ? after >= meta.threshold : after <= meta.threshold
      if (holdsMeta && !ok) cascade.push({ userId, achievementId: meta.id, name: meta.name, before, after })
    }
  }

  return { metricFixes, revoke, grant, cascade, targets, meta, touched }
}

function report(plan: Plan) {
  console.log(`① 需要修正小时指标的 user_stat 行：${plan.metricFixes.length}`)
  console.log(`② 需要【撤回】的发放：${plan.revoke.length} 条，涉及 ${new Set(plan.revoke.map((r) => r.userId)).size} 人`)
  for (const target of plan.targets) {
    console.log(`     - ${target.name}（阈值 ${target.operator} ${target.threshold}）：${plan.revoke.filter((r) => r.achievementId === target.id).length} 条`)
  }
  console.log(`③ 需要【补发】的发放：${plan.grant.length} 条，涉及 ${new Set(plan.grant.map((r) => r.userId)).size} 人`)
  for (const target of plan.targets) {
    console.log(`     - ${target.name}：${plan.grant.filter((r) => r.achievementId === target.id).length} 条`)
  }
  console.log(`④ 连带需要撤销的「${plan.meta?.name ?? "(未配置)"}」：${plan.cascade.length} 条`)
  if (plan.revoke.length <= 40) {
    for (const item of plan.revoke) console.log(`       [撤] user ${item.userId}  ${item.name}  存量 ${item.held} → 实际 ${item.actual}`)
  }
  if (plan.grant.length <= 40) {
    for (const item of plan.grant) console.log(`       [补] user ${item.userId}  ${item.name}  实际 ${item.actual}`)
  }
  for (const item of plan.cascade) console.log(`       [撤] user ${item.userId}  ${item.name}  已解锁数 ${item.before} → ${item.after}`)
}

export async function fixAchievementHours({ apply }: { apply: boolean }): Promise<number> {
  const url = process.env.DATABASE_URL ?? "postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge"
  const database = (() => {
    try {
      const parsed = new URL(url)
      return `${parsed.host}${parsed.pathname}`
    } catch {
      return "(无法解析)"
    }
  })()
  console.log(`目标库：${database}`)
  console.log(`模式：${apply ? "【真写】" : "只读预演（不改任何数据）"}`)
  console.log(`时区锚点：${TIME_ZONE}\n`)

  const plan = await audit()
  report(plan)
  if (!plan.metricFixes.length && !plan.revoke.length && !plan.grant.length && !plan.cascade.length) {
    console.log("\n复核通过：发放与真实提交时间一致，无需修改。")
    return 0
  }
  if (!apply) {
    console.log("\n（只读预演结束。确认无误后加 --apply。）")
    return 0
  }

  const { metricFixes, revoke, grant, cascade, targets, meta, touched } = plan
  await db.transaction(async (tx) => {
    for (const fix of metricFixes) {
      // 只合并两个小时键，其余指标以库里当下的值为准（见文件头「只动两个小时键」）
      await tx
        .update(schema.userStat)
        .set({
          metrics: sql`${schema.userStat.metrics} || jsonb_build_object('midnight_submissions', ${fix.midnight}::int, 'early_bird_submissions', ${fix.earlyBird}::int)`,
        })
        .where(eq(schema.userStat.id, fix.id))
    }
    for (const target of targets) {
      const ids = revoke.filter((item) => item.achievementId === target.id).map((item) => item.userId)
      if (ids.length) {
        await tx
          .delete(schema.userAchievement)
          .where(and(eq(schema.userAchievement.achievementId, target.id), inArray(schema.userAchievement.userId, ids)))
        await tx
          .update(schema.achievement)
          .set({ unlockCount: sql`greatest(${schema.achievement.unlockCount} - ${ids.length}, 0)` })
          .where(eq(schema.achievement.id, target.id))
      }
      // backfilled = true：这是事后对账补的，不编一个假的解锁时间；前端因此显示「已获得」
      const rows = grant
        .filter((item) => item.achievementId === target.id)
        .map((item) => ({ userId: item.userId, achievementId: target.id, unlockTime: new Date().toISOString(), backfilled: true, notified: false }))
      if (rows.length) {
        await tx.insert(schema.userAchievement).values(rows)
        await tx
          .update(schema.achievement)
          .set({ unlockCount: sql`${schema.achievement.unlockCount} + ${rows.length}` })
          .where(eq(schema.achievement.id, target.id))
      }
    }
    for (const item of cascade) {
      await tx
        .delete(schema.userAchievement)
        .where(and(eq(schema.userAchievement.achievementId, item.achievementId), eq(schema.userAchievement.userId, item.userId)))
      await tx
        .update(schema.achievement)
        .set({ unlockCount: sql`greatest(${schema.achievement.unlockCount} - 1, 0)` })
        .where(eq(schema.achievement.id, item.achievementId))
    }
    // 最后把 achievement_unlocked_count 校正成「对账之后实际持有的非白金数」
    if (meta && touched.length) {
      const fresh = await tx
        .select({ userId: schema.userAchievement.userId, value: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.userAchievement)
        .innerJoin(schema.achievement, eq(schema.userAchievement.achievementId, schema.achievement.id))
        .where(and(inArray(schema.userAchievement.userId, touched), ne(schema.achievement.rarity, "platinum")))
        .groupBy(schema.userAchievement.userId)
      const byUser = new Map(fresh.map((row) => [row.userId, row.value]))
      for (const userId of touched) {
        await tx
          .update(schema.userStat)
          .set({
            metrics: sql`jsonb_set(${schema.userStat.metrics}, '{achievement_unlocked_count}', ${JSON.stringify(byUser.get(userId) ?? 0)}::jsonb)`,
          })
          .where(eq(schema.userStat.userId, userId))
      }
    }
  })
  console.log(`\n已订正指标 ${metricFixes.length} 行、撤回 ${revoke.length} 条、补发 ${grant.length} 条、连锁撤销 ${cascade.length} 条，复核中……`)

  // 复核跑的是同一份 audit。还剩差异说明口径或并发写入了，必须让调用方看见非零退出码。
  const after = await audit()
  const left = after.metricFixes.length + after.revoke.length + after.grant.length + after.cascade.length
  if (left === 0) {
    console.log("复核通过：发放与真实提交时间一致。")
    return 0
  }
  console.error(`复核未通过，仍有 ${left} 处差异（多半是算完到写完之间有新提交判完，重跑一次即可）：`)
  report(after)
  return 1
}

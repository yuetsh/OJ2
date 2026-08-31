import { eq } from "drizzle-orm"

import { db, schema } from "../db"
import { objectValue } from "../routes/helpers"
import { badgeHolderDiff, computeProgress, recalculateBadge, resyncProgress } from "../services/problemset"

/**
 * 把题单的进度和奖章订正到与当前规则一致。
 *
 * 两笔历史欠账：
 *
 * 1. 奖章原本只在「学生做出一道题」那一刻发（`PUT /problem-set-progress`），进度从别的路径
 *    变了 —— 后台加减题目、旧栈的 fix_problemset_progress 批量补进度 —— 就没人回头判过达标。
 *    生产快照里 53 条应发未发、涉及 30 名学生。
 * 2. 进度的算法后来改了：分母只算必做题（选做题不再卡完成），空题单不再算完成，
 *    total_score 跟着题目分值走。已有的行要跑一遍才会按新规则重算。
 *
 * 两件事一起做，因为它们是同一笔账：进度一变，奖章达标面就跟着变，
 * 所以落库走的是 resyncProgress —— 它重算进度之后会顺手重算这份题单的全部奖章。
 *
 * 默认只读，把差异打出来；确认无误再加 --apply 落库。
 * 只要预演里出现「收回」就先停下来让人看清楚，要真的收回得显式加 --allow-revoke ——
 * user_badge 没有别处备份，earnedTime 删了就找不回来。
 *
 * 做成 main.ts 的子命令而不是独立脚本，是因为生产镜像里只有编译好的单二进制，
 * 既没有 bun 也没有源码。跑法对齐 migrate：
 *
 *   docker compose -f docker/compose.debian.yml run --rm oj-api oj2-api backfill-problemsets
 *   docker compose -f docker/compose.debian.yml run --rm oj-api oj2-api backfill-problemsets --apply
 *
 * 本机开发：bun apps/api/src/main.ts backfill-problemsets
 */
export async function backfillProblemSets(options: { apply: boolean; allowRevoke: boolean }) {
  const sets = await db.select({ id: schema.problemset.id, title: schema.problemset.title })
    .from(schema.problemset).orderBy(schema.problemset.id)
  if (sets.length === 0) {
    console.log("没有任何题单，无事可做")
    return 0
  }

  const now = new Date().toISOString()
  const report = []
  for (const set of sets) {
    const [links, progresses, badges] = await Promise.all([
      db.select({
        problemId: schema.problemsetProblem.problemId,
        score: schema.problemsetProblem.score,
        isRequired: schema.problemsetProblem.isRequired,
      }).from(schema.problemsetProblem).where(eq(schema.problemsetProblem.problemsetId, set.id)),
      db.select().from(schema.problemsetProgress)
        .where(eq(schema.problemsetProgress.problemsetId, set.id)),
      db.select().from(schema.problemsetBadge)
        .where(eq(schema.problemsetBadge.problemsetId, set.id)),
    ])
    // 按新规则重算一遍，但不落库 —— 奖章的差异要照着订正后的进度看，
    // 否则预演里报出来的名单和 --apply 之后的结果对不上
    const next = progresses.map((row) => ({
      ...row,
      ...computeProgress(objectValue(row.progressDetail), links, row.completeTime, now),
    }))
    const changed = next.filter((row, i) => {
      const was = progresses[i]!
      return was.totalProblemsCount !== row.totalProblemsCount ||
        was.completedProblemsCount !== row.completedProblemsCount ||
        was.totalScore !== row.totalScore ||
        was.isCompleted !== row.isCompleted ||
        Math.abs(was.progressPercentage - row.progressPercentage) > 0.005 ||
        was.completeTime !== row.completeTime ||
        JSON.stringify(objectValue(was.progressDetail)) !== JSON.stringify(row.progressDetail)
    })
    const newlyCompleted = next.filter((row, i) => !progresses[i]!.isCompleted && row.isCompleted).length
    const uncompleted = next.filter((row, i) => progresses[i]!.isCompleted && !row.isCompleted).length
    const badgeDiffs = []
    for (const badge of badges) badgeDiffs.push({ badge, ...(await badgeHolderDiff(badge, next)) })
    report.push({ set, changed: changed.length, newlyCompleted, uncompleted, badgeDiffs })
  }

  const progressRows = report.reduce((n, r) => n + r.changed, 0)
  const completedGain = report.reduce((n, r) => n + r.newlyCompleted, 0)
  const completedLoss = report.reduce((n, r) => n + r.uncompleted, 0)
  const missing = report.reduce((n, r) => n + r.badgeDiffs.reduce((m, d) => m + d.missing.length, 0), 0)
  const extra = report.reduce((n, r) => n + r.badgeDiffs.reduce((m, d) => m + d.extra.length, 0), 0)

  console.log(`共 ${sets.length} 个题单\n`)
  for (const r of report) {
    const lines = []
    if (r.changed) {
      lines.push(`      进度：${r.changed} 条要重算` +
        (r.newlyCompleted ? `，其中 ${r.newlyCompleted} 条未完成 → 已完成` : "") +
        (r.uncompleted ? `，${r.uncompleted} 条已完成 → 未完成` : ""))
    }
    for (const d of r.badgeDiffs) {
      if (!d.missing.length && !d.extra.length) continue
      lines.push(`      奖章[${d.badge.name}] ${d.badge.conditionType}/${d.badge.conditionValue}：` +
        `应发 ${d.eligible} / 现有 ${d.held}` +
        (d.missing.length ? `  补发 ${d.missing.length}：user ${d.missing.join(", ")}` : "") +
        (d.extra.length ? `  收回 ${d.extra.length}：user ${d.extra.join(", ")}` : ""))
    }
    if (lines.length) {
      console.log(`  题单${String(r.set.id).padStart(2)} ${r.set.title}`)
      for (const line of lines) console.log(line)
    }
  }
  console.log(`\n合计：进度 ${progressRows} 条要重算（完成 +${completedGain} / -${completedLoss}），` +
    `奖章补发 ${missing} 条、收回 ${extra} 条`)

  if (progressRows === 0 && missing === 0 && extra === 0) {
    console.log("题单数据与当前规则一致，无需订正")
    return 0
  }
  if (!options.apply) {
    console.log("\n这是只读预演，什么都没写。确认无误后加 --apply 落库。")
    return 0
  }
  if (extra > 0 && !options.allowRevoke) {
    console.error(`\n预演里有 ${extra} 条奖章要被收回，而 user_badge 没有别处备份、` +
      `earnedTime 删了就找不回来。\n确认要连同收回一起执行，加 --allow-revoke。`)
    return 1
  }

  let touched = 0
  for (const r of report) {
    if (!r.changed && !r.badgeDiffs.some((d) => d.missing.length || d.extra.length)) continue
    // resyncProgress 重算进度之后会把这份题单的奖章一并重算，两笔账一次结清
    await resyncProgress(r.set.id)
    touched += 1
  }
  // 没有参与者、只有奖章欠账的题单不会走上面那条，兜一遍
  for (const r of report) {
    for (const d of r.badgeDiffs) {
      if (d.missing.length || d.extra.length) await recalculateBadge(d.badge)
    }
  }
  console.log(`\n已订正 ${touched} 个题单，复核中……`)

  let remaining = 0
  for (const set of sets) {
    const [links, progresses, badges] = await Promise.all([
      db.select({
        problemId: schema.problemsetProblem.problemId,
        score: schema.problemsetProblem.score,
        isRequired: schema.problemsetProblem.isRequired,
      }).from(schema.problemsetProblem).where(eq(schema.problemsetProblem.problemsetId, set.id)),
      db.select().from(schema.problemsetProgress).where(eq(schema.problemsetProgress.problemsetId, set.id)),
      db.select().from(schema.problemsetBadge).where(eq(schema.problemsetBadge.problemsetId, set.id)),
    ])
    for (const row of progresses) {
      const next = computeProgress(objectValue(row.progressDetail), links, row.completeTime, now)
      if (row.isCompleted !== next.isCompleted || row.totalScore !== next.totalScore ||
        row.completedProblemsCount !== next.completedProblemsCount ||
        row.totalProblemsCount !== next.totalProblemsCount) {
        remaining += 1
        console.error(`  进度仍不一致：题单${set.id} user ${row.userId}`)
      }
    }
    for (const badge of badges) {
      const after = await badgeHolderDiff(badge)
      if (after.missing.length || after.extra.length) {
        remaining += after.missing.length + after.extra.length
        console.error(`  奖章仍不一致：题单${set.id} [${badge.name}]`, after)
      }
    }
  }
  console.log(remaining === 0 ? "复核通过：题单数据与规则一致" : `复核未通过，仍有 ${remaining} 处差异`)
  return remaining === 0 ? 0 : 1
}

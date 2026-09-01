import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { JudgeStatus } from "../judge/status"
import { objectValue } from "../routes/helpers"
import { badgeHolderDiff, computeProgress, recalculateBadge, resyncProgress } from "../services/problemset"

/**
 * 把题单的进度和奖章订正到与当前规则一致。三笔历史欠账，一趟结清：
 *
 * 1. **进度漏记**。判题这一路记账（services/problemset.ts 的 recordSolvedProblem）是后来才有的，
 *    在那之前靠前端 AC 之后回调，只认路由参数里那一个题单：从普通题库入口做出同一道题不计进度，
 *    网络一抖就静默丢失。这里按实际 AC 记录补回来 —— 移植自旧栈的管理命令
 *    `problemset/management/commands/fix_problemset_progress.py`。
 * 2. **奖章漏发**。奖章原本只在学生做出一道题那一刻发，进度从别的路径变了就没人回头判过达标。
 *    生产快照里 53 条应发未发、涉及 30 名学生 —— 其中 23 条正是上面那个管理命令留下的：
 *    它补进度，而旧栈的信号只挂在 ProblemSetProblem 和 ProblemSetBadge 上、不挂 Progress。
 * 3. **算法改过**。分母只算必做题（选做不再卡完成）、空题单不再算完成、total_score 跟着分值走。
 *    已有的行要跑一遍才会按新规则重算。
 *
 * 三件事必须一趟做完，因为它们首尾相接：补进度 → 完成状态变 → 奖章达标面变。
 * 落库走 resyncProgress，它重算进度之后会顺手重算该题单的全部奖章。
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
 */
const ACCEPTED = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

type ProblemLink = { problemId: number; score: number; isRequired: boolean }

async function loadSet(problemsetId: number) {
  const [links, progresses, badges] = await Promise.all([
    db.select({
      problemId: schema.problemsetProblem.problemId,
      score: schema.problemsetProblem.score,
      isRequired: schema.problemsetProblem.isRequired,
    }).from(schema.problemsetProblem).where(eq(schema.problemsetProblem.problemsetId, problemsetId)),
    db.select().from(schema.problemsetProgress)
      .where(eq(schema.problemsetProgress.problemsetId, problemsetId)),
    db.select().from(schema.problemsetBadge)
      .where(eq(schema.problemsetBadge.problemsetId, problemsetId)),
  ])
  return { links, progresses, badges }
}

/**
 * 找出「这个题单里的题，学生其实早就 AC 了，可进度里没记」的那些格子。
 *
 * 口径必须和 recordSolvedProblem 一模一样（非比赛提交、ACCEPTED 或 AST_CHECK_FAILED、
 * 取最早那次），否则补账工具会永远「发现」差异。题单里的题必定是非比赛题，所以
 * isNull(contestId) 实际上不会过滤掉任何东西，写上是为了两边字面一致。
 */
async function recoverable(links: ProblemLink[], progresses: (typeof schema.problemsetProgress.$inferSelect)[]) {
  const gaps: { userId: number; problemId: number }[] = []
  for (const progress of progresses) {
    const detail = objectValue(progress.progressDetail)
    for (const link of links) {
      if (!(String(link.problemId) in detail)) gaps.push({ userId: progress.userId, problemId: link.problemId })
    }
  }
  if (gaps.length === 0) return new Map<string, string>()
  const rows = await db.select({
    userId: schema.submission.userId,
    problemId: schema.submission.problemId,
    solvedAt: sql<string>`min(${schema.submission.createTime})::text`,
  }).from(schema.submission).where(and(
    inArray(schema.submission.userId, [...new Set(gaps.map((g) => g.userId))]),
    inArray(schema.submission.problemId, [...new Set(gaps.map((g) => g.problemId))]),
    isNull(schema.submission.contestId),
    inArray(schema.submission.result, ACCEPTED),
  )).groupBy(schema.submission.userId, schema.submission.problemId)
  const solved = new Map(rows.map((row) => [`${row.userId}:${row.problemId}`, row.solvedAt]))
  const found = new Map<string, string>()
  for (const gap of gaps) {
    const key = `${gap.userId}:${gap.problemId}`
    const at = solved.get(key)
    if (at) found.set(key, at)
  }
  return found
}

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
    const { links, progresses, badges } = await loadSet(set.id)
    const found = await recoverable(links, progresses)
    const scoreByProblem = new Map(links.map((link) => [link.problemId, link.score]))

    // 把补回来的格子先并进 detail，再按新规则重算 —— 奖章的差异要照着「补完账又重算过」
    // 的进度看，否则预演报出来的名单和 --apply 之后的结果对不上
    const next = progresses.map((row) => {
      const detail = objectValue(row.progressDetail)
      for (const link of links) {
        const at = found.get(`${row.userId}:${link.problemId}`)
        if (at) detail[String(link.problemId)] = { score: scoreByProblem.get(link.problemId) ?? 0, submit_time: at }
      }
      return { ...row, ...computeProgress(detail, links, row.completeTime, now) }
    })

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
    report.push({
      set, links, found, scoreByProblem,
      changed: changed.length, newlyCompleted, uncompleted, badgeDiffs,
      recovered: found.size,
      recoveredUsers: new Set([...found.keys()].map((key) => key.split(":")[0]!)).size,
    })
  }

  const recovered = report.reduce((n, r) => n + r.recovered, 0)
  const progressRows = report.reduce((n, r) => n + r.changed, 0)
  const completedGain = report.reduce((n, r) => n + r.newlyCompleted, 0)
  const completedLoss = report.reduce((n, r) => n + r.uncompleted, 0)
  const missing = report.reduce((n, r) => n + r.badgeDiffs.reduce((m, d) => m + d.missing.length, 0), 0)
  const extra = report.reduce((n, r) => n + r.badgeDiffs.reduce((m, d) => m + d.extra.length, 0), 0)

  console.log(`共 ${sets.length} 个题单\n`)
  for (const r of report) {
    const lines = []
    if (r.recovered) {
      lines.push(`      补录：${r.recovered} 道题已 AC 但进度里没记（${r.recoveredUsers} 名学生）`)
    }
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
  console.log(`\n合计：补录 ${recovered} 道题，进度 ${progressRows} 条要重算` +
    `（完成 +${completedGain} / -${completedLoss}），奖章补发 ${missing} 条、收回 ${extra} 条`)

  if (recovered === 0 && progressRows === 0 && missing === 0 && extra === 0) {
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
    const hasBadgeDrift = r.badgeDiffs.some((d) => d.missing.length || d.extra.length)
    if (!r.recovered && !r.changed && !hasBadgeDrift) continue
    // 补录的格子先写进 detail，resyncProgress 是照着库里的 detail 重算的
    if (r.recovered) {
      await db.transaction(async (tx) => {
        const rows = await tx.select().from(schema.problemsetProgress)
          .where(eq(schema.problemsetProgress.problemsetId, r.set.id))
        for (const row of rows) {
          const detail = objectValue(row.progressDetail)
          let dirty = false
          for (const link of r.links) {
            const at = r.found.get(`${row.userId}:${link.problemId}`)
            if (!at || String(link.problemId) in detail) continue
            detail[String(link.problemId)] = { score: r.scoreByProblem.get(link.problemId) ?? 0, submit_time: at }
            dirty = true
            const [existing] = await tx.select({ id: schema.problemsetSubmission.id })
              .from(schema.problemsetSubmission).where(and(
                eq(schema.problemsetSubmission.problemsetId, r.set.id),
                eq(schema.problemsetSubmission.userId, row.userId),
                eq(schema.problemsetSubmission.problemId, link.problemId),
              )).limit(1)
            if (!existing) {
              const [submission] = await tx.select({ id: schema.submission.id }).from(schema.submission)
                .where(and(
                  eq(schema.submission.userId, row.userId),
                  eq(schema.submission.problemId, link.problemId),
                  isNull(schema.submission.contestId),
                  inArray(schema.submission.result, ACCEPTED),
                )).orderBy(schema.submission.createTime).limit(1)
              if (submission) {
                await tx.insert(schema.problemsetSubmission).values({
                  problemsetId: r.set.id,
                  userId: row.userId,
                  submissionId: submission.id,
                  problemId: link.problemId,
                })
              }
            }
          }
          if (dirty) {
            await tx.update(schema.problemsetProgress).set({ progressDetail: detail })
              .where(eq(schema.problemsetProgress.id, row.id))
          }
        }
      })
    }
    // 重算进度，顺带重算这份题单的全部奖章
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
    const { links, progresses, badges } = await loadSet(set.id)
    const found = await recoverable(links, progresses)
    if (found.size) {
      remaining += found.size
      console.error(`  仍有可补录的进度：题单${set.id} ${found.size} 条`)
    }
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

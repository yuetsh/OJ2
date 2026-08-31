import { eq } from "drizzle-orm"

import { db, schema } from "../db"
import { badgeHolderDiff, recalculateBadge } from "../services/problemset"

/**
 * 补发历史欠账的题单奖章。
 *
 * 奖章原本只在「学生做出一道题」那一刻发（`PUT /problem-set-progress`），进度要是从别的
 * 路径变了 —— 后台加减题目、手工批量补进度 —— 就没人回头判过达标。生产快照里因此攒下
 * 53 条应发未发、涉及 30 名学生，其中 23 条来自 2026-05-22 00:50 那次一分钟内跨 7 个题单
 * 的批量补进度。
 *
 * 默认只读，把差异打出来；确认无误再加 --apply 落库。
 * 补发用的是 recalculateBadge，它同时会**收回**已经不达标的人的奖章，所以只要存在
 * 「误发」就先停下来让人看清楚，要真的收回得显式加 --allow-revoke。
 *
 *   bun src/scripts/backfill-problemset-badges.ts
 *   bun src/scripts/backfill-problemset-badges.ts --apply
 */
const apply = process.argv.includes("--apply")
const allowRevoke = process.argv.includes("--allow-revoke")

const rows = await db
  .select({ badge: schema.problemsetBadge, title: schema.problemset.title })
  .from(schema.problemsetBadge)
  .innerJoin(schema.problemset, eq(schema.problemset.id, schema.problemsetBadge.problemsetId))
  .orderBy(schema.problemsetBadge.problemsetId, schema.problemsetBadge.id)

if (rows.length === 0) {
  console.log("没有任何题单奖章，无事可做")
  process.exit(0)
}

const diffs = []
for (const { badge, title } of rows) {
  diffs.push({ badge, title, ...(await badgeHolderDiff(badge)) })
}

const missingTotal = diffs.reduce((sum, d) => sum + d.missing.length, 0)
const extraTotal = diffs.reduce((sum, d) => sum + d.extra.length, 0)
const affected = new Set(diffs.flatMap((d) => [...d.missing, ...d.extra]))

console.log(`共 ${rows.length} 枚奖章\n`)
for (const d of diffs) {
  if (!d.missing.length && !d.extra.length) continue
  const cond = `${d.badge.conditionType}/${d.badge.conditionValue}`
  console.log(
    `  题单${String(d.badge.problemsetId).padStart(2)} ${d.title}  [${d.badge.name}] ${cond}\n` +
      `      应发 ${d.eligible} / 现有 ${d.held}` +
      (d.missing.length ? `  漏发 ${d.missing.length}：user ${d.missing.join(", ")}` : "") +
      (d.extra.length ? `  误发 ${d.extra.length}：user ${d.extra.join(", ")}` : ""),
  )
}
console.log(`\n合计：漏发 ${missingTotal} 条，误发 ${extraTotal} 条，涉及 ${affected.size} 名学生`)

if (missingTotal === 0 && extraTotal === 0) {
  console.log("奖章与规则一致，无需补发")
  process.exit(0)
}

if (!apply) {
  console.log("\n这是只读预演。确认无误后加 --apply 落库。")
  process.exit(0)
}

if (extraTotal > 0 && !allowRevoke) {
  console.error(
    `\n存在 ${extraTotal} 条误发。补发用的 recalculateBadge 会把它们**删掉**，` +
      `而 user_badge 没有别处备份、earnedTime 删了就找不回来。\n` +
      `确认要连同收回一起执行，加 --allow-revoke。`,
  )
  process.exit(1)
}

let touched = 0
for (const d of diffs) {
  if (!d.missing.length && !d.extra.length) continue
  await recalculateBadge(d.badge)
  touched += 1
}
console.log(`\n已重算 ${touched} 枚奖章，复核中……`)

let remaining = 0
for (const { badge, title } of rows) {
  const after = await badgeHolderDiff(badge)
  if (after.missing.length || after.extra.length) {
    remaining += after.missing.length + after.extra.length
    console.error(`  仍不一致：题单${badge.problemsetId} ${title} [${badge.name}]`, after)
  }
}
console.log(remaining === 0 ? "复核通过：全部奖章与规则一致" : `复核未通过，仍有 ${remaining} 条差异`)
process.exit(remaining === 0 ? 0 : 1)

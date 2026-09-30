import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { diagnoseRuntimeError, templateForLanguage, type JudgeCase } from "../judge/run"
import { JudgeStatus } from "../judge/status"
import { parseProblemTemplate } from "../judge/template"
import { asRecord } from "../routes/helpers"

/**
 * 把库里运行时错误的诊断（`statistic_info.runtime_error`）按现在的规则重做一遍。
 *
 * 诊断是判题时写进库的，规则改了旧提交不会跟着变。2026-09 那次把 TypeError 的归类从
 * 12 种扩到 30 多种，库里已有的诊断没有新的 kind，学生翻旧提交看到的还是兜底话。
 *
 * - **Python**：只重做**已经有诊断**的（诊断功能上线之前的提交没存过，不去补 ——
 *   那是九千多次重跑，而且学生早就不看了）。和判题时一样，重跑第一个失败测试点拿回溯，
 *   所以**要在能读到测试点、连得上判题机的地方跑**，也就是线上的 oj-api 容器。
 * - **C / C++**：诊断只是失败测试点的信号和退出码，`info` 里本来就存着，不用重跑，
 *   全部补上（原来一条都没有）。
 *
 * 比赛提交不诊断，和判题时同一个口径。重跑失败（测试点没了、判题机没回回溯）的保留原样。
 *
 * 默认只读，打出变化；确认无误再加 --apply 落库：
 *
 *   docker compose -f docker/compose.debian.yml run --rm oj-api oj2-api rediagnose
 *   docker compose -f docker/compose.debian.yml run --rm oj-api oj2-api rediagnose --apply
 *
 * 重跑走的是判题机，挑没人做题的时候跑。只写 runtime_error 这一个键，不碰别的。
 */
/** jsonb 读回来的键顺序和新拼的对象不一样，按排好序的键比。诊断是一层的平对象 */
function sameKeys(value: unknown) {
  const record = asRecord(value)
  return value ? JSON.stringify(record, Object.keys(record).sort()) : "null"
}

export async function rediagnose({ apply }: { apply: boolean }) {
  const rows = await db
    .select({ submission: schema.submission, problem: schema.problem })
    .from(schema.submission)
    .innerJoin(schema.problem, eq(schema.problem.id, schema.submission.problemId))
    .where(
      and(
        eq(schema.submission.result, JudgeStatus.RUNTIME_ERROR),
        isNull(schema.submission.contestId),
        inArray(schema.submission.language, ["Python", "C", "C++"]),
        sql`(${schema.submission.language} <> 'Python' or ${schema.submission.statisticInfo} ? 'runtime_error')`,
      ),
    )
  console.log(
    `${rows.length} 条运行时错误要重新诊断${apply ? "" : "（只读预演，加 --apply 才写）"}`,
  )

  const changes = new Map<string, number>()
  let changed = 0
  let failed = 0
  for (const [index, row] of rows.entries()) {
    const cases = asRecord(row.submission.info).data
    const failure = (Array.isArray(cases) ? (cases as JudgeCase[]) : [])
      .toSorted((left, right) => Number(left.test_case) - Number(right.test_case))
      .find((item) => item.result !== JudgeStatus.ACCEPTED)

    const rawTemplate = templateForLanguage(row.problem.template, row.submission.language)
    const template = rawTemplate ? parseProblemTemplate(rawTemplate) : null
    const source = template
      ? `${template.prepend}\n${row.submission.code}\n${template.append}`
      : row.submission.code
    const prependLines = template ? template.prepend.split("\n").length : 0

    const next = failure
      ? await diagnoseRuntimeError(row, source, prependLines, failure).catch(() => null)
      : null
    const previous = asRecord(row.submission.statisticInfo).runtime_error
    if (!next) {
      failed++
    } else if (sameKeys(next) !== sameKeys(previous)) {
      changed++
      const label = (value: unknown) => {
        const info = asRecord(value)
        if (!value) return "（无）"
        if (info.type) return `${String(info.type)}/${String(info.kind ?? "-")}`
        return `信号 ${String(info.signal ?? 0)} 退出码 ${String(info.exit_code ?? 0)}`
      }
      const key = `${row.submission.language}  ${label(previous)} → ${label(next)}`
      changes.set(key, (changes.get(key) ?? 0) + 1)
      if (apply) {
        await db
          .update(schema.submission)
          .set({
            statisticInfo: sql`${schema.submission.statisticInfo} || jsonb_build_object('runtime_error', ${JSON.stringify(next)}::jsonb)`,
          })
          .where(eq(schema.submission.id, row.submission.id))
      }
    }
    if ((index + 1) % 50 === 0) console.log(`  ${index + 1} / ${rows.length}`)
  }

  for (const [key, count] of [...changes].sort((left, right) => right[1] - left[1])) {
    console.log(`${String(count).padStart(5)}  ${key}`)
  }
  console.log(
    `变了 ${changed} 条${apply ? "，已写入" : ""}；没变 ${rows.length - changed - failed} 条；诊断不出来、保留原样 ${failed} 条`,
  )
  return 0
}

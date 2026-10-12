import type { FlowchartCaseReport, FlowchartCaseResult } from "@oj2/contract"

/**
 * 读出一次流程图评分里「走例子」的报告（2026-10 起的评法）；老提交是四项分，给 null。
 *
 * 形状真相在写入侧（后端 flowchart/run.ts 的 parseTrace），这里只按约定取、缺了兜底，
 * 不做运行时校验（理由见 apps/web/CLAUDE.md「什么该收紧」）。
 */
export function caseReport(details: Record<string, unknown> | null | undefined) {
  if (!details || details.version !== 2 || !Array.isArray(details.cases)) return null
  const cases = details.cases.map((raw): FlowchartCaseResult => {
    const row = (raw ?? {}) as Partial<FlowchartCaseResult>
    return {
      name: String(row.name ?? ""),
      input: String(row.input ?? ""),
      expected: String(row.expected ?? ""),
      output: String(row.output ?? ""),
      ok: row.ok === true,
      path: Array.isArray(row.path) ? row.path.map(String) : [],
      wrongAt: typeof row.wrongAt === "string" ? row.wrongAt : null,
      why: String(row.why ?? ""),
    }
  })
  return {
    version: 2,
    passed: cases.filter((row) => row.ok).length,
    total: cases.length,
    cases,
  } satisfies FlowchartCaseReport
}

/** 「6 组走对 3 组」「6 组全部走对」 */
export function caseHeadline(report: FlowchartCaseReport) {
  return report.passed === report.total
    ? `${report.total} 组全部走对`
    : `${report.total} 组走对 ${report.passed} 组`
}

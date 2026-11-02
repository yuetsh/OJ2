import type { FlowchartCaseReport, FlowchartCaseResult } from '@oj2/contract'

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
      name: String(row.name ?? ''),
      input: String(row.input ?? ''),
      expected: String(row.expected ?? ''),
      output: String(row.output ?? ''),
      ok: row.ok === true,
      path: Array.isArray(row.path) ? row.path.map(String) : [],
      wrongAt: typeof row.wrongAt === 'string' ? row.wrongAt : null,
      why: String(row.why ?? ''),
    }
  })
  return {
    version: 2,
    passed: cases.filter((row) => row.ok).length,
    total: cases.length,
    cases,
    focus: typeof details.focus === 'string' ? details.focus : null,
  } satisfies FlowchartCaseReport
}

/**
 * 标题那句话（设计稿 FlowNote*）。等级照旧存 S/A/B/C，学生看到的是话：全对时 S「画得很清楚」、
 * A「画对了」；没全对按走对几组分三档，C 里一组都没对和对了几组分开说 —— 一直是「还没画对」
 * 会让人泄气
 */
export function flowchartVerdict(report: FlowchartCaseReport, grade: string | null) {
  if (report.passed === report.total) return grade === 'S' ? '画对了，画得很清楚' : '画对了'
  if (report.passed * 2 >= report.total) return '快画对了'
  return report.passed > 0 ? '对了一部分' : '还没画对'
}

/** 「6 组走对 3 组」「6 组全部走对」 */
export function caseHeadline(report: FlowchartCaseReport) {
  return report.passed === report.total ? `${report.total} 组全部走对` : `${report.total} 组走对 ${report.passed} 组`
}

/**
 * 图填满图框：大图照旧缩小，小图也放大，但最多到原尺寸的 1.5 倍（再大字就粗笨了）。
 * 原来只缩不放，比大小这种五六个框的图在一大块空白中间只占一小团
 */
export function fitFlowchartGraph(el: HTMLElement | null) {
  const svg = el?.querySelector('svg')
  const w = Number.parseFloat(svg?.getAttribute('width') ?? '')
  const h = Number.parseFloat(svg?.getAttribute('height') ?? '')
  if (!svg || !w || !h) return
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.style.width = '100%'
  svg.style.height = '100%'
  svg.style.maxWidth = `${w * 1.5}px`
  svg.style.maxHeight = `${h * 1.5}px`
}

/**
 * 要改的那个框标红（加 oj-focus，颜色由用的地方的样式定）：AI 对着答案指出的，没有就退回
 * 程序找到的第一处出错的框。pele 把 Mermaid 的框号放在节点 <g> 的 data-id 上
 */
export function markFlowchartFocus(el: HTMLElement | null, report: FlowchartCaseReport | null) {
  const focus = report?.focus ?? report?.cases.find((row) => !row.ok)?.wrongAt
  if (!el || !focus) return
  el.querySelector(`.pele-node[data-id="${focus}"]`)?.classList.add('oj-focus')
}

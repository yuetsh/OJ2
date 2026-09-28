/**
 * 流程图的等级。一律由分数推出来，不采信模型自报的 grade：提示词里写死了这四档，
 * 但模型偶尔会给出 88 分配 S 级这种自相矛盾的结果，甚至直接吐「优秀」；脏值会一路
 * 串到等级分布图和「A/S 才算过关」的判断里。
 */
export function gradeForScore(score: number) {
  if (score >= 90) return "S"
  if (score >= 80) return "A"
  if (score >= 70) return "B"
  return "C"
}

/**
 * 画到这两档算这道题做完：题单进度、课堂条、「你画的流程图」都按它
 * （设计文档 2026-09-28-problem-page-redesign 第 3 节决定 4、6）
 */
export const FLOWCHART_PASS_GRADES = ["S", "A"]

export function isFlowchartPass(grade: string | null | undefined) {
  return grade === "S" || grade === "A"
}

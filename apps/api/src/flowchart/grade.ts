/**
 * 流程图的等级。一律由分数推出来，不采信模型自报的 grade：提示词里写死了这四档，
 * 但模型偶尔会给出 88 分配 S 级这种自相矛盾的结果，甚至直接吐「优秀」；脏值会一路
 * 串到等级分布图和「A/S 才算过关」的判断里。
 */
export function gradeForScore(score: number) {
  if (score >= 90) return 'S'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  return 'C'
}

/**
 * 走例子的等级：全走对才算过关（A），全对而且写法挑不出毛病是 S；没全对时走对一半以上 B，
 * 否则 C。和 gradeForScore 一样不采信模型自报的等级
 */
export function gradeForCases(passed: number, total: number, hasStyleNote: boolean) {
  if (total > 0 && passed === total) return hasStyleNote ? 'A' : 'S'
  if (passed * 2 >= total) return 'B'
  return 'C'
}

/** 卡点分析（Stuck.vue）和它的单题详情（StuckDetail.vue）共用的两个算法 */

/** 百分比，取整；分母是 0 时给 0 */
export function rate(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0
}

/** 做对的人平均交了几次（只数做对那次及之前的） */
export function avgTries(row: { solved: number; solvedTries: number }) {
  return row.solved ? (row.solvedTries / row.solved).toFixed(1) : '-'
}

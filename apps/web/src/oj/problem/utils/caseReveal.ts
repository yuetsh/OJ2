/**
 * 测试点一格一格亮（设计稿「测试点亮起来」，借小丑牌结算时一张张牌亮起来）的节奏。
 * 不管几组，全部亮完不超过 0.9 秒：组少的一格 120 毫秒，组多的平分 900 毫秒。
 * 结果页签里的方块（CaseBlocks）和等方块亮完再放的烟花（SubmissionEffects）用同一份。
 */
const TOTAL_MS = 900
const STEP_MAX_MS = 120

export function caseRevealStep(count: number) {
  return Math.min(STEP_MAX_MS, Math.floor(TOTAL_MS / Math.max(count, 1)))
}

export function caseRevealDuration(count: number) {
  return caseRevealStep(count) * count
}

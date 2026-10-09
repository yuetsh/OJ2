import type { ProblemSet, ProblemSetBadge } from "utils/types"

/**
 * 奖章的两种条件和后端 eligibleForBadge 同一个口径：
 *   - 全部做完：必做题全对（completedCount === totalCount）
 *   - 做对 N 道：做对的全部题数（含选做，solvedCount）≥ N
 */
export function badgeCondition(badge: ProblemSetBadge) {
  return badge.conditionType === "all_problems" ? "全部做完" : `做对 ${badge.conditionValue} 道`
}

/** 拿到这枚奖章还差几道；已经拿到为 0 */
export function badgeShortfall(badge: ProblemSetBadge, set: ProblemSet) {
  if (badge.isEarned) return 0
  const progress = set.userProgress
  const remaining =
    badge.conditionType === "all_problems"
      ? set.requiredCount - progress.completedCount
      : badge.conditionValue - progress.solvedCount
  return Math.max(1, remaining)
}

/** 阶梯顺序：按要做对的题数从少到多，「全部做完」排最后 */
export function ladder(set: ProblemSet) {
  const need = (badge: ProblemSetBadge) =>
    badge.conditionType === "all_problems" ? Number.MAX_SAFE_INTEGER : badge.conditionValue
  return [...set.badges].sort((a, b) => need(a) - need(b) || a.id - b.id)
}

/** 下一枚最近的奖章和还差几道；全拿到了（或者没有奖章）为 null */
export function nextBadge(set: ProblemSet) {
  const pending = ladder(set).filter((badge) => !badge.isEarned)
  if (pending.length === 0) return null
  const scored = pending.map((badge) => ({ badge, left: badgeShortfall(badge, set) }))
  scored.sort((a, b) => a.left - b.left)
  return scored[0]!
}

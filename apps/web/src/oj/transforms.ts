import { DIFFICULTY } from "utils/constants"
import { getACRate } from "utils/functions"
import type { ProblemFiltered, ProblemListItem } from "utils/types"

// 把后端的列表项塑形成列表页需要的形状，与请求逻辑解耦。
export function filterResult(result: ProblemListItem): ProblemFiltered {
  return {
    id: result.id,
    _id: result._id,
    title: result.title,
    difficulty: result.difficulty ? DIFFICULTY[result.difficulty] : null,
    tags: result.tags,
    submission: result.submissionNumber,
    rate: getACRate(result.acceptedNumber, result.submissionNumber),
    // null / undefined 都表示「没做过」
    status:
      result.myStatus === null || result.myStatus === undefined
        ? "not_test"
        : result.myStatus === 0
          ? "passed"
          : "failed",
    author: result.createdBy.username,
    allowFlowchart: result.allowFlowchart,
    showFlowchart: result.showFlowchart,
    hasAstRules: result.hasAstRules,
  }
}

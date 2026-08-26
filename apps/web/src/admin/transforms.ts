import type { AdminProblemFiltered, AdminProblemListItem } from "utils/types"

// 把后端的列表项塑形成管理端列表行，与请求逻辑解耦。
export function toProblemListItem(
  result: AdminProblemListItem,
): AdminProblemFiltered {
  return {
    id: result.id,
    _id: result._id,
    title: result.title,
    username: result.createdBy.username,
    createTime: result.createTime,
    visible: result.visible,
    difficulty: result.difficulty,
    tags: result.tags,
    hasAstRules: result.hasAstRules,
    allowFlowchart: result.allowFlowchart,
    showFlowchart: result.showFlowchart,
    topReaction: result.topReaction,
  }
}

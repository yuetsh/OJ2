import type { ProblemTypeFilter } from "@oj2/contract"

/** 名字和题目页一致：「语法要求」（题目页原来叫「代码要求」，一起改了） */
export const PROBLEM_TYPE_LABEL: Record<ProblemTypeFilter, string> = {
  flowchart: "画流程图",
  ast: "语法要求",
  reference: "有参考图",
}

/** 「全部类型」下拉里每项下面那句话 */
export const PROBLEM_TYPE_HINT: Record<ProblemTypeFilter, string> = {
  reference: "题目里附了老师画好的流程图，照着写代码",
  flowchart: "除了写代码，也可以交流程图；评到 A 或 S 级算做对",
  ast: "要求用（或者不能用）某种写法，交了会检查",
}

/** 一道题挂哪几个标签，从醒目到轻：画流程图 → 语法要求 → 有参考图 */
export function problemTypes(problem: {
  allowFlowchart: boolean
  hasAstRules: boolean
  showFlowchart: boolean
}): ProblemTypeFilter[] {
  const kinds: ProblemTypeFilter[] = []
  if (problem.allowFlowchart) kinds.push("flowchart")
  if (problem.hasAstRules) kinds.push("ast")
  if (problem.showFlowchart) kinds.push("reference")
  return kinds
}

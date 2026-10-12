import type { ProblemTypeFilter } from "@oj2/contract"

/** 名字和题目页一致：「语法要求」（题目页原来叫「代码要求」，一起改了） */
export const PROBLEM_TYPE_LABEL: Record<ProblemTypeFilter, string> = {
  sql: "SQL",
  flowchart: "画流程图",
  ast: "语法要求",
  reference: "有参考图",
}

/** 「全部类型」下拉里每项下面那句话 */
export const PROBLEM_TYPE_HINT: Record<ProblemTypeFilter, string> = {
  sql: "写 SQL 语句查数据库",
  reference: "题目中有流程图，照着写代码",
  flowchart: "绘制流程图；评到 A 级以上算做对",
  ast: "按照要求用某种写法，提交时会检查",
}

/** 一道题挂哪几个标签，从醒目到轻：SQL → 画流程图 → 语法要求 → 有参考图 */
export function problemTypes(problem: {
  isSql: boolean
  allowFlowchart: boolean
  hasAstRules: boolean
  showFlowchart: boolean
}): ProblemTypeFilter[] {
  const kinds: ProblemTypeFilter[] = []
  if (problem.isSql) kinds.push("sql")
  if (problem.allowFlowchart) kinds.push("flowchart")
  if (problem.hasAstRules) kinds.push("ast")
  if (problem.showFlowchart) kinds.push("reference")
  return kinds
}

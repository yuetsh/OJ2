import type { AstCheckResponse } from "@oj2/contract"

/**
 * 出题页里每种语言的语法要求自测结果：每条规则学生看到的那句话 + 标准答案过不过。
 * 规则本身配得不对（后端 astRulesError）时是一句错误。右边预览和保存前的检查都看它
 */
export type AstCheckState = Record<string, { rules: AstCheckResponse["rules"] } | { error: string }>

/** 右栏「学生看到的样子」开着哪一页 */
export type PreviewTab = "statement" | "editor" | "flowchart"

/** 流程图三选一：不用 / 给学生看参考图（showFlowchart）/ 让学生自己画、按这张图打分（allowFlowchart） */
export type FlowchartMode = "none" | "show" | "draw"

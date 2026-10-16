import type { FlowchartSubmissionListItem, LANGUAGE, SubmissionListItem } from "utils/types"

/** 提交列表（list.vue）的筛选条件，和它拆出去的几个 composable 共用 */
export interface SubmissionQuery {
  page: number
  limit: number
  username: string
  className: string
  result: string
  myself: "0" | "1"
  problem: string
  language: LANGUAGE | "" | "Flowchart"
  today: "0" | "1"
}

/** 一行：代码提交或流程图提交（看 query.language 是不是 Flowchart） */
export type Row = SubmissionListItem | FlowchartSubmissionListItem

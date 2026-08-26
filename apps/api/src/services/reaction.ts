import { reactionKeySchema, type ReactionKey } from "@oj2/contract"
import { count, inArray } from "drizzle-orm"

import { db, schema } from "../db"

/**
 * 并列票数时按 reactionKeySchema 的定义顺序取靠前的那个，与前端 REACTIONS
 * 的顺序一致 —— 对齐旧后端 `reaction/services.py` 的 TYPE_ORDER。
 * 改这里的顺序会让同票题目的展示结果跟着变。
 */
const TYPE_ORDER = new Map<string, number>(
  reactionKeySchema.options.map((key, index) => [key, index]),
)

/** 库里的 type 是裸字符串；在 TYPE_ORDER 里就等价于「契约认得的类型」。 */
function isReactionKey(value: string): value is ReactionKey {
  return TYPE_ORDER.has(value)
}

export interface TopReaction {
  type: ReactionKey
  count: number
}

/**
 * 批量取每道题得票最高的评价，返回 `Map<problemId, {type, count}>`，
 * **只包含有评价的题目**（没有的题不进 Map，调用方自己兜 null）。
 *
 * 对齐旧后端 `reaction/services.py:get_top_reactions`。
 */
export async function getTopReactions(problemIds: number[]) {
  const top = new Map<number, TopReaction>()
  if (problemIds.length === 0) return top

  const rows = await db
    .select({
      problemId: schema.reaction.problemId,
      type: schema.reaction.type,
      value: count(),
    })
    .from(schema.reaction)
    .where(inArray(schema.reaction.problemId, problemIds))
    .groupBy(schema.reaction.problemId, schema.reaction.type)

  for (const row of rows) {
    // 库里可能残留前端已经下掉的旧类型。跳过而不是当成并列最优 ——
    // 否则一个已经不展示的类型会把真正的最高票挤掉。
    if (!isReactionKey(row.type)) continue
    const order = TYPE_ORDER.get(row.type)!
    const current = top.get(row.problemId)
    if (
      !current ||
      row.value > current.count ||
      (row.value === current.count && order < TYPE_ORDER.get(current.type)!)
    ) {
      top.set(row.problemId, { type: row.type, count: row.value })
    }
  }
  return top
}

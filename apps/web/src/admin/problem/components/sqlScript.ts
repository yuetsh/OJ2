import type { SqlDisplay } from "utils/types"
import { changedRowCount, tableChanges } from "oj/problem/utils/sqlChanges"

/** 出题页的一组测试数据：一份建表 + 插数据的脚本，和它跑出来的样子 */
export interface ScriptGroup {
  key: number
  sql: string
  /** 跑出来的结果对应的是哪一版（标准答案 + 判题方式 + 脚本），和现在的对不上就是过期了 */
  ranFor: string
  display: SqlDisplay | null
  /** 跑不起来的原因，常见的已经翻成中文（explainSqlError） */
  error: string
  /** 后端回的原话，翻译过的时候用小字附在后面 */
  errorRaw: string
  /** 正在跑的那一版 */
  running: string
}

export type GroupStatus = "empty" | "no-answer" | "running" | "ok" | "error"

/**
 * SQLite 的报错是英文，出题的老师未必看得懂。常见的几种翻成一句中文，
 * 认不出来的原样给（后端已经加了「初始化脚本执行失败」这类中文前缀）
 */
export function explainSqlError(message: string) {
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/no such table: (\S+)/, (m) => `没有 ${m[1]} 这张表`],
    [/no such column: (\S+)/, (m) => `没有 ${m[1]} 这一列`],
    [/table (\S+) already exists/, (m) => `${m[1]} 这张表建了两次`],
    [/near "([^"]*)": syntax error/, (m) => `语法有错，在「${m[1]}」附近`],
    [/incomplete input/, () => "语句没写完（少了右括号或分号？）"],
    [/UNIQUE constraint failed: (\S+)/, (m) => `${m[1]} 有重复的值`],
    [/(\d+) values for (\d+) columns/, (m) => `一行给了 ${m[1]} 个值，但表有 ${m[2]} 列`],
  ]
  if (message.includes("标准答案未修改任何表数据")) {
    return "标准答案在这组数据上一行都没改：增删改题的每组数据里都要有会被改到的行"
  }
  for (const [pattern, say] of rules) {
    const match = message.match(pattern)
    if (match) {
      const where = message.startsWith("标准答案") ? "标准答案在这组数据上" : "这组的脚本"
      return `${where}跑不起来：${say(match)}`
    }
  }
  return message
}

/** 列表里那一行的小结：几张表各几行 → 期望几行 / 改了几行 */
export function groupSummary(display: SqlDisplay) {
  const rows = display.tables.map((t) => t.total_rows).join(" + ")
  const expected = display.expected
  if ("columns" in expected) return `${rows} 行 → 期望 ${expected.total_rows} 行`
  const changed = expected.changed_tables.reduce((sum, table) => {
    if (table.dropped) return sum + 1
    const changes = tableChanges(
      display.tables.find((t) => t.name === table.name),
      table,
    )
    return sum + (changes ? changedRowCount(changes) : 0)
  }, 0)
  return changed ? `${rows} 行 → 改了 ${changed} 行` : `${rows} 行 → 一行都没改`
}

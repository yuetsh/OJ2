import type { SqlDisplayTable } from "utils/types"

/** 增删改题：执行后的表比原来变了哪些。行号、列号都是执行后那张表里的 */
export interface TableChanges {
  /** 变了的格子，`行:列` */
  cells: Set<string>
  /** 整行是新插进来的 */
  newRows: Set<number>
  /** 删掉的行，记第一列的值（一般是 id） */
  removed: (string | number)[]
}

const sameColumns = (a: SqlDisplayTable, b: SqlDisplayTable) =>
  a.columns.length === b.columns.length && a.columns.every((c, i) => c.name === b.columns[i]!.name)

/** 第一列能当行的身份用：没有空值、不重复 */
const keyed = (rows: SqlDisplayTable["rows"]) =>
  rows.every((row) => row[0] !== null && row[0] !== undefined) &&
  new Set(rows.map((row) => row[0])).size === rows.length

/**
 * 对比执行前后的同一张表。对不上就返回 null（不标，宁可不标也不标错）：
 * - 列变了（ALTER TABLE）
 * - 第一列不能当身份、行数又不一样（删、插都有，没法知道哪行对哪行）
 *
 * 第一列能当身份时按它配对 —— 题目里的表几乎都是 id 打头，删掉中间一行，后面的行
 * 不会因为错位全被标成「变了」。删掉的行只在两边都没截断时才数，截断时看不全
 */
export function tableChanges(
  before: SqlDisplayTable | undefined,
  after: SqlDisplayTable,
): TableChanges | null {
  if (after.dropped) return null
  const cells = new Set<string>()
  const newRows = new Set<number>()
  // 原来没有这张表：标准答案新建的，整张都是新的
  if (!before) {
    after.rows.forEach((_, i) => newRows.add(i))
    return { cells, newRows, removed: [] }
  }
  if (!sameColumns(before, after)) return null

  const diffRow = (i: number, row: SqlDisplayTable["rows"][number], old: typeof row) =>
    row.forEach((value, j) => {
      if (value !== old[j]) cells.add(`${i}:${j}`)
    })

  if (keyed(before.rows) && keyed(after.rows)) {
    const byKey = new Map(before.rows.map((row) => [row[0], row]))
    after.rows.forEach((row, i) => {
      const old = byKey.get(row[0])
      if (old) diffRow(i, row, old)
      else newRows.add(i)
    })
    const kept = new Set(after.rows.map((row) => row[0]))
    const removed =
      before.truncated || after.truncated
        ? []
        : before.rows.filter((row) => !kept.has(row[0])).map((row) => row[0] as string | number)
    return { cells, newRows, removed }
  }
  if (before.rows.length !== after.rows.length) return null
  after.rows.forEach((row, i) => diffRow(i, row, before.rows[i]!))
  return { cells, newRows, removed: [] }
}

/** 一共动了几行（改过的、新插的、删掉的），出题页的测试数据列表里用 */
export function changedRowCount(changes: TableChanges) {
  const touched = new Set([...changes.cells].map((key) => key.split(":")[0]))
  return touched.size + changes.newRows.size + changes.removed.length
}

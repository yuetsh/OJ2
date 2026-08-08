/**
 * SQL 题判题核心：在 WASM SQLite 里分别执行标准答案和学生 SQL 并比对结果。
 * 移植自旧后端 `judge/sql_runner.py`，判定口径逐条对齐。
 *
 * 查询题（mode="query"）比对最后一条 SELECT 的结果集；
 * 增删改题（mode="modify"）比对执行后所有用户表的最终状态。
 *
 * ## 防护为什么和旧实现不一样
 *
 * 旧实现用 Python sqlite3 的 set_authorizer / set_progress_handler / setlimit 三件套。
 * bun:sqlite 一个都没有，且实测 Worker.terminate() 杀不掉跑飞的查询（原生代码占着线程）。
 * 所以改成「WASM 引擎 + 独立子进程」，逐条替代：
 *
 * | 旧防护 | 新做法 |
 * |---|---|
 * | authorizer 禁 ATTACH（防读写服务器任意 SQLite 文件） | WASM 没有宿主文件系统绑定，ATTACH **结构上**够不到宿主，只能碰随进程消失的虚拟 FS |
 * | authorizer 白名单让查询题只读 | `PRAGMA query_only=1` **加上逐语句拒绝学生的 PRAGMA**，见 runStudent |
 * | progress_handler 墙钟超时 | 语句**之间**查 deadline + 子进程外部 SIGKILL 兜底，见下 |
 * | setlimit(LIMIT_LENGTH) 防单值撑爆内存 | 子进程 `ulimit -d`，触顶时 WASM 抛可捕获错误 |
 * | max_page_count | 保留，且每条学生语句前重放一遍（否则学生能自己调大） |
 *
 * 两处必须知道的削弱：
 *
 * 1. **只有 query_only 是不够的。** 它自己就是个 PRAGMA，学生一句 `PRAGMA query_only=0`
 *    就能关掉它 —— 旧实现的 authorizer 把 SQLITE_PRAGMA 一律拒了，所以没这个洞。
 *    这里靠 runStudent 的逐语句守卫补上：学生 SQL 里的 PRAGMA 一律拒绝。
 * 2. **超时粒度是「一条语句」。** deadline 只在语句之间查，单条语句（递归 CTE、
 *    大 CROSS JOIN）一旦进了 step() 就没法从 JS 里打断。stock sql.js 的 wasm 没导出
 *    sqlite3_progress_handler / sqlite3_interrupt / sqlite3_set_authorizer / sqlite3_limit
 *    （已核对导出表，别再去找了），要用就得自己编 wasm。所以真正的硬上限是父进程的
 *    SIGKILL：`./index.ts` 收到 `@phase:student` 标记后会把兜底时限收到「题目时限 + 2s」，
 *    跑飞的学生语句最多多占这么久，而不是整个作业预算。
 */

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js"
import sqlWasmPath from "sql.js/dist/sql-wasm.wasm" with { type: "file" }
import { readFileSync } from "node:fs"

import { JudgeStatus, type JudgeStatusValue } from "../status"

/** 单结果集/单表最大行数，防 CROSS JOIN 撑爆内存 */
const ROW_LIMIT = 10_000
/** 题目页展示的行数上限（示例数据/期望结果） */
const DISPLAY_ROW_LIMIT = 20
const ERROR_MESSAGE_MAX_LEN = 200

/** prepare 阶段的语法类错误，映射为 COMPILE_ERROR */
const SYNTAX_ERROR_MARKERS = ["syntax error", "unrecognized token", "incomplete input"]

export class SqlCaseError extends Error {
  constructor(readonly result: JudgeStatusValue, readonly detail: string) {
    super(detail)
  }
}

let cached: SqlJsStatic | null = null

export async function sqlEngine() {
  if (cached) return cached
  // 内嵌成资源而非运行时 require.resolve —— 后者在 `bun build --compile` 之后
  // 只有在仓库目录里才碰巧能解析出来，换个目录就 Cannot find module。见 vendor/jieba.ts
  const binary = readFileSync(sqlWasmPath)
  // @types/sql.js 把 wasmBinary 标成 ArrayBuffer，实际 emscripten 接受 TypedArray；
  // 这里传 Uint8Array 是运行时正确的写法，类型上断言掉
  cached = await initSqlJs({ wasmBinary: binary as unknown as ArrayBuffer })
  return cached
}

function truncate(message: string) {
  return message.length > ERROR_MESSAGE_MAX_LEN
    ? `${message.slice(0, ERROR_MESSAGE_MAX_LEN)}...`
    : message
}

// ---------------------------------------------------------------- 值归一化

type Canonical = string

/**
 * 值归一化并打类型标签，防止 NULL/"NULL"、1/"1" 碰撞；数值统一比对
 * （1 == 1.0，浮点保留 6 位有效数字）。与旧 `_canonical_value` 同口径。
 */
function canonicalValue(value: unknown): Canonical {
  if (value === null || value === undefined) return "null"
  if (value instanceof Uint8Array) return `blob:${Buffer.from(value).toString("hex")}`
  if (typeof value === "number") {
    if (Number.isInteger(value) && Math.abs(value) < 2 ** 53) return `num:${value}`
    // Python 的 format(v, ".6g")
    return `num:${formatG6(value)}`
  }
  if (typeof value === "bigint") return `num:${value}`
  return `str:${String(value)}`
}

/** 等价于 Python 的 format(v, ".6g") */
function formatG6(value: number) {
  const exponent = value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)))
  if (exponent < -4 || exponent >= 6) {
    return value.toExponential(5).replace(/\.?0+e/, "e").replace(/e([+-])(\d)$/, "e$10$2")
  }
  const text = value.toPrecision(6)
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text
}

function canonicalRow(row: unknown[]) {
  return row.map(canonicalValue).join("")
}

// ---------------------------------------------------------------- 执行

interface ResultSet {
  columns: number
  rows: string[]
}

/** 引擎侧的资源限制。学生的每条语句前都要重放一遍，见 runStudent */
function applyLimits(db: Database, memoryLimitMb: number) {
  const limit = Math.max(Math.trunc(memoryLimitMb), 1)
  // 4096B/页 × 256 页/MB，超限报 "database or disk is full"
  db.run(`PRAGMA max_page_count=${limit * 256}`)
}

function newDatabase(SQL: SqlJsStatic, memoryLimitMb: number) {
  const db = new SQL.Database()
  db.run("PRAGMA page_size=4096")
  applyLimits(db, memoryLimitMb)
  return db
}

/** sql.js 的 iterateStatements 没进 @types/sql.js，这里补上类型 */
interface PreparedStatement {
  step(): boolean
  get(): unknown[]
  getColumnNames(): string[]
  getSQL(): string
  getNormalizedSQL(): string
  free(): void
}

function iterate(db: Database, script: string): Iterable<PreparedStatement> {
  return (db as unknown as {
    iterateStatements(sql: string): Iterable<PreparedStatement>
  }).iterateStatements(script)
}

/**
 * 取语句的首关键字。优先用 sqlite3_normalized_sql —— 归一化由 SQLite 自己做，
 * 注释、大小写、空白都已抹平（`/*x*​/ pragma  Query_Only = 0` → `PRAGMA query_only=?`），
 * 比在原文上自己做词法猜测可靠得多。
 */
function leadingKeyword(statement: PreparedStatement) {
  let text = ""
  try {
    text = statement.getNormalizedSQL() ?? ""
  } catch {
    text = ""
  }
  // 万一这个 build 没开 SQLITE_ENABLE_NORMALIZE，退回到原文剥注释
  if (!text) {
    text = statement.getSQL().replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ")
  }
  return text.trimStart().split(/[\s(;]/, 1)[0]?.toUpperCase() ?? ""
}

/**
 * 让题目的 `memoryLimit` 对学生真正生效的记账器。
 *
 * 旧实现用 `setlimit(SQLITE_LIMIT_LENGTH, memoryLimit)` 把单值长度贴着题目内存限。
 * sql.js 的 wasm **没导出** `sqlite3_limit`（已核对导出表），复刻不了，于是改成
 * 取行时按字节记账：单值超限、或整个结果集累计超限，都按 MLE 拒掉。
 *
 * 不这么做的话题目写 64MB 也没意义：唯一的硬顶是子进程那个固定 512MB 的
 * `ulimit -d`（见 index.ts），64MB 的题学生实际能吃到 8 倍。
 * `max_page_count` 管的是库文件页数，管不住「一个 SELECT 拼出一个巨大的值」。
 */
class ByteBudget {
  private used = 0

  constructor(private readonly maxBytes: number) {}

  charge(row: unknown[]) {
    for (const value of row) {
      const bytes =
        value instanceof Uint8Array
          ? value.byteLength
          : typeof value === "string"
            ? Buffer.byteLength(value)
            : 8 // 数字和 NULL 按定长算，撑不出内存
      if (bytes > this.maxBytes) {
        throw new SqlCaseError(JudgeStatus.MEMORY_LIMIT_EXCEEDED, "单个数据值超出内存限制")
      }
      this.used += bytes
      if (this.used > this.maxBytes) {
        throw new SqlCaseError(JudgeStatus.MEMORY_LIMIT_EXCEEDED, "查询结果超出内存限制")
      }
    }
  }
}

/**
 * 逐条执行，返回最后一条产生结果集的语句的 (列数, 行)；无结果集返回 null。
 *
 * 用 sql.js 的 iterateStatements（底层是 sqlite3_prepare_v2 逐条推进），
 * 比旧实现手写的分号切分更准 —— 字符串和注释里的分号天然不会误切。
 *
 * `guard` 在每条语句 step 之前调用，用来拦学生的 PRAGMA 并重放限制。
 * `budget` 只在跑学生 SQL 时传，受信脚本不记账。
 */
function executeStatements(
  db: Database,
  script: string,
  deadline: number,
  guard?: (statement: PreparedStatement) => void,
  budget?: ByteBudget,
): ResultSet | null {
  let last: ResultSet | null = null
  for (const statement of iterate(db, script)) {
    try {
      if (Date.now() > deadline) throw new Error("interrupted")
      guard?.(statement)
      const names = statement.getColumnNames()
      if (names.length > 0) {
        const rows: string[] = []
        while (statement.step()) {
          const row = statement.get()
          budget?.charge(row)
          rows.push(canonicalRow(row))
          if (rows.length > ROW_LIMIT) {
            throw new SqlCaseError(JudgeStatus.MEMORY_LIMIT_EXCEEDED, `查询结果超过 ${ROW_LIMIT} 行`)
          }
        }
        last = { columns: names.length, rows }
      } else {
        while (statement.step()) { /* 无结果集语句，推进到结束 */ }
      }
    } finally {
      statement.free()
    }
  }
  return last
}

/** dump 所有用户表：{表名: 列数 + 已排序的行}，表状态天然无序 */
function dumpTables(db: Database, budget?: ByteBudget) {
  const names = queryColumn(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  const state: Record<string, { columns: number; rows: string[] }> = {}
  for (const table of names) {
    const quoted = String(table).replaceAll('"', '""')
    const result = db.exec(`SELECT * FROM "${quoted}"`)
    const first = result[0]
    const rows = (first?.values ?? []).map((row) => {
      budget?.charge(row as unknown[])
      return canonicalRow(row as unknown[])
    })
    if (rows.length > ROW_LIMIT) {
      throw new SqlCaseError(JudgeStatus.MEMORY_LIMIT_EXCEEDED, `表 ${table} 超过 ${ROW_LIMIT} 行`)
    }
    state[String(table)] = {
      // 空表 exec 不返回结果，列数用 table_info 兜底
      columns: first?.columns.length ?? tableColumnCount(db, quoted),
      rows: rows.sort(),
    }
  }
  return state
}

function tableColumnCount(db: Database, quotedTable: string) {
  return db.exec(`PRAGMA table_info("${quotedTable}")`)[0]?.values.length ?? 0
}

function queryColumn(db: Database, sql: string) {
  return (db.exec(sql)[0]?.values ?? []).map((row) => row[0])
}

function trustedErrorText(message: string) {
  if (message.includes("interrupted")) return "超时"
  return truncate(message)
}

/** 执行受信脚本（初始化/标准答案），任何失败都是出题问题 → SYSTEM_ERROR */
function executeTrusted(db: Database, script: string, deadline: number, prefix: string) {
  try {
    return executeStatements(db, script, deadline)
  } catch (error) {
    if (error instanceof SqlCaseError) {
      throw new SqlCaseError(JudgeStatus.SYSTEM_ERROR, `${prefix}: ${error.detail}`)
    }
    throw new SqlCaseError(JudgeStatus.SYSTEM_ERROR, `${prefix}: ${trustedErrorText(String((error as Error).message))}`)
  }
}

/** 带防护执行学生 SQL，异常映射为学生级 JudgeStatus */
function runStudent(
  db: Database,
  script: string,
  mode: string,
  deadline: number,
  memoryLimitMb: number,
) {
  // 查询题只读：PRAGMA query_only 是 SQLite 原生开关，替代旧实现的 authorizer 白名单
  if (mode === "query") db.run("PRAGMA query_only=1")
  // 把题目的 memoryLimit 变成学生看得见的约束，替代旧实现的 setlimit(LIMIT_LENGTH)
  const budget = new ByteBudget(Math.max(Math.trunc(memoryLimitMb), 1) * 1024 * 1024)
  try {
    const last = executeStatements(db, script, deadline, (statement) => {
      // query_only 自己就是个 PRAGMA，不拦 PRAGMA 的话学生一句 `PRAGMA query_only=0`
      // 就把只读关掉了。旧实现的 authorizer 把 SQLITE_PRAGMA 一律拒掉，这里对齐它。
      // 教学场景下学生也没有用 PRAGMA 的正当需求，两种题型一律拒。
      if (leadingKeyword(statement) === "PRAGMA") {
        throw new SqlCaseError(JudgeStatus.RUNTIME_ERROR, "禁止使用 PRAGMA 语句")
      }
      // 兜底：万一漏掉某种改设置的写法，限制在每条语句前都重放一遍
      applyLimits(db, memoryLimitMb)
      if (mode === "query") db.run("PRAGMA query_only=1")
    }, budget)
    if (mode === "query") return last
    return dumpTables(db, budget)
  } catch (error) {
    if (error instanceof SqlCaseError) throw error
    const message = String((error as Error).message)
    if (message.includes("interrupted")) {
      throw new SqlCaseError(JudgeStatus.CPU_TIME_LIMIT_EXCEEDED, "SQL 执行超时")
    }
    if (message.includes("database or disk is full")) {
      throw new SqlCaseError(JudgeStatus.MEMORY_LIMIT_EXCEEDED, "数据量超出内存限制")
    }
    // WASM 堆触顶（zeroblob/group_concat 构造出的超大单值）或 SQLite 自身的长度上限
    if (message.includes("too big") || message.includes("out of memory") || message.includes("Aborted")) {
      throw new SqlCaseError(JudgeStatus.MEMORY_LIMIT_EXCEEDED, "单个数据值超出内存限制")
    }
    if (message.includes("readonly database")) {
      throw new SqlCaseError(JudgeStatus.RUNTIME_ERROR, "本题为查询题，禁止修改数据或表结构（INSERT/UPDATE/DELETE/CREATE 等）")
    }
    if (SYNTAX_ERROR_MARKERS.some((marker) => message.includes(marker))) {
      throw new SqlCaseError(JudgeStatus.COMPILE_ERROR, truncate(message))
    }
    throw new SqlCaseError(JudgeStatus.RUNTIME_ERROR, truncate(message))
  } finally {
    if (mode === "query") {
      try { db.run("PRAGMA query_only=0") } catch { /* 连接可能已不可用 */ }
    }
  }
}

function compare(
  expected: unknown,
  actual: unknown,
  mode: string,
  orderSensitive: boolean,
) {
  if (mode === "query") {
    const exp = expected as ResultSet
    const act = actual as ResultSet
    if (exp.columns !== act.columns) return false
    if (orderSensitive) return exp.rows.join("") === act.rows.join("")
    return [...exp.rows].sort().join("") === [...act.rows].sort().join("")
  }
  return JSON.stringify(expected) === JSON.stringify(actual)
}

export interface RunCaseOptions {
  mode: "query" | "modify"
  orderSensitive: boolean
  timeLimitMs: number
  memoryLimitMb: number
  /** 阶段回调，子进程据此写 stderr 标记，父进程据此收紧兜底 SIGKILL 时限 */
  onPhase?: (phase: "prepare" | "student") => void
}

/**
 * 受信脚本（初始化 + 标准答案）**合计**的墙钟预算。
 * 父进程按同一口径算兜底时限，两边必须用这一个函数，别各写各的。
 */
export function trustedBudgetMs(timeLimitMs: number) {
  return Math.max(timeLimitMs * 5, 10_000)
}

/** 题目页展示数据的墙钟预算 */
export const DISPLAY_BUDGET_MS = 10_000

export interface CaseResult {
  test_case: string
  result: JudgeStatusValue
  cpu_time: number
  real_time: number
  memory: number
  signal: number
  exit_code: number
  error: number
  output_md5: string
  error_message: string | null
}

/**
 * 判一个测试点，返回与外部 judger 单测试点同构的结构。
 * 学生错误（CE/WA/TLE/MLE/RE）体现在返回值里；出题配置错误抛 SqlCaseError(SYSTEM_ERROR)。
 */
export async function runCase(
  initSql: string,
  refSql: string,
  studentSql: string,
  options: RunCaseOptions,
): Promise<CaseResult> {
  const SQL = await sqlEngine()
  options.onPhase?.("prepare")
  // 受信脚本的运行上限放宽，避免出题数据较大时误报；仍防子进程永久阻塞。
  // 三段受信执行（两次初始化 + 一次标准答案）共用同一个 deadline，
  // 这样"受信阶段总耗时"有确定上限，父进程才能算出匹配的兜底时限。
  const trustedDeadline = Date.now() + trustedBudgetMs(options.timeLimitMs)

  let expected: unknown
  const refDb = newDatabase(SQL, options.memoryLimitMb)
  try {
    executeTrusted(refDb, initSql, trustedDeadline, "初始化脚本执行失败")
    const last = executeTrusted(refDb, refSql, trustedDeadline, "标准答案执行失败")
    if (options.mode === "query") {
      expected = last
    } else {
      try {
        expected = dumpTables(refDb)
      } catch (error) {
        throw new SqlCaseError(JudgeStatus.SYSTEM_ERROR, `标准答案结果超出限制: ${(error as SqlCaseError).detail}`)
      }
    }
  } finally {
    refDb.close()
  }
  if (options.mode === "query" && expected === null) {
    throw new SqlCaseError(JudgeStatus.SYSTEM_ERROR, "标准答案未产生查询结果集")
  }

  const result: CaseResult = {
    test_case: "",
    result: JudgeStatus.ACCEPTED,
    cpu_time: 0,
    real_time: 0,
    memory: 0,
    signal: 0,
    exit_code: 0,
    error: 0,
    output_md5: "",
    error_message: null,
  }

  const studentDb = newDatabase(SQL, options.memoryLimitMb)
  let actual: unknown
  let elapsed = 0
  try {
    executeTrusted(studentDb, initSql, trustedDeadline, "初始化脚本执行失败")
    options.onPhase?.("student")
    const start = Date.now()
    try {
      actual = runStudent(
        studentDb,
        studentSql,
        options.mode,
        start + options.timeLimitMs,
        options.memoryLimitMb,
      )
    } catch (error) {
      elapsed = Date.now() - start
      const failure = error as SqlCaseError
      return { ...result, result: failure.result, error_message: failure.detail, cpu_time: elapsed, real_time: elapsed }
    }
    elapsed = Date.now() - start
  } finally {
    studentDb.close()
  }

  result.cpu_time = elapsed
  result.real_time = elapsed
  if (options.mode === "query" && (actual === null || actual === undefined)) {
    result.result = JudgeStatus.WRONG_ANSWER
    result.error_message = "提交的 SQL 未产生查询结果集"
  } else if (!compare(expected, actual, options.mode, options.orderSensitive)) {
    result.result = JudgeStatus.WRONG_ANSWER
  }
  return result
}

// ---------------------------------------------------------------- 题目页展示数据

function displayValue(value: unknown) {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex")
  return value as string | number | null
}

interface DisplayTable {
  name: string
  columns: { name: string; type: string }[]
  rows: (string | number | null)[][]
  total_rows: number
  truncated: boolean
  dropped?: boolean
}

/** 按建表顺序 dump 用户表的原始行用于展示（区别于 dumpTables 的归一化判题态） */
function dumpDisplayTables(db: Database, only?: Set<string>): DisplayTable[] {
  const names = queryColumn(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  const tables: DisplayTable[] = []
  for (const raw of names) {
    const name = String(raw)
    if (only && !only.has(name)) continue
    const quoted = name.replaceAll('"', '""')
    const columns = (db.exec(`PRAGMA table_info("${quoted}")`)[0]?.values ?? []).map((row) => ({
      name: String(row[1]),
      type: String(row[2] ?? ""),
    }))
    const total = Number(db.exec(`SELECT COUNT(*) FROM "${quoted}"`)[0]?.values[0]?.[0] ?? 0)
    const rows = (db.exec(`SELECT * FROM "${quoted}" LIMIT ${DISPLAY_ROW_LIMIT}`)[0]?.values ?? [])
      .map((row) => (row as unknown[]).map(displayValue))
    tables.push({ name, columns, rows, total_rows: total, truncated: total > DISPLAY_ROW_LIMIT })
  }
  return tables
}

/**
 * 给查询结果的列名标上类型：按列名回查数据表的声明类型，与数据表展示同源（如 VARCHAR(20)）。
 * 表达式/聚合列（COUNT(*)、别名等）在数据表里无同名列，类型留空（前端隐藏）。
 */
function queryResultColumns(names: string[], tables: DisplayTable[]) {
  const types = new Map<string, string>()
  for (const table of tables) {
    for (const column of table.columns) types.set(column.name, column.type)
  }
  return names.map((name) => ({ name, type: types.get(name) ?? "" }))
}

/** 生成题目页展示数据：初始数据表 + 期望结果。失败一律抛 SqlCaseError（出题配置问题） */
export async function buildDisplay(
  initSql: string,
  refSql: string,
  mode: "query" | "modify",
  memoryLimitMb = 64,
) {
  const SQL = await sqlEngine()
  const db = newDatabase(SQL, memoryLimitMb)
  const deadline = Date.now() + DISPLAY_BUDGET_MS
  try {
    executeTrusted(db, initSql, deadline, "初始化脚本执行失败")
    const tables = dumpDisplayTables(db)

    if (mode === "query") {
      let expected: unknown = null
      try {
        for (const statement of iterate(db, refSql)) {
          try {
            const names = statement.getColumnNames()
            if (names.length === 0) { while (statement.step()) { /* 无结果集 */ } ; continue }
            const rows: unknown[][] = []
            while (statement.step()) {
              rows.push(statement.get())
              if (rows.length > ROW_LIMIT) {
                throw new SqlCaseError(JudgeStatus.SYSTEM_ERROR, `标准答案结果超过 ${ROW_LIMIT} 行`)
              }
            }
            expected = {
              columns: queryResultColumns(names, tables),
              rows: rows.slice(0, DISPLAY_ROW_LIMIT).map((row) => row.map(displayValue)),
              total_rows: rows.length,
              truncated: rows.length > DISPLAY_ROW_LIMIT,
            }
          } finally {
            statement.free()
          }
        }
      } catch (error) {
        if (error instanceof SqlCaseError) throw error
        throw new SqlCaseError(JudgeStatus.SYSTEM_ERROR, `标准答案执行失败: ${trustedErrorText(String((error as Error).message))}`)
      }
      if (expected === null) {
        throw new SqlCaseError(JudgeStatus.SYSTEM_ERROR, "标准答案未产生查询结果集")
      }
      return { tables, expected }
    }

    const before = dumpTables(db)
    executeTrusted(db, refSql, deadline, "标准答案执行失败")
    const after = dumpTables(db)
    const changed = new Set<string>()
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[name]) !== JSON.stringify(after[name])) changed.add(name)
    }
    if (changed.size === 0) {
      throw new SqlCaseError(JudgeStatus.SYSTEM_ERROR, "标准答案未修改任何表数据，请检查题目配置")
    }
    const changedTables = dumpDisplayTables(db, changed)
    // 被标准答案 DROP 的表已不在库中，用初始展示数据补齐条目（前端据 dropped 提示「表已删除」）
    const existing = new Set(changedTables.map((table) => table.name))
    for (const table of tables) {
      if (changed.has(table.name) && !existing.has(table.name)) {
        changedTables.push({ ...table, rows: [], total_rows: 0, truncated: false, dropped: true })
      }
    }
    return { tables, expected: { changed_tables: changedTables } }
  } finally {
    db.close()
  }
}

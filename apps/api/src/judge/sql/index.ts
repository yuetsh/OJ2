import { resolve } from "node:path"

import { JudgeStatus, type JudgeStatusValue } from "../status"
import type { CaseResult } from "./engine"
import type { SqlJob } from "./child"

/**
 * SQL 作业的父进程侧：起一个短命子进程跑，到点 SIGKILL。
 *
 * 为什么非要子进程：SQLite 查询在原生代码里执行，实测 Worker.terminate() 抢占不了
 * （递归 CTE 死循环能把整个 worker 卡死），只有 OS 的 SIGKILL 可靠。
 *
 * 内存交给 OS：`ulimit -d`（数据段）给子进程封顶，触顶时 WASM 抛可捕获错误，
 * 子进程照常回报 MEMORY_LIMIT_EXCEEDED。
 *
 * **必须用 -d 不能用 -v。** -v 限的是虚拟地址空间，而 JS 引擎会预留巨量地址，
 * 实测 -v 之下 Bun 退出时有概率 panic（SIGILL）—— 结果早已写出但进程异常终止，
 * 父进程读到空串误判成超时，时好时坏。-d 限的是实际提交的内存（Linux 4.7 起
 * 也覆盖匿名 mmap），512MB 下正常判题稳定、`hex(zeroblob(2e8))` 被拦。
 */

/** 子进程数据段上限（KB）。低于 512MB Bun 自己起不来 */
const CHILD_DATA_LIMIT_KB = 512 * 1024
/** 父进程的兜底墙钟。比作业自报的时限宽裕，只负责杀掉真正跑飞的进程 */
const HARD_TIMEOUT_SLACK_MS = 15_000

export interface SqlJobFailure {
  ok: false
  result: JudgeStatusValue
  message: string
}

type SqlJobOutcome<T> = { ok: true; value: T } | SqlJobFailure

async function runJob<T>(job: SqlJob, budgetMs: number): Promise<SqlJobOutcome<T>> {
  const entry = resolve(import.meta.dir, "child.ts")
  // 经 sh 起是为了用 ulimit —— Bun.spawn 没有直接设 rlimit 的接口
  const child = Bun.spawn(
    ["sh", "-c", `ulimit -d ${CHILD_DATA_LIMIT_KB}; exec "$0" run "$1"`, process.execPath, entry],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  )
  child.stdin.write(JSON.stringify(job))
  await child.stdin.end()

  const timer = setTimeout(() => child.kill("SIGKILL"), budgetMs + HARD_TIMEOUT_SLACK_MS)
  let stdout = ""
  let stderr = ""
  try {
    ;[stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    await child.exited
  } finally {
    clearTimeout(timer)
  }

  if (!stdout.trim()) {
    // 子进程没来得及写结果就没了 —— 要么被我们 SIGKILL，要么被内核 OOM 掉。
    // 用 stderr 里的阶段标记区分：卡在受信脚本是出题问题，卡在学生 SQL 是超时。
    const phase = stderr.includes("@phase:") ? stderr.split("@phase:")[1]?.split("\n")[0] : null
    if (phase === "display") {
      return { ok: false, result: JudgeStatus.SYSTEM_ERROR, message: "生成展示数据超时或内存超限，请检查初始化脚本与标准答案" }
    }
    return { ok: false, result: JudgeStatus.CPU_TIME_LIMIT_EXCEEDED, message: "SQL 执行超时" }
  }

  try {
    const parsed = JSON.parse(stdout) as
      | { ok: true; case?: CaseResult; display?: unknown }
      | SqlJobFailure
    if (!parsed.ok) return parsed
    return { ok: true, value: (parsed.case ?? parsed.display) as T }
  } catch {
    return { ok: false, result: JudgeStatus.SYSTEM_ERROR, message: "SQL 判题子进程返回了无法解析的结果" }
  }
}

export function runSqlCase(job: Extract<SqlJob, { kind: "judge" }>) {
  return runJob<CaseResult>(job, Math.max(job.timeLimitMs * 5, 10_000))
}

export function buildSqlDisplay(initSql: string, refSql: string, mode: "query" | "modify") {
  return runJob<{ tables: unknown[]; expected: unknown }>(
    { kind: "display", initSql, refSql, mode },
    10_000,
  )
}

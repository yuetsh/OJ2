/**
 * SQL 判题子进程的入口。
 *
 * 单独起进程的唯一理由是**能被杀掉**：SQLite 的查询跑在原生代码里，
 * 实测 Worker.terminate() 抢占不了，只有 OS 的 SIGKILL 可靠。
 * 父进程见 `./index.ts`。
 *
 * 协议：stdin 读一段 JSON 作业，stdout 写一段 JSON 结果；
 * 阶段标记写 stderr，父进程据此收紧兜底时限、并判断超时该算谁的。
 *
 * 这个文件**不是**独立入口，而是由 `src/main.ts` 的 `sql-child` 子命令调用。
 * 原因：`bun build --compile` 之后磁盘上没有 child.ts 可以让父进程去 spawn，
 * 只能让二进制自己按 argv 分发到这里。
 */

import { writeSync } from "node:fs"

import { buildDisplay, runCase, SqlCaseError } from "./engine"
import { JudgeStatus } from "../status"

export type SqlJob =
  | {
      kind: "judge"
      initSql: string
      refSql: string
      studentSql: string
      mode: "query" | "modify"
      orderSensitive: boolean
      timeLimitMs: number
      memoryLimitMb: number
    }
  | { kind: "display"; initSql: string; refSql: string; mode: "query" | "modify" }

/**
 * 写阶段标记。必须用 writeSync：父进程正是靠这个标记决定「多久之后 SIGKILL」
 * 以及「超时算谁的」，走异步 stderr 的话标记可能还在缓冲里就被杀掉了。
 */
function markPhase(phase: string) {
  const bytes = new TextEncoder().encode(`@phase:${phase}\n`)
  let written = 0
  while (written < bytes.length) {
    written += writeSync(2, bytes, written, bytes.length - written)
  }
}

/**
 * 写完结果立刻硬退出，不走 Bun 的正常 teardown。
 *
 * 实测在 `ulimit -v` 之下，Bun 退出时的清理有概率撞上地址空间上限而 panic
 * （SIGILL，exit 132）—— 结果其实已经写到 stdout 了，但进程异常终止会让父进程
 * 读到空串，进而误判成超时。这个 panic 是不确定的，同样的输入时好时坏，
 * 正是最难查的那种。这里跳过 teardown：子进程本来就是一次性的，没有要优雅关闭的资源。
 */
function finish(payload: unknown): never {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  // 直接写 fd 1 并确认写完，再自杀。不用 process.exit()：实测它仍会走一段清理，
  // 在 ulimit 之下有概率 panic（SIGILL，6 次里 2 次），而结果早已写出，
  // 父进程却因进程异常终止读到空串、误判成超时 —— 时好时坏，最难查的那种。
  let written = 0
  while (written < bytes.length) {
    written += writeSync(1, bytes, written, bytes.length - written)
  }
  process.kill(process.pid, "SIGKILL")
  throw new Error("unreachable")
}

/** 子进程入口。由 `src/main.ts` 的 `sql-child` 子命令调用，不在导入时自动执行 */
export async function runSqlChild() {
  const raw = await new Response(Bun.stdin.stream()).text()
  const job = JSON.parse(raw) as SqlJob
  try {
    if (job.kind === "display") {
      markPhase("display")
      const display = await buildDisplay(job.initSql, job.refSql, job.mode)
      finish({ ok: true, display })
    }
    // 阶段由 runCase 内部回调标记：prepare（受信脚本）→ student（学生 SQL）
    const result = await runCase(job.initSql, job.refSql, job.studentSql, {
      mode: job.mode,
      orderSensitive: job.orderSensitive,
      timeLimitMs: job.timeLimitMs,
      memoryLimitMb: job.memoryLimitMb,
      onPhase: markPhase,
    })
    finish({ ok: true, case: result })
  } catch (error) {
    if (error instanceof SqlCaseError) {
      finish({ ok: false, result: error.result, message: error.detail })
    }
    // WASM 堆触顶时 emscripten 抛的是普通 Error（"Aborted"/"out of memory"），
    // 到这里说明连引擎自身都没撑住，按内存超限报，不当成出题人的错
    const message = String((error as Error)?.message ?? error)
    const memoryish = message.includes("out of memory") || message.includes("Aborted")
    finish({
      ok: false,
      result: memoryish ? JudgeStatus.MEMORY_LIMIT_EXCEEDED : JudgeStatus.SYSTEM_ERROR,
      message: memoryish ? "内存超出限制" : message.slice(0, 200),
    })
  }
}

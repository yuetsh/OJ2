import { selfCommand } from "../../runtime"
import { JudgeStatus, type JudgeStatusValue } from "../status"
import { DISPLAY_BUDGET_MS, trustedBudgetMs, type CaseResult } from "./engine"
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
 *
 * ## 兜底时限是分阶段的
 *
 * 单条 SQL 一旦进了 SQLite 的 step() 就打断不了（见 engine.ts 的说明），所以
 * 跑飞的语句只能等这里的 SIGKILL。如果整个作业只给一个宽松的兜底时限，
 * 1 秒时限的题也要等十几秒才判超时 —— 判题池就那么几个槽，一个学生提几发
 * 死循环就能把所有人堵住。
 *
 * 所以子进程用 stderr 报阶段（`@phase:`），父进程边读边换表：
 * 受信阶段（出题人的初始化脚本、标准答案）给足预算，一进学生 SQL 就把兜底
 * 收到「题目时限 + 2s」。跑飞的学生语句最多多占 2 秒。
 *
 * 阶段还决定超时算谁的：卡在 prepare/display 是出题配置问题（SYSTEM_ERROR），
 * 卡在 student 才是学生超时（TLE）。
 */

/**
 * 递归闸的标记环境变量。
 *
 * ## 为什么必须有这道闸
 *
 * 这里 spawn 的是**进程自己**（`process.execPath` + 子命令）。正常情况下入口的
 * argv 分发会把它引到 `runSqlChild()`，跑完就退出。但只要分发这一环出问题 ——
 * 子命令改了名没同步、compose 里 command 写错、有人拿别的入口编了个二进制 ——
 * 「起自己」就变成「把整个程序再跑一遍」，而那一遍又会 spawn 一个自己，指数增长。
 *
 * 这不是假想：开发阶段用一个没有 argv 分发的临时入口编了个二进制，一跑就是
 * 递归 fork 105MB 的进程，几秒内触发 global OOM，内核把开发机的终端杀了。
 * 同样的错误发生在服务器上就是判题机连同数据库一起被拖死。
 *
 * 闸的逻辑很简单：父进程 spawn 时打上这个标记，带标记的进程一律拒绝再 spawn。
 * 递归最多一层就停在一条明确的 SYSTEM_ERROR 上，而不是吃光机器。
 */
const CHILD_MARKER = "OJ2_SQL_CHILD"
/** 子进程数据段上限（KB）。低于 512MB Bun 自己起不来 */
const CHILD_DATA_LIMIT_KB = 512 * 1024
/** 进程启动 + WASM 初始化 + JSON 收发的余量 */
const STARTUP_SLACK_MS = 3_000
/** 学生阶段的兜底余量：只用来覆盖单条语句无法打断这一段 */
const STUDENT_SLACK_MS = 2_000

export interface SqlJobFailure {
  ok: false
  result: JudgeStatusValue
  message: string
}

type SqlJobOutcome<T> = { ok: true; value: T } | SqlJobFailure

interface JobBudget {
  /** 受信阶段（初始化脚本 + 标准答案）合计预算 */
  trustedMs: number
  /** 学生 SQL 的预算；display 作业没有学生阶段，传 null */
  studentMs: number | null
}

const PHASE_FAILURE: Record<string, SqlJobFailure> = {
  display: {
    ok: false,
    result: JudgeStatus.SYSTEM_ERROR,
    message: "生成展示数据超时或内存超限，请检查初始化脚本与标准答案",
  },
  prepare: {
    ok: false,
    result: JudgeStatus.SYSTEM_ERROR,
    message: "初始化脚本或标准答案超时/内存超限，请检查题目配置",
  },
  student: { ok: false, result: JudgeStatus.CPU_TIME_LIMIT_EXCEEDED, message: "SQL 执行超时" },
}

async function runJob<T>(job: SqlJob, budget: JobBudget): Promise<SqlJobOutcome<T>> {
  // 递归闸。子进程里绝不允许再 spawn 子进程 —— 见文件头「为什么必须有这道闸」。
  if (process.env[CHILD_MARKER]) {
    return {
      ok: false,
      result: JudgeStatus.SYSTEM_ERROR,
      message: "SQL 判题子进程试图再起子进程，已阻断（入口子命令分发可能不正确）",
    }
  }

  // 起的是「自己」：开发时是 bun + main.ts，编译后就是二进制自身，见 runtime.ts。
  // 不能写死 child.ts 的路径 —— 单二进制里那个文件根本不存在。
  const self = selfCommand("sql-child")
  // 经 sh 起是为了用 ulimit —— Bun.spawn 没有直接设 rlimit 的接口。
  // "$@" 原样透传，免得路径里有空格时被词法拆开。
  const child = Bun.spawn(
    ["sh", "-c", `ulimit -d ${CHILD_DATA_LIMIT_KB}; exec "$@"`, "sh", ...self],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, [CHILD_MARKER]: "1" },
    },
  )
  child.stdin.write(JSON.stringify(job))
  await child.stdin.end()

  let timer = setTimeout(() => child.kill("SIGKILL"), budget.trustedMs + STARTUP_SLACK_MS)
  let phase = ""
  // stderr 要边读边看：阶段标记一到就得马上换兜底时限，攒到进程结束再读就没意义了
  const readStderr = (async () => {
    const decoder = new TextDecoder()
    const reader = (child.stderr as ReadableStream<Uint8Array>).getReader()
    let text = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      const marks = text.match(/@phase:(\w+)/g)
      const latest = marks?.[marks.length - 1]?.slice("@phase:".length)
      if (latest && latest !== phase) {
        phase = latest
        if (phase === "student" && budget.studentMs !== null) {
          clearTimeout(timer)
          timer = setTimeout(() => child.kill("SIGKILL"), budget.studentMs + STUDENT_SLACK_MS)
        }
      }
    }
  })()

  let stdout = ""
  try {
    ;[stdout] = await Promise.all([new Response(child.stdout).text(), readStderr])
    await child.exited
  } finally {
    clearTimeout(timer)
  }

  if (!stdout.trim()) {
    // 子进程没来得及写结果就没了 —— 要么被我们 SIGKILL，要么被内核 OOM 掉。
    // 按最后一个阶段标记归因：卡在受信脚本是出题问题，卡在学生 SQL 才是超时。
    return (
      PHASE_FAILURE[phase] ?? {
        ok: false,
        result: JudgeStatus.SYSTEM_ERROR,
        message: "SQL 判题子进程异常退出",
      }
    )
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
  return runJob<CaseResult>(job, {
    trustedMs: trustedBudgetMs(job.timeLimitMs),
    studentMs: job.timeLimitMs,
  })
}

export function buildSqlDisplay(initSql: string, refSql: string, mode: "query" | "modify") {
  return runJob<{ tables: unknown[]; expected: unknown }>(
    { kind: "display", initSql, refSql, mode },
    { trustedMs: DISPLAY_BUDGET_MS, studentMs: null },
  )
}

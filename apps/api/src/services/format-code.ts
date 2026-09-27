import { config } from "../config"

export class CodeFormatError extends Error {
  constructor(
    message: string,
    readonly kind: "syntax" | "tool",
  ) {
    super(message)
  }
}

async function runFormatter(command: string[], code: string) {
  let process: ReturnType<typeof Bun.spawn>
  try {
    process = Bun.spawn(command, {
      stdin: new Blob([code]),
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (error) {
    throw new CodeFormatError(String(error), "tool")
  }

  const timeout = setTimeout(() => process.kill(), 5_000)
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout as ReadableStream<Uint8Array>).text(),
    new Response(process.stderr as ReadableStream<Uint8Array>).text(),
  ])
  clearTimeout(timeout)
  return { exitCode, stdout, stderr }
}

function formatSql(code: string) {
  return (
    code
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) =>
        statement.replace(
          /\b(select|from|where|join|left|right|inner|outer|on|group by|order by|having|limit|insert into|values|update|set|delete from|create table|drop table|alter table|and|or|as)\b/gi,
          (keyword) => keyword.toUpperCase(),
        ),
      )
      .join(";\n\n") + (code.trim().endsWith(";") ? ";" : "")
  )
}

/**
 * 用 CPython 编译一遍（只编译不执行），有语法错误就返回报错原文，没有返回 null。
 *
 * 这一步原来在浏览器里用 Skulpt 做，但 Skulpt 的报错九成是「bad input」「bad token」、
 * 只有行号没有列号，前端没法据此告诉学生错在哪。换成和判题机同版本的 CPython 之后，
 * 报错和判题机的编译错误一字不差，前端那张中文翻译表（pythonError.ts）两边通用。
 *
 * 输出刻意对齐判题机的 `err_info`：`format_exception_only` 再整体 strip，文件名也叫
 * solution.py。子进程里不 import 标准库之外的东西，python3-minimal 就够。
 *
 * 解释器起不来（开发机没装、路径配错）就当没检查，返回 undefined —— 放行之后判题机
 * 照样会判出编译错误，只是慢几秒。
 */
const SYNTAX_CHECK_SCRIPT = `
import sys, traceback
source = sys.stdin.buffer.read().decode("utf-8", "replace")
try:
    compile(source, "solution.py", "exec")
except SyntaxError as error:
    sys.stdout.write("".join(traceback.format_exception_only(error)).strip())
    sys.exit(1)
`

async function checkPythonSyntax(code: string): Promise<string | null | undefined> {
  let result: Awaited<ReturnType<typeof runFormatter>>
  try {
    result = await runFormatter([config.pythonPath, "-I", "-c", SYNTAX_CHECK_SCRIPT], code)
  } catch {
    return undefined
  }
  if (result.exitCode === 0) return null
  // 退出码 1 且有输出才是语法错误；别的（被超时杀掉、解释器自己报错）都当没检查
  return result.exitCode === 1 && result.stdout ? result.stdout : undefined
}

export async function formatCode(code: string, language: "python" | "c" | "cpp" | "sql") {
  if (language === "sql") return formatSql(code)

  if (language === "python") {
    const syntaxError = await checkPythonSyntax(code)
    if (syntaxError) throw new CodeFormatError(syntaxError, "syntax")
    const result = await runFormatter(
      [config.ruffPath, "format", "--stdin-filename", "code.py", "-"],
      code,
    )
    // CPython 都编译过了 ruff 还失败，是 ruff 的问题（比如还不认识新语法），
    // 不是学生的：按工具故障报，前端会原样提交
    if (result.exitCode !== 0) {
      throw new CodeFormatError(result.stderr || "ruff format failed", "tool")
    }
    return result.stdout
  }

  const filename = language === "c" ? "code.c" : "code.cpp"
  const result = await runFormatter(
    [
      config.clangFormatPath,
      `-assume-filename=${filename}`,
      "-style={BasedOnStyle: LLVM, IndentWidth: 4, BreakBeforeBraces: Attach}",
    ],
    code,
  )
  if (result.exitCode !== 0) {
    throw new CodeFormatError(result.stderr || "Formatting failed", "tool")
  }
  return result.stdout
}

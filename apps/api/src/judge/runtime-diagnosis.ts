import type { StatisticInfo } from "@oj2/contract"

/**
 * 运行时错误的诊断：把判题机的原始结果收成 `statistic_info.runtime_error`，
 * 前端再翻成中文（apps/web/src/oj/problem/utils/runtimeError.ts）。
 *
 * 原来学生拿到的只有「运行时错误」四个字：主判题是 `output: false`，Python 的回溯
 * 根本没回来；C 的信号值倒是有，但在 `info` 里，而 `info` 只给管理员。
 *
 * Python 的回溯要靠**重跑一次**拿（run.ts 的 diagnoseRuntimeError）：只拿第一个
 * 失败的测试点、打开 output 单独跑。不给主判题开 output —— 那样每个测试点的完整
 * 输出（每个最多 16MB）都会回到 worker，一个死循环打印就能把内存撑爆。
 *
 * **原文消息一律不存**。Python 的异常消息里常带着测试点的输入，比如
 * `invalid literal for int() with base 10: '1 2'`，给学生看就等于把隐藏数据放出去 ——
 * 故意写 `raise Exception(input())` 就能一个点一个点地套。所以只存：
 * - 异常类型和归好类的 `kind`（按消息的**句式**判，不取消息里的值）
 * - NameError / AttributeError 点名的名字，而且只在它**原样出现在学生代码里**时才存
 */
export type RuntimeErrorInfo = NonNullable<StatisticInfo["runtime_error"]>

const IDENTIFIER = /^[A-Za-z_]\w*$/

/** 按消息句式细分。键是异常类型，值是 [句式, kind]，从上往下取第一个对上的 */
const KINDS: Record<string, [RegExp, string][]> = {
  ValueError: [
    [/^invalid literal for int\(\)/, "int-parse"],
    [/^could not convert string to float/, "float-parse"],
    [/^(not enough|too many) values to unpack/, "unpack"],
    [/^math domain error/, "math-domain"],
  ],
  TypeError: [
    [/^can only concatenate str/, "str-concat"],
    [/^unsupported operand type/, "operand"],
    [/cannot be interpreted as an integer/, "not-int"],
    [/not supported between instances of/, "compare"],
    [/object is not callable/, "not-callable"],
    [/object is not subscriptable/, "not-subscriptable"],
    [/missing \d+ required positional argument/, "missing-arg"],
    [/^(list|string|tuple) indices must be integers/, "index-type"],
  ],
  IndexError: [[/out of range/, "index"]],
}

/** 名字在学生自己的代码里原样出现过才算数，否则它可能来自输入（`eval(input())`） */
function nameFromCode(name: string | undefined, code: string) {
  if (!name || !IDENTIFIER.test(name)) return undefined
  return new RegExp(`\\b${name}\\b`).test(code) ? name : undefined
}

/**
 * 从程序输出里解析 Python 回溯。stdout 和 stderr 在判题机里写的是同一个文件，
 * 所以回溯接在正常输出后面；只看末尾，取最后一段 Traceback（链式异常取最外层）。
 *
 * `prependLines` 是题目模板拼在学生代码前面的行数：判题跑的是
 * `${prepend}\n${code}\n${append}`，回溯里的行号要扣掉它才对得上编辑器。
 */
export function parsePythonTraceback(
  output: string,
  code: string,
  prependLines: number,
): RuntimeErrorInfo | null {
  const tail = output.slice(-16_000)
  const start = tail.lastIndexOf("Traceback (most recent call last):")
  if (start < 0) return null
  const lines = tail.slice(start).trimEnd().split("\n")

  const last = lines[lines.length - 1]!
  const head = last.match(/^([A-Za-z_][\w.]*)(?::\s?(.*))?$/)
  if (!head) return null
  const type = head[1]!.split(".").pop()!
  const message = head[2] ?? ""

  // 最后一个落在 solution.py 里的栈帧：错误发生在标准库里（statistics.mean([]) 之类）时，
  // 最后一帧是库文件，学生要看的是自己调它的那一行
  let sourceLine: number | null = null
  for (const line of lines) {
    const frame = line.match(/^\s*File "([^"]*)", line (\d+)/)
    if (frame && frame[1]!.endsWith("solution.py")) sourceLine = Number(frame[2])
  }
  const codeLines = code.split("\n").length
  const lineInCode = sourceLine === null ? null : sourceLine - prependLines
  const info: RuntimeErrorInfo = {
    line: lineInCode !== null && lineInCode >= 1 && lineInCode <= codeLines ? lineInCode : null,
    type,
  }

  const kind = KINDS[type]?.find(([pattern]) => pattern.test(message))?.[1]
  if (kind) info.kind = kind

  if (type === "NameError" || type === "UnboundLocalError") {
    const match = message.match(/^(?:name|cannot access local variable) '([^']+)'/)
    const name = nameFromCode(match?.[1], code)
    if (name) info.name = name
    const suggestion = message.match(/Did you mean: '([^']+)'\?/)?.[1]
    if (suggestion && IDENTIFIER.test(suggestion)) info.suggestion = suggestion
  } else if (type === "AttributeError") {
    const name = nameFromCode(message.match(/has no attribute '([^']+)'/)?.[1], code)
    if (name) info.name = name
  }
  return info
}

/** C / C++：没有回溯，信号和退出码就是全部线索。两个都为 0 时没什么可说的 */
export function nativeRuntimeError(signal: unknown, exitCode: unknown): RuntimeErrorInfo | null {
  const info: RuntimeErrorInfo = {}
  if (typeof signal === "number" && signal > 0) info.signal = signal
  if (typeof exitCode === "number" && exitCode !== 0) info.exit_code = exitCode
  return info.signal || info.exit_code ? info : null
}

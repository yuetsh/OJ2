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
 * - NameError / AttributeError / 部分 TypeError 点名的名字，而且只在它**原样出现在
 *   学生代码里**时才存
 */
export type RuntimeErrorInfo = NonNullable<StatisticInfo["runtime_error"]>

const IDENTIFIER = /^[A-Za-z_]\w*$/

/**
 * 值的类型比句式更能说明错在哪。消息里的类型名是 Python 按学生代码里的值报的，
 * 不来自输入，所以可以拿来分类。三种在 TypeError 和 AttributeError 里都会出现，
 * 句式五花八门（`int(input)`、`a, b = input`、`input[0]`、`input.split()`……），
 * 按句式分会被说成「类型不对」「对数字用了下标」，其实全是同一个错：
 */
const VALUE_KINDS: [RegExp, string][] = [
  // 函数名后面忘了写 ()，拿到的是函数本身
  [/\bbuiltin_function_or_method\b/, "func-value"],
  // print() / append() / sort() 的结果、没有 return 的函数的结果
  [/'NoneType'/, "none-value"],
  // 把 list 这个类型名当成了自己的列表变量：list[i]
  [/\btypes\.GenericAlias\b/, "type-name"],
  // map() 的结果不能直接 len()、下标
  [/'map' object is not subscriptable|object of type 'map' has no len/, "map-value"],
]

/**
 * 按消息句式细分。键是异常类型，值是 [句式, kind]，从上往下取第一个对上的。
 *
 * 表是照全库 9228 条 Python 运行时错误重跑出来的回溯定的（2026-09）：原来只有
 * 12 种，TypeError 过半掉进兜底，被说成「把文字当成数字」，而代码里往往连 input()
 * 都没有 —— 实际是参数个数不对、参数名拼错、`list.index(x)` 这类用法错误。
 */
const KINDS: Record<string, [RegExp, string][]> = {
  ValueError: [
    [/^invalid literal for int\(\)/, "int-parse"],
    [/^could not convert string to float/, "float-parse"],
    [/^(not enough|too many) values to unpack/, "unpack"],
    [/^math domain error/, "math-domain"],
    [/^empty separator/, "empty-sep"],
    [/(x not in list|is not in list)$/, "not-in-list"],
    [
      /^(unsupported format character|Format specifier missing precision|Invalid format specifier|Unknown format code|incomplete format)/,
      "format-spec",
    ],
  ],
  TypeError: [
    ...VALUE_KINDS,
    [/^can only concatenate str/, "str-concat"],
    [/^unsupported operand type/, "operand"],
    [/cannot be interpreted as an integer/, "not-int"],
    [/not supported between instances of/, "compare"],
    [/object is not callable/, "not-callable"],
    [/^type '\w+' is not subscriptable/, "type-subscript"],
    [/object is not subscriptable/, "not-subscriptable"],
    [/missing \d+ required positional argument/, "missing-arg"],
    // s[2, 2]：逗号让下标变成了一组值
    [/^(list|string|tuple) indices must be integers.*, not '?tuple'?$/, "index-comma"],
    [/^(list|string|tuple) indices must be integers/, "index-type"],
    [/^slice indices must be integers/, "slice-type"],
    [/unexpected keyword argument/, "keyword"],
    [/takes no keyword arguments/, "no-keyword"],
    [
      /^(descriptor '\w+' for '\w+' objects doesn't apply|unbound method \w+\.\w+\(\) needs an argument)/,
      "descriptor",
    ],
    [
      /takes (exactly one|no|at most \d+|at least \d+|\d+)( positional)? arguments?|expected (at least |at most )?\d+ arguments?, got \d+/,
      "arg-count",
    ],
    // 读进来的是文字，却拿去 % 取余、* 乘
    [/^not all arguments converted during string formatting/, "str-mod"],
    [/^can't multiply sequence by non-int/, "seq-mul"],
    [/^bad operand type for unary [+-]: 'str'/, "unary"],
    [/^cannot unpack non-iterable (int|float) object/, "unpack-number"],
    [/^(int|float)\(\) argument must be/, "convert-arg"],
    [/is not iterable/, "not-iterable"],
    [/has no len\(\)/, "no-len"],
  ],
  AttributeError: [
    ...VALUE_KINDS,
    [/attribute '\w+' is read-only/, "read-only"],
    // 数字没有 split() / count()：多半是先 int() 再 split()，顺序反了
    [/^'(int|float)' object has no attribute/, "number-attr"],
  ],
  IndexError: [[/out of range/, "index"]],
  // 程序本身编译过了，运行时的 SyntaxError 只可能来自 eval() / exec() 读到的内容
  SyntaxError: [[/./, "eval-syntax"]],
}

/**
 * TypeError 细分之后点名的名字：函数名（arg-count / no-keyword，消息开头的
 * `list.append()` / `insert expected` 取最后一段）、写错的参数名（keyword）、
 * 方法名（descriptor）、类型名（type-subscript）
 */
const TYPE_ERROR_NAMES: Record<string, RegExp> = {
  "arg-count": /^(?:\w+\.)*(\w+)(?:\(\) takes| expected)/,
  "no-keyword": /^(?:\w+\.)*(\w+)\(\) takes no keyword/,
  keyword: /unexpected keyword argument '([^']+)'/,
  descriptor: /^(?:descriptor '|unbound method \w+\.)(\w+)/,
  "type-subscript": /^type '([^']+)'/,
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
    // 用了 math.sqrt 却没 import math。Python 同时给了「Did you mean」时也是这个优先
    if (/Did you forget to import '/.test(message)) info.kind = "import"
  } else if (type === "TypeError" && kind && TYPE_ERROR_NAMES[kind]) {
    const name = nameFromCode(message.match(TYPE_ERROR_NAMES[kind])?.[1], code)
    if (name) info.name = name
    // 「Did you mean 'end'?」是 Python 从函数的参数表里挑的，不来自输入
    const suggestion = message.match(/Did you mean '([^']+)'\?/)?.[1]
    if (kind === "keyword" && suggestion && IDENTIFIER.test(suggestion))
      info.suggestion = suggestion
  } else if (type === "AttributeError") {
    const name = nameFromCode(message.match(/(?:has no attribute|attribute) '([^']+)'/)?.[1], code)
    if (name) info.name = name
    // 拼错方法名（spilt → split）占 AttributeError 的一半多，Python 从这个值的方法里挑的
    const suggestion = message.match(/Did you mean: '([^']+)'\?/)?.[1]
    if (suggestion && IDENTIFIER.test(suggestion)) info.suggestion = suggestion
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

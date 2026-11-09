import { PUNCTUATION_NAMES } from 'utils/pythonError'
import { findChinesePunctuation } from './chinesePunctuation'

/**
 * 看板娘在学生写代码时指出来的常见错误（交之前，停手一会儿就看）。
 *
 * 每一条都是拿生产库近 400 天的 4.4 万次 Python、4100 次 C/C++ 提交核过的（2026-11）：
 * 命中的提交几乎都没做对，同一个学生后来做对这道题时，做对的那份几乎都改掉了这一处。
 * 括号里是犯过的人数：
 *
 * - 中文标点（沿用 chinesePunctuation.ts，换的时候中文引号里的字原样留着）
 * - 函数名拼错（约 120 人）：pirnt、inout、folat、Print……；Python 里写 printf（22 人）单独说
 * - input("请输入…") 带提示语（168 人）：提示也会被输出，判题对不上
 * - if / for / def 行末缺冒号（95 人）
 * - 单独写 split(…) / append(…)（约 60 人）：要写成 s.split()、列表.append(x)
 * - 语言选错（28 + 11 人）：C 的代码选了 Python，或者反过来
 * - input() 没转 int 就拿来做减乘除、比大小（45 人）
 * - if x = 5: 条件里一个等号（23 人），C 写法混进 Python：i++、&&、||、!x（20 人）
 * - print = (…) / input = …（16 人），else if、If / For 大写、print "x"（各几人）
 * - C：没写 #include（23 人）
 * - 第二批（同样核过）：变量没定义（Python 语法树算是 298 人，这里用规则近似，见 undefinedNames）、
 *   整段没有 print（233 人）、括号没配对（77 人）、引号没配对（43 人）；没转 int 加上 a, b = input().split()
 *   和 x == 5 两种写法
 *
 * 量过、**不报**的（正确的代码里也大量出现，报了冤枉人）：sum = 0 这类拿内置函数名当变量、
 * 宽松的「没转 int」、C 的 printf("请输入")（很多 C 题本来就要输出中文）、scanf 少 &；
 * C 的 if (a = b)、if (…); 也试过，做对的提交里一样多（准确率 44%、33%），删了。
 *
 * 只认字符串和注释之外的代码：先把字符串内容、注释换成空格（行列不变）再找。
 */

export type LintRule =
  | 'punct'
  | 'wrongLangC'
  | 'wrongLangPython'
  | 'typo'
  | 'printf'
  | 'bareMethod'
  | 'inputPrompt'
  | 'colon'
  | 'assignInIf'
  | 'cOperator'
  | 'shadowBuiltin'
  | 'elseIf'
  | 'keywordCase'
  | 'printStatement'
  | 'noInt'
  | 'noInclude'
  | 'undefinedName'
  | 'noPrint'
  | 'unclosedBracket'
  | 'unclosedQuote'

export interface LintIssue {
  rule: LintRule
  /** 第几行，从 1 数 */
  line: number
  /** 填进台词的占位：{name} {right} 之类 */
  vars: Record<string, string | number>
  /** 同一处只说一次：规则 + 行 + 细节 */
  key: string
  /** 能安全地一键改的给出改法（传入整段代码，返回改好的），改不了的没有 */
  fix?: (code: string) => string
}

const PYTHON_COMMON = ['print', 'input', 'int', 'float', 'str', 'len', 'range', 'list', 'sum', 'max', 'min', 'abs', 'round', 'sorted', 'map']
/** Python 的全部内置名字（dir(builtins)，3.13），加上 __name__ 这类模块级的 */
const PYTHON_BUILTINS = new Set([
  'ArithmeticError', 'AssertionError', 'AttributeError', 'BaseException', 'BaseExceptionGroup', 'BlockingIOError', 'BrokenPipeError',
  'BufferError', 'BytesWarning', 'ChildProcessError', 'ConnectionAbortedError', 'ConnectionError', 'ConnectionRefusedError',
  'ConnectionResetError', 'DeprecationWarning', 'EOFError', 'Ellipsis', 'EncodingWarning', 'EnvironmentError', 'Exception',
  'ExceptionGroup', 'False', 'FileExistsError', 'FileNotFoundError', 'FloatingPointError', 'FutureWarning', 'GeneratorExit', 'IOError',
  'ImportError', 'ImportWarning', 'IndentationError', 'IndexError', 'InterruptedError', 'IsADirectoryError', 'KeyError',
  'KeyboardInterrupt', 'LookupError', 'MemoryError', 'ModuleNotFoundError', 'NameError', 'None', 'NotADirectoryError', 'NotImplemented',
  'NotImplementedError', 'OSError', 'OverflowError', 'PendingDeprecationWarning', 'PermissionError', 'ProcessLookupError',
  'PythonFinalizationError', 'RecursionError', 'ReferenceError', 'ResourceWarning', 'RuntimeError', 'RuntimeWarning', 'StopAsyncIteration',
  'StopIteration', 'SyntaxError', 'SyntaxWarning', 'SystemError', 'SystemExit', 'TabError', 'TimeoutError', 'True', 'TypeError',
  'UnboundLocalError', 'UnicodeDecodeError', 'UnicodeEncodeError', 'UnicodeError', 'UnicodeTranslateError', 'UnicodeWarning',
  'UserWarning', 'ValueError', 'Warning', 'ZeroDivisionError', 'abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool', 'breakpoint',
  'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex', 'copyright', 'credits', 'delattr', 'dict', 'dir', 'divmod',
  'enumerate', 'eval', 'exec', 'exit', 'filter', 'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex',
  'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'license', 'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next',
  'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'quit', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice',
  'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip',
  '__name__', '__file__', '__doc__', '_',
]) // prettier-ignore
const PYTHON_KEYWORDS = new Set([
  'if', 'elif', 'else', 'for', 'while', 'def', 'return', 'and', 'or', 'not', 'in', 'is', 'lambda', 'class', 'try', 'except',
  'finally', 'with', 'as', 'import', 'from', 'pass', 'break', 'continue', 'global', 'nonlocal', 'yield', 'assert', 'del', 'raise',
  'True', 'False', 'None', 'match', 'case',
]) // prettier-ignore
/** 单独调用就是错的方法名：要挂在字符串、列表后面 */
const METHODS = new Set(['split', 'append', 'strip', 'lower', 'upper', 'replace', 'join', 'count', 'index', 'sort', 'pop', 'insert', 'find'])

/** 把字符串内容和注释换成空格（保留引号、换行，行列不变），只看代码 */
export function blankStringsAndComments(code: string, language: string) {
  const python = language === 'Python'
  const out = [...code]
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  while (i < code.length) {
    const ch = code[i]!
    if (python ? ch === '#' : code.startsWith('//', i)) {
      const end = code.indexOf('\n', i)
      const to = end < 0 ? code.length : end
      blank(i, to)
      i = to
      continue
    }
    if (!python && code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2)
      const to = end < 0 ? code.length : end + 2
      blank(i, to)
      i = to
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = python && code.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch
      let j = i + quote.length
      while (j < code.length && !code.startsWith(quote, j)) {
        if (code[j] === '\\') j++
        else if (quote.length === 1 && code[j] === '\n') break
        j++
      }
      blank(i + quote.length, Math.min(j, code.length))
      i = code.startsWith(quote, j) ? j + quote.length : j
      continue
    }
    i++
  }
  return out.join('')
}

function lineOf(code: string, index: number) {
  let line = 1
  for (let k = 0; k < index && k < code.length; k++) if (code[k] === '\n') line++
  return line
}

/** 编辑距离，两个相邻字母写反算一处（pirnt → print 是 1） */
function distance(a: string, b: string) {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1)
    }
  }
  return d[a.length]![b.length]!
}

/** 像哪个常用函数：短名字只许差 1 处，长的差 2 处；都不像是 null */
function lookalike(name: string) {
  const lower = name.toLowerCase()
  let best: string | null = null
  let bestD = Infinity
  for (const right of PYTHON_COMMON) {
    const d = distance(lower, right)
    if (d < bestD) {
      best = right
      bestD = d
    }
  }
  if (!best) return null
  return bestD <= (best.length <= 5 ? 1 : 2) ? best : null
}

/** 这段 Python 里自己定义过的名字：def、class、赋值、for 变量、import、as */
function definedNames(s: string) {
  const names = new Set<string>()
  for (const m of s.matchAll(/^\s*(?:def|class)\s+(\w+)/gm)) names.add(m[1]!)
  for (const m of s.matchAll(/(\w+(?:\s*,\s*\w+)*)\s*=(?!=)/g)) for (const n of m[1]!.split(',')) names.add(n.trim())
  for (const m of s.matchAll(/\bfor\s+([\w\s,]+?)\s+in\b/g)) for (const n of m[1]!.split(',')) names.add(n.trim())
  for (const m of s.matchAll(/^\s*(?:from\s+\w+\s+)?import\s+([\w\s,*]+)/gm)) for (const n of m[1]!.split(',')) names.add(n.trim().split(/\s+/)[0]!)
  for (const m of s.matchAll(/\bas\s+(\w+)/g)) names.add(m[1]!)
  for (const m of s.matchAll(/^\s*def\s+\w+\s*\(([^)]*)\)/gm)) for (const n of m[1]!.split(',')) names.add(n.trim().split(/[=:\s]/)[0]!)
  return names
}

/** 在 s（已去掉字符串注释）里找到的位置，按同样的位置去改 code */
function replaceAt(code: string, edits: { from: number; to: number; insert: string }[]) {
  let out = code
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  return out
}

function lintPython(code: string, s: string): LintIssue[] {
  const issues: LintIssue[] = []
  const at = (index: number) => lineOf(code, index)

  // 语言选错：C 的代码选了 Python。这时别的规则都没意义
  const cLike = /^\s*#\s*include\b|\bint\s+main\s*\(|\bscanf\s*\(/m.exec(code)
  if (cLike) return [{ rule: 'wrongLangC', line: at(cLike.index), vars: {}, key: 'wrongLangC' }]

  const defs = definedNames(s)
  // from math import * 带进来一堆名字（fabs 像 abs），这时不猜拼写
  const starImport = /^\s*from\s+\w+\s+import\s+\*/m.test(s)
  for (const m of s.matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)) {
    const name = m[1]!
    const index = m.index!
    if (PYTHON_KEYWORDS.has(name) || defs.has(name)) continue
    const line = at(index)
    if (name === 'printf') {
      issues.push({ rule: 'printf', line, vars: {}, key: `printf:${line}`, fix: renameCalls('printf', 'print') })
      continue
    }
    if (METHODS.has(name)) {
      issues.push({ rule: 'bareMethod', line, vars: { name }, key: `bareMethod:${line}:${name}` })
      continue
    }
    if (PYTHON_BUILTINS.has(name) || name === 'main' || starImport) continue
    const right = lookalike(name)
    if (right) issues.push({ rule: 'typo', line, vars: { name, right }, key: `typo:${line}:${name}`, fix: renameCalls(name, right) })
  }

  // input("请输入……")：提示文字会被打印进输出
  for (const m of s.matchAll(/\binput\(\s*[fr]?(["'])( *[^"'\n]*?)\1\s*\)/g)) {
    // s 里字符串内容是空格：原代码里同一段要有非空白字
    const raw = code.slice(m.index!, m.index! + m[0].length)
    if (!/input\(\s*[fr]?["'][^"'\n]*\S[^"'\n]*["']\s*\)/.test(raw)) continue
    const line = at(m.index!)
    issues.push({
      rule: 'inputPrompt',
      line,
      vars: {},
      key: `inputPrompt:${line}`,
      fix: (src) =>
        replaceAt(
          src,
          [...blankStringsAndComments(src, 'Python').matchAll(/\binput\(\s*[fr]?(["'])[^"'\n]*\1\s*\)/g)]
            .filter((it) => /\S/.test(src.slice(it.index!, it.index! + it[0].length).replace(/^input\(\s*[fr]?["']|["']\s*\)$/g, '')))
            .map((it) => ({ from: it.index!, to: it.index! + it[0].length, insert: 'input()' })),
        ),
    })
  }

  const lines = s.split('\n')
  lines.forEach((text, i) => {
    const line = i + 1
    const head = /^(\s*)(if|elif|else|for|while|def|class|try|except|finally)\b/.exec(text)
    const word = head?.[2]
    // else / try / finally 后面本来就只有冒号；if / for / def 后面得有东西（光一个 if 是还没写完）
    const bare = word === 'else' || word === 'try' || word === 'finally'
    const complete = bare ? /^\s*\w+\s*$/.test(text) : !!word && text.trim().length > word.length
    // 缺冒号：这行（字符串已去掉）一个冒号都没有。不能只看行末：if a == b: print(x) 冒号在中间。
    // 以 ( , \ 结尾的是条件没写完、换了行，不算
    if (word && complete && !text.includes(':') && !/[(,\\[{]\s*$/.test(text)) {
      {
        issues.push({
          rule: 'colon',
          line,
          vars: { word: word! },
          key: `colon:${line}`,
          fix: (src) => {
            const all = src.split('\n')
            const target = all[i]
            if (target === undefined) return src
            // 行末注释前面补冒号
            const blanked = blankStringsAndComments(src, 'Python').split('\n')[i] ?? target
            const end = blanked.replace(/\s+$/, '').length
            all[i] = target.slice(0, end) + ':' + target.slice(end)
            return all.join('\n')
          },
        })
      }
    }
    if (/^\s*else\s+if\b/.test(text)) {
      issues.push({ rule: 'elseIf', line, vars: {}, key: `elseIf:${line}`, fix: (src) => replaceLine(src, i, (t) => t.replace(/\belse\s+if\b/, 'elif')) })
    }
    // if x = 5:
    const cond = /^\s*(if|elif|while)\b(.*?)(?<![=!<>:])=(?!=)(.*):\s*$/.exec(text)
    if (cond && !/\(.*=.*\)/.test(cond[2]! + '=' + cond[3]!)) {
      issues.push({
        rule: 'assignInIf',
        line,
        vars: {},
        key: `assignInIf:${line}`,
        fix: (src) => replaceLine(src, i, (t) => t.replace(/(?<![=!<>:])=(?!=)/, '==')),
      })
    }
    // C 写法：i++、&&、||、!x
    const op = /\w(\+\+|--)|(&&)|(\|\|)|(?<![!=<>])(!)(?!=)/.exec(text)
    if (op) {
      const which = op[1] ?? op[2] ?? op[3] ?? op[4]!
      const right = which === '++' ? '+= 1' : which === '--' ? '-= 1' : which === '&&' ? 'and' : which === '||' ? 'or' : 'not'
      issues.push({ rule: 'cOperator', line, vars: { op: which, right }, key: `cOperator:${line}:${which}` })
    }
    // print = (…)：之后什么都打不出来。input = input() 之后不再读就没事，后面又调用 input() 才算
    const shadow = /^\s*(print|input)\s*=(?!=)/.exec(text)
    const calledAfter = (name: string) => new RegExp(`(?<![\\w.])${name}\\s*\\(`).test(lines.slice(i + 1).join('\n'))
    if (shadow && (shadow[1] === 'print' || calledAfter('input'))) {
      issues.push({ rule: 'shadowBuiltin', line, vars: { name: shadow[1]! }, key: `shadowBuiltin:${line}` })
    }
    // If / For 大写
    const kw = /^\s*(If|IF|For|FOR|While|WHILE|Else|ELSE|Elif|Def)\b/.exec(text)
    if (kw) {
      const right = kw[1]!.toLowerCase()
      issues.push({
        rule: 'keywordCase',
        line,
        vars: { name: kw[1]!, right },
        key: `keywordCase:${line}`,
        fix: (src) => replaceLine(src, i, (t) => t.replace(kw[1]!, right)),
      })
    }
    // print "x"（Python 2 的写法）
    if (/^\s*print\s+[^\s(=]/.test(text)) issues.push({ rule: 'printStatement', line, vars: {}, key: `printStatement:${line}` })
  })

  // x = input() 之后 x 拿来做减乘除、比大小、range(x)，整篇又没有 int(x) / float(x)
  for (const m of s.matchAll(/^\s*(\w+)\s*=\s*input\(\s*[^()]*\)\s*$/gm)) {
    const v = m[1]!
    if (new RegExp(`\\b(int|float|eval)\\(\\s*${v}\\b|^\\s*${v}\\s*=\\s*(int|float|eval)\\(`, 'm').test(s)) continue
    const use = new RegExp(`(?<![\\w.'"])${v}\\s*[-*/%](?!=)|[-*/%]\\s*${v}\\b(?!\\s*\\()|\\b${v}\\s*[<>]=?\\s*-?\\d|\\brange\\(\\s*${v}\\s*\\)`).exec(s)
    // 和数字比相等：input() 拿到的是文字，"5" == 5 永远不成立
    const equal = use ?? new RegExp(`\\b${v}\\s*[=!]=\\s*-?\\d|-?\\d\\s*[=!]=\\s*${v}\\b`).exec(s)
    if (equal) issues.push({ rule: 'noInt', line: at(equal.index), vars: { name: v }, key: `noInt:${v}` })
  }
  // a, b = input().split() 之后拿来算（或者 a + b 想求和，其实是拼字）
  for (const m of s.matchAll(/^\s*(\w+(?:\s*,\s*\w+)+)\s*=\s*input\(\s*[^()]*\)\.split\([^()]*\)\s*$/gm)) {
    const vs = m[1]!.split(',').map((v) => v.trim())
    if (vs.some((v) => new RegExp(`\\b(int|float|eval)\\(\\s*${v}\\b|^\\s*${v}\\s*=\\s*(int|float)\\(`, 'm').test(s))) continue
    let use: RegExpExecArray | null = null
    for (const v of vs) {
      use ??= new RegExp(`(?<![\\w.'"])${v}\\s*[-*/%](?!=)|[-*/%]\\s*${v}\\b(?!\\s*\\()|\\b${v}\\s*[<>]=?\\s*-?\\d|\\brange\\(\\s*${v}\\s*\\)`).exec(s)
    }
    use ??= new RegExp(`\\b${vs[0]}\\s*\\+\\s*${vs[1]}\\b|\\b${vs[1]}\\s*\\+\\s*${vs[0]}\\b`).exec(s)
    if (use) issues.push({ rule: 'noInt', line: at(use.index), vars: { name: vs.join('、') }, key: `noInt:${vs.join(',')}` })
  }

  // 整段没有 print：算完了打不出来。写到一半也是这样，所以页面那边等停手久一点才说
  if (!/(?<![\w.])print\s*\(/.test(s) && s.trim().split('\n').length >= 2) {
    const last = s.replace(/\s+$/, '').split('\n').length
    issues.push({ rule: 'noPrint', line: last, vars: {}, key: 'noPrint' })
  }

  // 变量没定义：拼写错误最常见（totla），能猜到想写哪个就说
  const typoNames = new Set(
    issues.filter((it) => it.rule === 'typo' || it.rule === 'printf' || it.rule === 'bareMethod').map((it) => String(it.vars.name ?? 'printf')),
  )
  for (const u of undefinedNames(s)) {
    if (typoNames.has(u.name)) continue
    const line = at(u.index)
    const guess = closestName(u.name, u.defined)
    issues.push({
      rule: 'undefinedName',
      line,
      vars: guess ? { name: u.name, right: guess } : { name: u.name },
      key: `undefinedName:${u.name}`,
      fix: guess ? renameNames(u.name, guess) : undefined,
    })
    break // 一处就够了：名字写错一个，后面同名的都是它
  }
  return issues
}

/**
 * 用了却哪儿都没定义过的名字（Python）。网页里没有 Python 的语法树，只能按规则认「定义」：
 * 赋值（含 a, b = 、a = b = 、:=）、for 变量（含推导式里的）、def 和它的参数、lambda 参数、class、
 * import / from … import / as、with … as、except … as、global / nonlocal。
 * 「用」是不跟在点后面、不是关键字参数（f(end='')）、不是内置名字的标识符。认不全的宁可不报：
 * 有 from x import * 、有 exec / eval / globals 的整段不查。定义在后面、先用的不管（只看有没有定义过）
 */
function undefinedNames(s: string) {
  if (/^\s*from\s+\S+\s+import\s+\*/m.test(s) || /\b(exec|eval|globals|locals|vars)\s*\(/.test(s)) return []
  const defined = new Set<string>()
  const addNames = (text: string) => {
    // [...] 里的是下标（a[i] = 1 的 i 是用，不是定义）；跟着 . 或 [ 的是已有的东西
    const flat = text.replace(/\[[^\]]*\]/g, '')
    for (const m of flat.matchAll(/(?<![\w.])([A-Za-z_]\w*)(?!\s*[.[(])/g)) defined.add(m[1]!)
  }
  for (const line of s.split('\n')) {
    // 单行的 if x: y = 1 / for i in r: s = s + i：冒号后面那截才是赋值语句
    const body = line.replace(/^\s*(if|elif|else|for|while|with|try|except|finally)\b[^:]*:/, '')
    let depth = 0
    let last = 0
    const parts: string[] = []
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!
      if ('([{'.includes(ch)) depth++
      else if (')]}'.includes(ch)) depth--
      else if (ch === '=' && depth === 0 && !'=!<>+-*/%&|^:@'.includes(body[i - 1] ?? '') && body[i + 1] !== '=') {
        parts.push(body.slice(last, i))
        last = i + 1
      }
    }
    for (const target of parts) addNames(target)
  }
  for (const m of s.matchAll(/(\w+)\s*:=/g)) defined.add(m[1]!)
  for (const m of s.matchAll(/\bfor\s+([\w\s,()[\]]+?)\s+in\b/g)) addNames(m[1]!)
  for (const m of s.matchAll(/^\s*(?:async\s+)?(?:def|class)\s+(\w+)/gm)) defined.add(m[1]!)
  for (const m of s.matchAll(/^\s*(?:async\s+)?def\s+\w+\s*\(([^)]*)\)/gm)) {
    for (const p of m[1]!.split(','))
      defined.add(
        p
          .trim()
          .replace(/^\*+/, '')
          .split(/[=:\s]/)[0]!,
      )
  }
  for (const m of s.matchAll(/\blambda\b([^:]*):/g)) for (const p of m[1]!.split(',')) defined.add(p.trim().replace(/^\*+/, '').split(/[=\s]/)[0]!)
  for (const m of s.matchAll(/^\s*import\s+([^\n]+)/gm)) {
    for (const part of m[1]!.split(',')) {
      const words = part.trim().split(/\s+/)
      defined.add(words[2] ?? words[0]!.split('.')[0]!)
    }
  }
  for (const m of s.matchAll(/^\s*from\s+\S+\s+import\s+\(?([^\n)]+)/gm)) {
    for (const part of m[1]!.split(',')) {
      const words = part.trim().split(/\s+/)
      defined.add(words[2] ?? words[0]!)
    }
  }
  for (const m of s.matchAll(/\bas\s+(\w+)/g)) defined.add(m[1]!)
  for (const m of s.matchAll(/^\s*(?:global|nonlocal)\s+([\w\s,]+)/gm)) for (const n of m[1]!.split(',')) defined.add(n.trim())

  const found: { name: string; index: number; defined: Set<string> }[] = []
  const seen = new Set<string>()
  let depth = 0
  // import 那几行上的都是模块名、导入的名字，不是「用」
  const importLine = (index: number) => /^\s*(import|from)\s/.test(s.slice(s.lastIndexOf('\n', index - 1) + 1))
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
    // 跟在点后面的是属性、方法（点和名字中间可能隔着空格：line. remove(…)）
    if (!/[A-Za-z_]/.test(ch) || /\w/.test(s[i - 1] ?? '') || /\.\s*$/.test(s.slice(Math.max(0, i - 8), i))) continue
    const m = /^[A-Za-z_]\w*/.exec(s.slice(i))!
    const name = m[0]
    const end = i + name.length
    i = end - 1
    if (PYTHON_KEYWORDS.has(name) || PYTHON_BUILTINS.has(name) || defined.has(name) || seen.has(name) || importLine(i - name.length + 1)) continue
    // 前面紧挨着引号的是字符串前缀（f"…"、r'…'），不是名字
    if (/^["']/.test(s.slice(end))) continue
    // 括号里的 name= 是关键字参数
    if (depth > 0 && /^\s*=(?!=)/.test(s.slice(end))) continue
    seen.add(name)
    found.push({ name, index: i - name.length + 1, defined })
  }
  return found
}

/** 已定义的名字里和它最像的（拼写错误），短的差 1 处、长的差 2 处以内，不像就是 null */
function closestName(name: string, defined: Set<string>) {
  let best: string | null = null
  let bestD = Infinity
  for (const d of defined) {
    if (d.length < 2) continue
    const dist = distance(name.toLowerCase(), d.toLowerCase())
    if (dist < bestD) {
      best = d
      bestD = dist
    }
  }
  return best && bestD <= (best.length <= 4 ? 1 : 2) ? best : null
}

/** 把名字 from 都改成 to（字符串、注释里的不动；跟在点后面的不动） */
function renameNames(from: string, to: string) {
  return (code: string) => {
    const s = blankStringsAndComments(code, 'Python')
    const edits = [...s.matchAll(new RegExp(`(?<![\\w.])${from}(?!\\w)`, 'g'))].map((m) => ({ from: m.index!, to: m.index! + from.length, insert: to }))
    return replaceAt(code, edits)
  }
}

/**
 * 括号没配对：( [ { 多了说没关上的那个在哪一行，) ] } 多了说多出来的那个在哪一行。
 * 写多行的调用写到一半也是这样，所以页面那边等停手久一点才说
 */
function unclosedBracket(code: string, s: string): LintIssue | null {
  const stack: { ch: string; index: number }[] = []
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if ('([{'.includes(ch)) stack.push({ ch, index: i })
    else if (ch in pairs) {
      if (stack.at(-1)?.ch === pairs[ch]) stack.pop()
      else return { rule: 'unclosedBracket', line: lineOf(code, i), vars: { kind: 'extra' }, key: `unclosedBracket:extra:${lineOf(code, i)}` }
    }
  }
  const open = stack[0]
  return open
    ? { rule: 'unclosedBracket', line: lineOf(code, open.index), vars: { kind: 'open' }, key: `unclosedBracket:open:${lineOf(code, open.index)}` }
    : null
}

/** 引号没配对：单引号、双引号的字符串到行末都没收尾（三引号的可以跨行，不算） */
function unclosedQuote(code: string, language: string): LintIssue | null {
  const python = language === 'Python'
  let i = 0
  while (i < code.length) {
    const ch = code[i]!
    if (python ? ch === '#' : code.startsWith('//', i)) {
      const end = code.indexOf('\n', i)
      i = end < 0 ? code.length : end
      continue
    }
    if (!python && code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2)
      i = end < 0 ? code.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      const triple = python && code.startsWith(ch.repeat(3), i)
      const quote = triple ? ch.repeat(3) : ch
      let j = i + quote.length
      while (j < code.length && !code.startsWith(quote, j)) {
        if (code[j] === '\\') j++
        else if (!triple && code[j] === '\n') {
          const line = lineOf(code, i)
          return { rule: 'unclosedQuote', line, vars: {}, key: `unclosedQuote:${line}` }
        }
        j++
      }
      if (j >= code.length && !triple) {
        const line = lineOf(code, i)
        return { rule: 'unclosedQuote', line, vars: {}, key: `unclosedQuote:${line}` }
      }
      i = j + quote.length
      continue
    }
    i++
  }
  return null
}

function replaceLine(code: string, index: number, change: (text: string) => string) {
  const all = code.split('\n')
  const text = all[index]
  if (text === undefined) return code
  all[index] = change(text)
  return all.join('\n')
}

/** 把调用 from(…) 的地方都改成 to(…)（字符串、注释里的不动） */
function renameCalls(from: string, to: string) {
  return (code: string) => {
    const s = blankStringsAndComments(code, 'Python')
    const edits = [...s.matchAll(new RegExp(`(?<![\\w.])${from}(?=\\s*\\()`, 'g'))].map((m) => ({ from: m.index!, to: m.index! + from.length, insert: to }))
    return replaceAt(code, edits)
  }
}

function lintC(code: string, s: string): LintIssue[] {
  const issues: LintIssue[] = []
  // 语言选错：Python 的代码选了 C / C++
  if (!/#\s*include/.test(code)) {
    const py = /^\s*print\s*\(|\binput\s*\(\s*\)|^\s*def\s+\w+\s*\(.*\)\s*:|^\s*(if|for|while)\b[^(\n]*:\s*$/m.exec(code)
    if (py) return [{ rule: 'wrongLangPython', line: lineOf(code, py.index), vars: {}, key: 'wrongLangPython' }]
    // 用了 printf / scanf 却没写 #include
    if (/\b(printf|scanf|puts|getchar)\s*\(/.test(s)) {
      issues.push({ rule: 'noInclude', line: 1, vars: {}, key: 'noInclude', fix: (src) => `#include <stdio.h>\n${src}` })
    }
  }
  return issues
}

/**
 * 句号「。」、顿号「、」：现成的中文标点表（PUNCTUATION_MAP）里没有它们（没有一一对应的英文字符），
 * 这里另找。先按那张表换一遍（中文引号变成英文的，引号里的就成了字符串），再在字符串、注释之外找，
 * 免得把 “你好。” 里的句号也删了。表里的替换都是一个字换一个字，下标不变
 */
function findStopsAndCommas(code: string, language: string) {
  const swapped = replaceAt(code, findChinesePunctuation(code, language))
  const s = blankStringsAndComments(swapped, language)
  const edits: { from: number; to: number; insert: string; name: string }[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '。') edits.push({ from: i, to: i + 1, insert: '', name: '句号' })
    else if (s[i] === '、') edits.push({ from: i, to: i + 1, insert: ',', name: '顿号' })
  }
  return edits
}

/** 这段代码里能指出来的错，按行排。有中文标点就只说中文标点（中文引号会让别的规则看走眼） */
export function lintCode(code: string, language: string): LintIssue[] {
  if (language !== 'Python' && language !== 'C' && language !== 'C++') return []
  const punct = [
    ...findChinesePunctuation(code, language).map((it) => ({ ...it, name: PUNCTUATION_NAMES[code[it.from]!] ?? '标点' })),
    ...findStopsAndCommas(code, language),
  ].sort((a, b) => a.from - b.from)
  if (punct.length) {
    const first = punct[0]!
    const line = lineOf(code, first.from)
    // 句号要删、顿号换逗号，别的照表换；换完再找一遍句号顿号（下标是按换过的算的，一个字换一个字所以对得上）
    const fixAll = (src: string) => {
      const table = findChinesePunctuation(src, language)
      return replaceAt(src, [...table, ...findStopsAndCommas(src, language)])
    }
    return [{ rule: 'punct', line, vars: { name: first.name, n: punct.length }, key: `punct:${line}:${first.name}`, fix: fixAll }]
  }
  // 引号、括号没配对时代码是断的，别的规则看不准，只说这个
  const quote = unclosedQuote(code, language)
  if (quote) return [quote]
  const s = blankStringsAndComments(code, language)
  const bracket = unclosedBracket(code, s)
  if (bracket) return [bracket]
  const issues = language === 'Python' ? lintPython(code, s) : lintC(code, s)
  return issues.sort((a, b) => a.line - b.line)
}

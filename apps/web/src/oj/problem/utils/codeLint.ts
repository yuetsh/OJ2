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
const PYTHON_BUILTINS = new Set([
  ...PYTHON_COMMON,
  'bool', 'dict', 'set', 'tuple', 'enumerate', 'zip', 'reversed', 'any', 'all', 'pow', 'divmod', 'chr', 'ord', 'bin', 'hex', 'oct',
  'isinstance', 'type', 'eval', 'exec', 'open', 'filter', 'iter', 'next', 'hash', 'id', 'format', 'repr', 'vars', 'super', 'object',
  'print', 'exit', 'quit', 'help', 'dir', 'callable', 'getattr', 'setattr', 'hasattr', 'complex', 'bytes', 'frozenset', 'slice',
  'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError', 'ZeroDivisionError', 'NameError', 'StopIteration',
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
    if (use) issues.push({ rule: 'noInt', line: at(use.index), vars: { name: v }, key: `noInt:${v}` })
  }
  return issues
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

/** 这段代码里能指出来的错，按行排。有中文标点就只说中文标点（中文引号会让别的规则看走眼） */
export function lintCode(code: string, language: string): LintIssue[] {
  if (language !== 'Python' && language !== 'C' && language !== 'C++') return []
  const punct = findChinesePunctuation(code, language)
  if (punct.length) {
    const first = punct[0]!
    const line = lineOf(code, first.from)
    const name = PUNCTUATION_NAMES[code[first.from]!] ?? '标点'
    const fixAll = (src: string) => replaceAt(src, findChinesePunctuation(src, language))
    return [{ rule: 'punct', line, vars: { name, n: punct.length }, key: `punct:${line}:${name}`, fix: fixAll }]
  }
  const s = blankStringsAndComments(code, language)
  const issues = language === 'Python' ? lintPython(code, s) : lintC(code, s)
  return issues.sort((a, b) => a.line - b.line)
}

/**
 * 在 lezer 分好的词上再补的几种标记。lezer 给不了、但学生的代码里很常见，所以另外扫一遍。
 * 静态代码在 shared/highlight.ts 里拆 span，编辑器在 shared/extensions/codeMarks.ts 里挂装饰，
 * 两边都只调 extraMarks()，颜色才一样。
 *
 * - 字符串里的格式占位符：printf 的 %d、%.2f、%%，Python 的 "%d 个" % n。
 *   正则和颜色照 VS Code 的语法文件：C 是 constant.other.placeholder（变量色），
 *   Python 是 constant.character.format.placeholder（关键字色），所以两种语言类名不同。
 *   写错的（%,2f、%。1f、%S）故意不认，不变色正好提醒学生。
 * - 字符串和注释之外的全角标点（`print（“你好”）`、`！=`、全角空格）：标红加波浪线。
 *   12 万条 Python 提交里有 1947 条是这样，全部编译出错，占 Python 编译错误的五分之一，
 *   不标的话 `“你好”` 会被认成变量名，看着和正常代码一样。
 * - Python 的内置类型（int、str、list…）：照 VS Code 一律是类型色。lezer 只按位置分，
 *   `int(input())` 里是函数、`map(int, …)` 里是变量，同一行两个颜色。
 * - SQL 的函数（COUNT、AVG、ROUND…，后面跟着括号的）：照 VS Code 是函数色。lezer 的 SQL 解析器
 *   把 COUNT 当关键字、把 avg 当普通名字，同是聚合函数一个蓝一个没颜色。
 */
import type { syntaxTree } from '@codemirror/language'

type Tree = ReturnType<typeof syntaxTree>

export type CodeFamily = 'c' | 'python' | 'sql'

export interface Mark {
  from: number
  to: number
  cls: string
}

const FORMAT: Partial<Record<CodeFamily, RegExp>> = {
  c: /%(\d+\$)?[#0\- +']*(-?\d+|\*)?(\.(-?\d+|\*)?)?(hh|h|ll|l|j|t|z|L)?[diouxXeEfFgGaAcspn%]/g,
  python: /%(\([\w\s]*\))?[-+#0 ]*(\d+|\*)?(\.(\d+|\*)?)?[hlL]?[diouxXeEfFgGcrsa%]/g,
}

const FORMAT_CLASS: Record<CodeFamily, string> = {
  c: 'tok-format',
  python: 'tok-format-py',
  sql: '',
}

// 全角的 ASCII（！（），：；？ａ１…）、全角空格、、。〈〉《》「」【】、中文引号
const FULL_WIDTH = /[！-～　-。〈-】‘’“”]/g

// VS Code（MagicPython）的 builtin-types
const PY_BUILTIN_TYPES = new Set([
  'bool',
  'bytearray',
  'bytes',
  'classmethod',
  'complex',
  'dict',
  'float',
  'frozenset',
  'int',
  'list',
  'object',
  'property',
  'set',
  'slice',
  'staticmethod',
  'str',
  'super',
  'tuple',
  'type',
])

// VS Code 的 SQL 语法里 support.function 的那批（SQLite 认的）
const SQL_FUNCTIONS = new Set([
  'abs',
  'avg',
  'coalesce',
  'count',
  'date',
  'datetime',
  'group_concat',
  'ifnull',
  'instr',
  'length',
  'lower',
  'ltrim',
  'max',
  'min',
  'nullif',
  'random',
  'replace',
  'round',
  'rtrim',
  'strftime',
  'substr',
  'sum',
  'time',
  'total',
  'trim',
  'upper',
])

function matches(text: string, re: RegExp, cls: string): Mark[] {
  return [...text.matchAll(re)].map((m) => ({ from: m.index, to: m.index + m[0].length, cls }))
}

/**
 * 一个词（lezer 吐出的一段文字和它的类名）上要补的标记，位置相对 text 开头。
 * prev 是这段文字前面那个字符（排除 `obj.int` 这种属性），after 是后面紧跟的一小截（看是不是 `(`）
 */
export function extraMarks(text: string, classes: string, family: CodeFamily, prev: string, after: string): Mark[] {
  if (classes.includes('tok-string')) {
    const re = FORMAT[family]
    return re ? matches(text, re, FORMAT_CLASS[family]) : []
  }
  if (classes.includes('tok-comment')) return []
  if (family === 'python' && prev !== '.' && (classes === 'tok-function' || classes === 'tok-variable') && PY_BUILTIN_TYPES.has(text)) {
    return [{ from: 0, to: text.length, cls: 'tok-builtin-type' }]
  }
  const marks = matches(text, FULL_WIDTH, 'tok-fullwidth')
  // 没类名的部分是一长截（`), round(avg(score), `），所以在里面逐个找词
  if (family === 'sql' && (classes === '' || classes === 'tok-keyword')) {
    for (const m of text.matchAll(/(?<!\w)[A-Za-z_]\w*/g)) {
      const end = m.index + m[0].length
      if (SQL_FUNCTIONS.has(m[0].toLowerCase()) && /^\s*\(/.test(text.slice(end) + after)) {
        marks.push({ from: m.index, to: end, cls: 'tok-sql-function' })
      }
    }
    marks.sort((a, b) => a.from - b.from)
  }
  return marks
}

/**
 * 不是字符串的「字符串」：lezer 的 C 解析器碰到全角标点会把后面一截当成没有引号的 String 节点
 * （`printf("%d\\n"， a)；` 里的 `， a)；`），整截染成字符串色、全角标点也就不标了。
 * 开头不是引号（前面可以有 u8 / L / R / f / b 这类前缀）的 String 一律不算字符串
 */
export function fakeStrings(tree: Tree, read: (from: number, to: number) => string, from = 0, to?: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (n.name === 'String' && !/^[uUlLrRbBfF8]*["']/.test(read(n.from, n.from + 4))) {
        out.push({ from: n.from, to: n.to })
      }
    },
  })
  return out
}

/** 按 extraMarks 把一段文字拆开，每段带上补的类名 */
export function splitMarks(
  text: string,
  classes: string,
  /** 判断补什么标记用的类名，平时就是 classes；假字符串（见 fakeStrings）传空 */
  marksFor: string,
  family: CodeFamily,
  prev: string,
  after: string,
  put: (text: string, classes: string) => void,
) {
  let at = 0
  for (const m of extraMarks(text, marksFor, family, prev, after)) {
    if (m.from > at) put(text.slice(at, m.from), classes)
    put(text.slice(m.from, m.to), classes ? `${classes} ${m.cls}` : m.cls)
    at = m.to
  }
  if (at < text.length) put(text.slice(at), classes)
}

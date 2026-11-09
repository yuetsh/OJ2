/**
 * 找代码里混进来的中文标点（和全角字符）：中文输入法没切回来，敲出「，」「（」「“」，编译直接报错，
 * 学生还看不出来——字形太像了。看板娘在题目页上提醒，并能一键换成英文的。
 *
 * **字符串和注释里的不算**：`printf("你好，世界")`、`# 计算总和。` 都是对的。所以先粗略地切出
 * 字符串和注释（C/C++ 的 // 和 块注释、Python 的 # 和三引号），只看代码部分。切得不严（比如 C 的
 * 原始字符串、Python 的 f-string 里嵌套引号）也没关系：最多漏报，不会把字符串里的标点报出来。
 *
 * 中文引号 “” 不是字符串的定界符，所以 `print(“你好”)` 里的两个都会报出来——这正是要抓的。
 */

export interface PunctIssue {
  /** 第几行、第几列，从 1 数 */
  line: number
  col: number
  ch: string
  /** 给学生看的名字：「中文逗号」「全角字母」 */
  name: string
  /** 换成哪个英文字符 */
  ascii: string
  /** 在整段代码里的下标（换的时候用） */
  index: number
}

/** 不在全角区（FF01～FF5E）里的中文标点 */
const CJK: Record<string, string> = {
  '。': '.',
  '、': ',',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '【': '[',
  '】': ']',
  '《': '<',
  '》': '>',
  '　': ' ',
  '…': '...',
  '—': '-',
}

const NAMES: Record<string, string> = {
  ',': '逗号',
  ';': '分号',
  ':': '冒号',
  '(': '括号',
  ')': '括号',
  '!': '感叹号',
  '?': '问号',
  '"': '引号',
  "'": '引号',
  '.': '句号',
  '=': '等号',
  '+': '加号',
  '-': '减号',
  '*': '乘号',
  '/': '斜杠',
  '<': '尖括号',
  '>': '尖括号',
  '[': '方括号',
  ']': '方括号',
  '{': '大括号',
  '}': '大括号',
  '%': '百分号',
  '#': '井号',
  '&': '与号',
  '|': '竖线',
  _: '下划线',
  ' ': '空格',
  '...': '省略号',
}

function classify(ch: string): { name: string; ascii: string } | null {
  const cjk = CJK[ch]
  if (cjk !== undefined) return { name: ch === '、' ? '中文顿号' : `中文${NAMES[cjk] ?? '符号'}`, ascii: cjk }
  const code = ch.charCodeAt(0)
  if (code < 0xff01 || code > 0xff5e) return null
  const ascii = String.fromCharCode(code - 0xfee0)
  if (/[0-9]/.test(ascii)) return { name: '全角数字', ascii }
  if (/[a-zA-Z]/.test(ascii)) return { name: '全角字母', ascii }
  return { name: `中文${NAMES[ascii] ?? '符号'}`, ascii }
}

/** 只看这几种语言：SQL、流程图不管 */
export function punctLanguage(language: string) {
  return language === 'C' || language === 'C++' || language === 'Python'
}

export function findChinesePunct(code: string, language: string): PunctIssue[] {
  if (!punctLanguage(language)) return []
  const python = language === 'Python'
  const issues: PunctIssue[] = []
  type State = 'code' | 'line' | 'block' | 'string'
  let state: State = 'code'
  let quote = ''
  let line = 1
  let col = 0
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!
    if (ch === '\n') {
      line++
      col = 0
      // 单行字符串没收尾就算到行末，别把后面整段都当成字符串
      if (state === 'line' || (state === 'string' && quote.length === 1)) state = 'code'
      continue
    }
    col++
    switch (state) {
      case 'line':
        break
      case 'block':
        if (ch === '*' && code[i + 1] === '/') {
          state = 'code'
          i++
          col++
        }
        break
      case 'string':
        if (ch === '\\') {
          i++
          col++
        } else if (code.startsWith(quote, i)) {
          state = 'code'
          i += quote.length - 1
          col += quote.length - 1
        }
        break
      case 'code': {
        if (python ? ch === '#' : ch === '/' && code[i + 1] === '/') {
          state = 'line'
          break
        }
        if (!python && ch === '/' && code[i + 1] === '*') {
          state = 'block'
          i++
          col++
          break
        }
        if (ch === '"' || ch === "'") {
          const triple = python && code.startsWith(ch.repeat(3), i)
          quote = triple ? ch.repeat(3) : ch
          state = 'string'
          if (triple) {
            i += 2
            col += 2
          }
          break
        }
        const hit = classify(ch)
        if (hit) issues.push({ line, col, ch, index: i, ...hit })
      }
    }
  }
  return issues
}

/** 把找到的都换成英文的（从后往前换，下标不乱） */
export function fixChinesePunct(code: string, issues: readonly PunctIssue[]) {
  let fixed = code
  for (const issue of [...issues].sort((a, b) => b.index - a.index)) {
    fixed = fixed.slice(0, issue.index) + issue.ascii + fixed.slice(issue.index + 1)
  }
  return fixed
}

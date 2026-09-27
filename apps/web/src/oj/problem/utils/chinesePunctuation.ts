import { PUNCTUATION_MAP } from "./pythonError"

export interface PunctuationFix {
  from: number
  to: number
  insert: string
}

/**
 * 找出 Python 代码里**字符串和注释之外**的中文标点，给出换成英文的改动。
 *
 * 字符串里的中文标点是合法的，`print("你好，世界")` 里那个逗号动了就改了输出，
 * 所以不能整篇替换。中文引号「“ ”」另算：它们出现在代码里，本身就是没切输入法
 * 打出来的字符串引号，要换成英文引号，而**它们中间的内容原样保留** —— 否则
 * `print(“你好，世界”)` 会被改成 `print("你好,世界")`，输出跟着变了。
 *
 * f 字符串花括号里的是代码不是文字（`f"{s：.2f}"`、`f"{len（a）}"`），照样要换；
 * `{{` 是转义出来的字面花括号，不算。拿生产库 591 条中文标点的编译错误核过：
 * 修完之后报错点名的那个字符还在的只剩 1 条，是学生自己的引号就是乱的。
 *
 * 不是完整的词法分析：只认引号、三引号、字符串前缀、反斜杠转义和 `#` 注释，
 * 这对学生代码够用。单引号字符串遇到换行就当它结束，免得一个没配对的引号把
 * 后面整篇都当成字符串。
 */
export function findChinesePunctuation(code: string): PunctuationFix[] {
  const fixes: PunctuationFix[] = []

  function fix(at: number) {
    const english = PUNCTUATION_MAP[code[at]!]
    if (english) fixes.push({ from: at, to: at + 1, insert: english })
  }

  /** 从 start 往后扫一个字符串的内容，返回结束位置（收尾引号之后） */
  function skipString(start: number, triple: boolean, fstring: boolean, closers: string[]) {
    let depth = 0
    let j = start
    while (j < code.length) {
      const ch = code[j]!
      if (ch === "\\") {
        j += 2
        continue
      }
      if (!triple && ch === "\n") return j
      if (fstring) {
        if (ch === "{" && depth === 0 && code[j + 1] === "{") {
          j += 2
          continue
        }
        if (ch === "{") depth++
        else if (ch === "}" && depth > 0) depth--
        else if (depth > 0) fix(j)
        if (depth > 0 || ch === "{" || ch === "}") {
          j++
          continue
        }
      }
      const closer = closers.find((c) => code.startsWith(c, j))
      if (closer) {
        // 中文收尾引号也要换成英文
        if (closer.length === 1) fix(j)
        return j + closer.length
      }
      j++
    }
    return j
  }

  let i = 0
  while (i < code.length) {
    const ch = code[i]!
    if (ch === "#") {
      const end = code.indexOf("\n", i)
      i = end === -1 ? code.length : end
      continue
    }
    if (ch === '"' || ch === "'") {
      // 前缀是紧挨着引号的 f / r / b / u 组合，前面不能再连着别的标识符字符
      const prefix = code.slice(0, i).match(/(?<![\w])[rRbBfFuU]{1,2}$/)?.[0] ?? ""
      const quote = code.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch
      i = skipString(i + quote.length, quote.length === 3, /f/i.test(prefix), [quote])
      continue
    }
    if (ch === "“" || ch === "”" || ch === "‘" || ch === "’") {
      const double = ch === "“" || ch === "”"
      fix(i)
      // 收尾可能打成中文也可能打成英文，两种都认
      i = skipString(i + 1, false, false, double ? ["”", "“", '"'] : ["’", "‘", "'"])
      continue
    }
    fix(i)
    i++
  }
  return fixes
}

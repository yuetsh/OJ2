import type { StatisticInfo } from "@oj2/contract"
import { PUNCTUATION_MAP, PUNCTUATION_NAMES } from "./pythonError"

/**
 * 答案错误时，比较学生在**公开样例**上的输出和正确输出，归一类、给一句中文提示。
 * 数据来自后端 judge/run.ts 的 checkSamples（`statistic_info.sample_check`）。
 *
 * 分类是拿 2025 秋以来 5055 条「样例上就错了」的答案错误定的：
 * 格式和内容都不同 44%、数值不对 15%、没有输出 10%、多了文字 9%、只差空格换行 9%、
 * 少了内容 5%、中英文标点 4%、数字写法（小数位数）2.5%、大小写 1%。
 * 前几类之外的「几乎对了」合起来约三分之一，一句话就能改对。
 *
 * 样例是公开的，这里可以放心地把具体的值说出来（「正确输出是 84.10，你输出的是 84.1」）。
 */
export type SampleCheck = NonNullable<StatisticInfo["sample_check"]>

export type DiffKind =
  | "no-output"
  | "whitespace"
  | "punctuation"
  | "case"
  | "extra"
  | "missing"
  | "number-format"
  | "values"
  | "other"

const NUMBER = /-?\d+(?:\.\d+)?/g

function squash(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function toEnglishPunctuation(text: string) {
  return [...text].map((ch) => PUNCTUATION_MAP[ch] ?? ch).join("")
}

export function classifyDiff(expected: string, output: string): DiffKind {
  const e = squash(expected)
  const o = squash(output)
  if (!o) return "no-output"
  if (e === o) return "whitespace"
  if (squash(toEnglishPunctuation(expected)) === squash(toEnglishPunctuation(output))) {
    return "punctuation"
  }
  if (e.toLowerCase() === o.toLowerCase()) return "case"
  // 数字先于「多了内容」判：007 里包含 7、3.0 里包含 3，先判包含就会把它们当成
  // 「多打了说明文字」，给出完全不相干的建议
  const en = e.match(NUMBER) ?? []
  const on = o.match(NUMBER) ?? []
  const sameShape = e.replace(NUMBER, "N") === o.replace(NUMBER, "N") && en.length === on.length
  if (sameShape && en.length) {
    const sameValues = en.every((value, i) => Math.abs(Number(value) - Number(on[i])) < 1e-9)
    return sameValues ? "number-format" : "values"
  }
  if (e && o.includes(e)) return "extra"
  if (o && e.includes(o)) return "missing"
  return "other"
}

/** 第一处不一样的标点：[正确输出里的, 你输出的] */
function firstPunctuationPair(expected: string, output: string) {
  const e = [...squash(expected)]
  const o = [...squash(output)]
  for (let i = 0; i < Math.min(e.length, o.length); i++) {
    if (e[i] !== o[i]) return [e[i]!, o[i]!] as const
  }
  return null
}

function punctuationHint(expected: string, output: string) {
  const pair = firstPunctuationPair(expected, output)
  if (pair) {
    const [want, got] = pair
    // 中文的那个才在名字表里
    const name = PUNCTUATION_NAMES[got] ?? PUNCTUATION_NAMES[want]
    if (name && PUNCTUATION_MAP[got] === want) {
      return `内容对了，但标点不一样：正确输出用的是英文的${name}，你输出的是中文的${name}。输出里的标点要和题目完全一样。`
    }
    if (name && PUNCTUATION_MAP[want] === got) {
      return `内容对了，但标点不一样：正确输出用的是中文的${name}，你输出的是英文的${name}。输出里的标点要和题目完全一样。`
    }
  }
  return "内容对了，但标点不一样：输出里的标点要和题目完全一样，注意分清中文标点和英文标点。"
}

function numberFormatHint(expected: string, output: string, language: string) {
  const en = squash(expected).match(NUMBER) ?? []
  const on = squash(output).match(NUMBER) ?? []
  const i = en.findIndex((value, k) => value !== on[k])
  if (i < 0) return "数字的写法和正确输出不一样。"
  const want = en[i]!
  const got = on[i]!
  const decimals = want.split(".")[1]?.length ?? 0
  const head = `正确输出是 ${want}，你输出的是 ${got}。`
  // 007 和 7：逆序数、取位数一类题的老毛病，跟小数没关系
  if (/^-?0\d/.test(got)) {
    const how = language === "Python" ? "用 int() 转成整数再输出" : "按整数（%d）输出"
    return `${head}数字前面多了 0。要输出的是一个数，不是一串数字字符：${how}，前面的 0 就没了。`
  }
  if (decimals > 0) {
    const how =
      language === "Python"
        ? `Python 可以写 f"{x:.${decimals}f}"`
        : `C 语言可以写 printf("%.${decimals}f", x)`
    return `${head}题目要求保留 ${decimals} 位小数，${how}。`
  }
  if (!got.includes(".")) return `${head}数字的写法和正确输出不一样。`
  if (language === "Python") {
    return `${head}这里要输出整数：Python 里 / 算出来的总是小数，整除要用 //，或者用 int() 转换。`
  }
  return `${head}这里要输出整数，不要带小数点：printf 用 %d 输出整数。`
}

/** Python 的 input("请输入……")：提示文字会被打印进输出，判题时必然对不上 */
export function hasInputPrompt(code: string) {
  return /\binput\(\s*[fr]?["'][^"'\n]*\S[^"'\n]*["']\s*\)/.test(code)
}

export function explainDiff(
  kind: DiffKind,
  check: SampleCheck,
  code: string,
  language: string,
): string {
  const expected = check.expected ?? ""
  const output = check.output ?? ""
  const printName = language === "Python" ? "print" : "printf"
  switch (kind) {
    case "no-output":
      return `你的程序什么都没有输出。检查一下是不是忘了写 ${printName}，或者 ${printName} 写在了执行不到的地方（比如某个 if 的里面）。`
    case "whitespace":
      return "内容对了，只是空格或换行不一样。下面把空格画成了「·」、换行画成了「↵」，对照着看看哪一行多了或少了。"
    case "punctuation":
      return punctuationHint(expected, output)
    case "case":
      return "内容对了，只是字母的大小写不一样。输出要和题目的大小写完全一样。"
    case "extra":
      if (language === "Python" && hasInputPrompt(code)) {
        return 'input() 括号里的提示文字也会被输出，判题时就对不上了。把 input("……") 里的文字删掉，只写 input()。'
      }
      return "你的输出比正确输出多了一些内容。题目要输出什么就只输出什么，不要加「请输入」「结果是」这类提示或说明文字。"
    case "missing":
      return "你的输出比正确输出少了一部分，对照看看漏了什么。"
    case "number-format":
      return numberFormatHint(expected, output, language)
    case "values":
      return "输出的格式对了，但算出来的数不对。拿这个例子的输入，自己一步一步算一遍，看看程序在哪一步和你想的不一样。"
    case "other":
      return otherHint(check)
  }
}

/** 放进一句话里的值：太长的截断，免得一句提示撑满一屏 */
function quote(text: string, max = 24) {
  const flat = text.trim()
  return `「${flat.length > max ? `${flat.slice(0, max)}…` : flat}」`
}

/**
 * 「其他」：格式和内容都不一样（占样例错误的 44%）。原来只说「对照一下，找找从哪里开始
 * 不一样」，对 D / E 这种整个值不同的情况没用 —— 学生看得出不一样，看不出为什么。
 * 改成把具体的值说出来，再告诉他拿这个例子的输入去走一遍程序（设计文档第 6 节）。
 */
function otherHint(check: SampleCheck) {
  const expected = (check.expected ?? "").replace(/\s+$/, "")
  const output = (check.output ?? "").replace(/\s+$/, "")
  const no = (check.index ?? 0) + 1
  const input = (check.input ?? "").trim()
  const walk =
    input && !input.includes("\n") && input.length <= 24
      ? `拿例子 ${no} 的输入${quote(input)}，一行一行走一遍你的程序，看它走进了哪个分支、算出了什么。`
      : `拿例子 ${no} 的输入，一行一行走一遍你的程序，看它走进了哪个分支、算出了什么。`
  if (!expected.includes("\n") && !output.includes("\n")) {
    return `你的程序输出了${quote(output)}，正确的是${quote(expected)}。${walk}`
  }
  const line = firstDifferentLine(expected, output)
  const want = expected.split("\n")[line] ?? ""
  const got = output.split("\n")[line]
  const gotText = got === undefined ? "什么都没有" : quote(got)
  return `从第 ${line + 1} 行开始不一样：正确的是${quote(want)}，你输出的是${gotText}。${walk}`
}

/** 第一处不一样的行号，0 起；完全一样（只差结尾空白）时为 -1 */
export function firstDifferentLine(expected: string, output: string) {
  const e = expected.replace(/\s+$/, "").split("\n")
  const o = output.replace(/\s+$/, "").split("\n")
  for (let i = 0; i < Math.max(e.length, o.length); i++) {
    if (e[i] !== o[i]) return i
  }
  return -1
}

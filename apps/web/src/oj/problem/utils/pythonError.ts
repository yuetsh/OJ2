/**
 * 把 Python 的编译错误（`statistic_info.err_info`）翻成中文。
 *
 * 学生是中职生，英文报错等于没有报错。好在句式非常集中：2025 秋以来 2700 条
 * Python 编译错误里，前 12 种句子占 91%、前 16 种占 97%，所以这里是一张规则表，
 * 不是通用翻译。第二名「invalid character」（22%）几乎全是中文标点，另有一键修复，
 * 见 chinesePunctuation.ts。
 *
 * 判题机给的原文有两种形状：
 *
 *     File "/judger/run/<随机目录>/solution.py", line 7
 *         print("{:.0f}"."{:.2f}".format(x))
 *                        ^^^^^^^^
 *     SyntaxError: invalid syntax
 *
 *     Sorry: IndentationError: unexpected indent (solution.py, line 3)
 *
 * 第一种的代码行是 Python 去掉**行首空格**之后再垫 4 个空格打出来的，`^` 的列号
 * 按去掉之后的算（traceback 的 `_format_syntax_error`，3.10 起如此）。
 */

export interface PythonErrorExplanation {
  /** 出错的行，1 起 */
  line: number | null
  /** 判题机打出来的那一行代码（去掉了行首空格），用来和编辑器里的对位 */
  sourceLine: string | null
  /** `^` 在 sourceLine 里标的范围，[from, to) */
  caret: { from: number; to: number } | null
  /** 给学生看的中文说明，不含行号 */
  message: string
  /** 报错点名的那个中文标点；有它才出「一键换成英文」 */
  punctuation: string | null
}

// 行首可能有空格：报错前面先打了一条 SyntaxWarning（比如 `3and`）时，File 那行是缩进的
const WHERE_RE = /^\s*File "[^"]*", line (\d+)/m
const SHORT_RE = /^Sorry: (\w+Error): (.*) \([^,()]*, line (\d+)\)\s*$/m

/**
 * 中文空格（U+3000）。写成常量而不是字面量：Oxfmt 会把字符串里的 `\u3000` 转义
 * 还原成原字符，那样源码里就是一个看不见的空白。
 */
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000)

/** 中文标点 → 英文。「。」不在表里：它多半是句末多打的，换成「.」照样错，只能删 */
export const PUNCTUATION_MAP: Record<string, string> = {
  "（": "(",
  "）": ")",
  "，": ",",
  "：": ":",
  "；": ";",
  "【": "[",
  "】": "]",
  "｛": "{",
  "｝": "}",
  "！": "!",
  "？": "?",
  "＝": "=",
  "＋": "+",
  "－": "-",
  "＊": "*",
  "／": "/",
  "＜": "<",
  "＞": ">",
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "＂": '"',
  "＃": "#",
  "×": "*",
  "÷": "/",
  [IDEOGRAPHIC_SPACE]: " ",
}

/**
 * 标点的名字。说明里**只说名字、不拿字形对比**：「：」和「:」、「，」和「,」在正文字体里
 * 几乎一样，「把「：」换成「:」」这句话学生看不出区别。「冒号是中文的，要换成英文的」
 * 看得懂，要换哪一个由卡片里那行代码的标红来指。
 */
export const PUNCTUATION_NAMES: Record<string, string> = {
  "（": "左括号",
  "）": "右括号",
  "，": "逗号",
  "：": "冒号",
  "；": "分号",
  "【": "左方括号",
  "】": "右方括号",
  "｛": "左花括号",
  "｝": "右花括号",
  "！": "感叹号",
  "？": "问号",
  "＝": "等号",
  "＋": "加号",
  "－": "减号",
  "＊": "星号",
  "／": "斜杠",
  "＜": "小于号",
  "＞": "大于号",
  "“": "引号",
  "”": "引号",
  "‘": "单引号",
  "’": "单引号",
  "＂": "引号",
  "＃": "井号",
  [IDEOGRAPHIC_SPACE]: "空格",
}

/**
 * 规则除了报错原文，还能看出错的那一行（判题机打出来的，去掉了行首空格）。同一句报错
 * 学生错法不同，要看那一行才分得开：`expected ':'` 九成是 `else a < 60:`，行尾明明有冒号；
 * 「Maybe you meant '=='」只有 if / while 那行才是真想判断相等。返回 null 就接着往下找。
 */
type Rule = [RegExp, (match: RegExpMatchArray, source: string) => string | null]

/** 去掉引号里的内容，只看代码本身的符号 */
function stripStrings(source: string) {
  return source.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""')
}

/** 括号外面的逗号：`if a > 9, a < 100:` 里有，`if x in (1, 2):` 里没有 */
function hasTopLevelComma(source: string) {
  let depth = 0
  for (const ch of stripStrings(source)) {
    if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch)) depth--
    else if (ch === "," && depth === 0) return true
  }
  return false
}

const CONDITION_LINE = /^(if|elif|while)\b/

const RULES: Rule[] = [
  [
    // u：emoji 是两个 UTF-16 单元，不带 u 的 (.) 对不上
    /^invalid character '(.)'/u,
    ([, char]) => {
      // 数学符号不是「中文的」，是写法不对：代码里乘除用 * 和 /
      if (char === "×") return "这里用了乘号「×」，代码里的乘法要写成星号「*」。"
      if (char === "÷") return "这里用了除号「÷」，代码里的除法要写成斜杠「/」。"
      if (char === "√")
        return "代码里没有根号「√」：开平方写成 x ** 0.5，或者 import math 之后用 math.sqrt(x)。"
      if (char === "²" || char === "³")
        return `代码里没有上标的「${char}」：平方写成 x ** 2，立方写成 x ** 3。`
      if (char === "≤") return "代码里没有「≤」：小于等于要写成小于号加等号 <=。"
      if (char === "≥") return "代码里没有「≥」：大于等于要写成大于号加等号 >=。"
      if (char === "≠") return "代码里没有「≠」：不等于要写成感叹号加等号 !=。"
      if (char === "、")
        return "代码里不用顿号「、」：几样东西之间要用英文逗号隔开。写代码的时候先切换到英文输入法。"
      const name = PUNCTUATION_NAMES[char!]
      if (name) {
        return `这里的${name}是中文输入法打出来的，要换成英文的${name}。写代码的时候先切换到英文输入法。`
      }
      if (char === "。") return "这里多了一个中文句号「。」，代码里不用句号，删掉它。"
      return `这里有一个不能出现在代码里的字符「${char}」，多半是中文输入法打出来的，删掉后用英文输入法重新打。`
    },
  ],
  [
    /^invalid non-printable character/,
    () => "这里有一个看不见的特殊字符，多半是从别处复制过来的。把这一行删掉，自己重新打一遍。",
  ],
  [
    /^expected ':'/,
    (_, source) =>
      /^else\b\s*[^\s:]/.test(source)
        ? "else 后面不能写条件，它的意思是「上面的条件都不满足」。还要再判断一个条件，就用 elif 条件:。"
        : "这一行末尾少了英文冒号「:」。if、elif、else、for、while、def 这些行的最后都要有冒号。",
  ],
  [
    /^expected an indented block after '(\w+)' statement on line (\d+)/,
    ([, keyword, owner]) =>
      `这一行要往里缩进（按一下 Tab 键）：它是第 ${owner} 行那个 ${keyword} 要管的代码。`,
  ],
  [
    /^expected an indented block/,
    () => "这一行要往里缩进（按一下 Tab 键）：上一行以冒号结尾，它下面的代码都要缩进。",
  ],
  [
    /^unexpected indent/,
    () => "这一行前面多了空格。只有 if、for 这类以冒号结尾的行，它下面的代码才要往里缩进。",
  ],
  [
    /^unindent does not match any outer indentation level/,
    () =>
      "这一行前面的空格数和上面对不齐。同一层的代码，前面的空格要一样多，建议统一用 Tab 键缩进。",
  ],
  [
    /^inconsistent use of tabs and spaces/,
    () => "这一行的缩进混用了 Tab 键和空格键，统一只用 Tab 键缩进。",
  ],
  [
    /^invalid syntax\. Perhaps you forgot a comma\?/,
    // 抽样一半以上是拼文字漏了 +：print(a+"是"a+"岁")
    () =>
      "这里的几样东西之间少了连接的符号：要分开输出，用英文逗号「,」隔开；要把文字拼在一起，用加号「+」。",
  ],
  [
    /Maybe you meant '==' instead of '='|Maybe you meant '==' or ':=' instead of '='|perhaps you meant "=="/,
    (_, source) => {
      // 只有条件里才是真想判断相等；别的行是想赋值，写法错了
      if (CONDITION_LINE.test(source))
        return "判断「是不是相等」要用两个等号「==」。一个等号「=」的意思是「把右边的值存进左边的变量」。"
      if (/^\w+\s*=[^=].*,\s*\w+\s*=[^=]/.test(stripStrings(source)))
        return "一行里给几个变量赋值，要写成 a, b = 96, 92，或者分成几行，一行写一个。"
      if (/^\w+\s*\(/.test(source))
        return '括号里不能直接写等号「=」。要把等号显示出来，就把它放进引号里，比如 print(a, "+", b, "=", a + b)。'
      return null
    },
  ],
  [
    /^cannot assign to /,
    () =>
      "等号「=」的左边只能是一个变量名，意思是「把右边算出来的值存进这个变量」。比如要写成 c = a + b，不能写成 a + b = c。",
  ],
  [
    /^unterminated (triple-quoted )?(f-)?string literal/,
    () => "这一行的引号没有配对。字符串要用一对英文引号括起来，开头一个、结尾一个。",
  ],
  [
    /^'(.)' was never closed/,
    ([, open]) => `这里的「${open}」没有配对的另一半。数一数左右括号是不是一样多。`,
  ],
  [/^unmatched '(.)'/, ([, close]) => `这里多了一个「${close}」，前面没有和它配对的括号。`],
  [
    /^closing parenthesis '(.)' does not match opening parenthesis '(.)'/,
    ([, close, open]) => `括号配错了：「${open}」要用和它配对的括号来关，不能用「${close}」。`,
  ],
  [
    /^Missing parentheses in call to '(\w+)'/,
    ([, name]) => `${name} 后面要加括号，写成 ${name}(...)。`,
  ],
  [
    /^invalid decimal literal/,
    () => "数字后面紧跟着字母了。比如「2a」要写成「2*a」；变量名也不能用数字开头。",
  ],
  [
    /^unexpected character after line continuation character/,
    () => "这里的反斜杠「\\」用错了。除法要用「/」，「\\」只能出现在引号里面。",
  ],
  [
    /^'(break|continue)' (not properly in|outside) loop/,
    ([, keyword]) => `${keyword} 只能写在 for 或 while 循环里面（要缩进在循环的下面）。`,
  ],
  [
    /^'return' outside function/,
    () => "return 只能写在 def 定义的函数里面（要缩进在 def 的下面）。",
  ],
  [
    /^f-string: (expecting '}'|single '}' is not allowed)/,
    () => "f 字符串里的花括号「{ }」没有配对，每个「{」都要有一个「}」。",
  ],
  [
    /^f-string: valid expression required/,
    () => "f 字符串的花括号「{ }」里要写变量名或算式，不能空着。",
  ],
  [
    /^leading zeros in decimal integer literals/,
    () => "整数不能用 0 开头，比如「07」要写成「7」。",
  ],
  [
    /^invalid syntax/,
    (_, source) => {
      if (/^elif\s*:/.test(source))
        return "elif 后面要写条件，比如 elif a > 60:。不需要条件的话就用 else:。"
      if (/^else\s+if\b/.test(source)) return "Python 里「否则如果」要写成 elif，不是 else if。"
      if (/^(esle|eles|els|elese|esif|elsif|elseif|eilf|elfi)\b/.test(source))
        return "这一行开头的关键字拼错了：「否则」是 else，「否则如果」是 elif。"
      const code = stripStrings(source)
      if (/=<|=>/.test(code)) return "小于等于要写成 <=，大于等于要写成 >=，等号放在后面。"
      if (CONDITION_LINE.test(source) && hasTopLevelComma(source))
        return "条件之间不能用逗号连：两个都要满足用 and，满足一个就行用 or，比如 if a > 9 and a < 100:。"
      return null
    },
  ],
  [
    /^invalid syntax/,
    () =>
      "标出来的地方写法不对。对照教程检查这一行：括号、引号、冒号、运算符有没有写错、漏写或多写。",
  ],
]

function translate(message: string, source: string) {
  for (const [pattern, render] of RULES) {
    const match = message.match(pattern)
    const text = match && render(match, source)
    if (text) return text
  }
  return null
}

/**
 * 选了 Python 却交了 C 代码：全库 310 条，报错各式各样（多半是 invalid syntax），
 * 挨个解释毫无意义，该说的只有一句
 */
function looksLikeC(code: string) {
  if (/^\s*#\s*include\b|\bint\s+main\s*\(/m.test(code)) return true
  // 只凭 printf 不算：Python 代码里把 print 手误成 printf 的不少
  return /\b(printf|scanf)\s*\(|\bcout\s*<</.test(code) && !/\b(print|input)\s*\(/.test(code)
}

/**
 * 翻不出来（判题机自己的报错、没见过的句式）就返回 null，界面照旧显示原文。
 * `code` 是学生的代码，用来认出「交的其实是 C」
 */
export function explainPythonCompileError(
  errInfo: string,
  code = "",
): PythonErrorExplanation | null {
  const text = errInfo.trim()

  const short = text.match(SHORT_RE)
  if (short) {
    const [, , detail, line] = short
    const message = translate(detail!, "")
    if (!message) return null
    return {
      line: Number(line),
      sourceLine: null,
      caret: null,
      message,
      punctuation: null,
    }
  }

  const where = text.match(WHERE_RE)
  const lines = text.split("\n")
  const last = lines[lines.length - 1]!
  const detail = last.replace(/^\w+Error: /, "")
  if (detail === last) return null

  let sourceLine: string | null = null
  let caret: PythonErrorExplanation["caret"] = null
  if (where) {
    const index = lines.findIndex((line) => WHERE_RE.test(line))
    const code = lines[index + 1]
    const marks = lines[index + 2]
    if (code?.startsWith("    ")) sourceLine = code.slice(4)
    if (sourceLine !== null && marks?.startsWith("    ")) {
      const from = marks.indexOf("^")
      if (from >= 4) caret = { from: from - 4, to: marks.lastIndexOf("^") - 4 + 1 }
    }
  }

  const message = looksLikeC(code)
    ? "这是 C 语言的代码，可提交时选的语言是 Python。把语言换成 C 再交。"
    : translate(detail, sourceLine?.trim() ?? "")
  if (!message) return null

  const char = detail.match(/^invalid character '(.)'/u)?.[1]
  return {
    line: where ? Number(where[1]) : null,
    sourceLine,
    caret,
    message,
    punctuation: char && PUNCTUATION_MAP[char] ? char : null,
  }
}

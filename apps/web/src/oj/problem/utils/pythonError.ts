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

const WHERE_RE = /^File "[^"]*", line (\d+)/m
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
  "×": "*",
  "÷": "/",
  [IDEOGRAPHIC_SPACE]: " ",
}

/**
 * 标点的名字。说明里**只说名字、不拿字形对比**：「：」和「:」、「，」和「,」在正文字体里
 * 几乎一样，「把「：」换成「:」」这句话学生看不出区别。「冒号是中文的，要换成英文的」
 * 看得懂，要换哪一个由卡片里那行代码的标红来指。
 */
const PUNCTUATION_NAMES: Record<string, string> = {
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
  [IDEOGRAPHIC_SPACE]: "空格",
}

type Rule = [RegExp, (match: RegExpMatchArray) => string]

const RULES: Rule[] = [
  [
    /^invalid character '(.)'/,
    ([, char]) => {
      // 数学符号不是「中文的」，是写法不对：代码里乘除用 * 和 /
      if (char === "×") return "这里用了乘号「×」，代码里的乘法要写成星号「*」。"
      if (char === "÷") return "这里用了除号「÷」，代码里的除法要写成斜杠「/」。"
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
    () => "这一行末尾少了英文冒号「:」。if、elif、else、for、while、def 这些行的最后都要有冒号。",
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
    () => "这里好像少了逗号。括号里的几样东西之间，要用英文逗号「,」隔开。",
  ],
  [
    /Maybe you meant '==' instead of '='|Maybe you meant '==' or ':=' instead of '='|perhaps you meant "=="/,
    () =>
      "判断「是不是相等」要用两个等号「==」。一个等号「=」的意思是「把右边的值存进左边的变量」。",
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
    () =>
      "标出来的地方写法不对。对照教程检查这一行：括号、引号、冒号、运算符有没有写错、漏写或多写。",
  ],
]

function translate(message: string) {
  for (const [pattern, render] of RULES) {
    const match = message.match(pattern)
    if (match) return render(match)
  }
  return null
}

/** 翻不出来（判题机自己的报错、没见过的句式）就返回 null，界面照旧显示原文 */
export function explainPythonCompileError(errInfo: string): PythonErrorExplanation | null {
  const text = errInfo.trim()

  const short = text.match(SHORT_RE)
  if (short) {
    const [, , detail, line] = short
    const message = translate(detail!)
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
  const message = translate(detail)
  if (!message) return null

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

  const char = detail.match(/^invalid character '(.)'/)?.[1]
  return {
    line: where ? Number(where[1]) : null,
    sourceLine,
    caret,
    message,
    punctuation: char && PUNCTUATION_MAP[char] ? char : null,
  }
}

import { findChinesePunctuation } from "./chinesePunctuation"
import { PUNCTUATION_NAMES, type PythonErrorExplanation } from "./pythonError"

/**
 * 把 C / C++ 的编译错误（gcc 的原文）翻成中文，和 pythonError.ts 同一个思路：
 * 一张规则表，不是通用翻译。
 *
 * 表是照全库 2851 条 C / C++ 编译错误、用现在的判题机（gcc-14、languages.ts 的编译参数）
 * 重新编译出来的报错定的（2026-09），只看**第一条 error**：后面的多半是它连带出来的。
 * 判题机的原文长这样：
 *
 *     main.c: In function 'main':
 *     main.c:17:16: error: expected ';' before ':' token
 *        17 |     printf("a"):
 *           |                ^
 *           |                ;
 *
 * 三件事先于句式判，因为同一个错在 gcc 那里的报法五花八门：
 * - **交成了 Python 代码**（全库 330 条）：gcc 会把 `a = input()` 当成省略了类型的声明，
 *   报出来的是 request for member、initializer element is not constant 之类，挨个解释没有意义。
 * - **C 里写了 C++**（iostream、cout）。
 * - **中文标点**：gcc-14 不再报 `stray '\357'`，而是把「；」吞进前面的名字里（`a；` 成了
 *   一个变量名），报错落在下一行、写成 `'scanf\U0000ff08' undeclared`。所以直接在代码里
 *   找引号和注释之外的中文标点，行号也按代码里的位置算。
 */

/** 第一条 error（链接错误没有行号，是 `undefined reference to`） */
const FIRST_ERROR_RE =
  /^[^\n:]*?:(\d+):(\d+): (?:fatal )?error: (.*)$|undefined reference to `([^']+)'/m

type Context = {
  /** gcc 摘录的出错那一行（去了行首空白） */
  source: string
  /** 报错点名的那个词正好是这一行的开头：`before 'scanf'`，真正少分号的是上一行 */
  atLineStart: boolean
  code: string
  language: string
}

type Rule = [RegExp, (match: RegExpMatchArray, context: Context) => string | null]

/** gcc 把非 ASCII 字符写成 `\U0000ff1b`，还原成字符才能给学生看 */
function unescapeGcc(text: string) {
  return text.replace(/\\U([0-9a-f]{8})/g, (_, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  )
}

/** 学生最常拼错的几个函数名：print、sacnf、pritnf…… */
const IO_TYPO = /^(pr\w*|sc\w*|sa\w*|sn\w*|pi\w*|pt\w*)$/

const MISSING_SEMICOLON = "这一行末尾少了分号 ;。C 语言每条语句写完都要加分号。"
const PREVIOUS_SEMICOLON = "上一行末尾少了分号 ;。C 语言每条语句写完都要加分号。"
const COLON_FOR_SEMICOLON = "语句的末尾要用分号 ;，这里写成了冒号 :。"

const KEYWORDS = [
  "return",
  "else",
  "continue",
  "break",
  "while",
  "switch",
  "case",
  "default",
  "printf",
  "scanf",
  "double",
  "float",
  "char",
  "include",
]
const TYPE_NAMES = new Set(["int", "char", "float", "double", "long", "short"])

/** 编辑距离，只用来认关键字拼错（coutinue、retrun、esle），名字都很短 */
function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

function keywordTypo(name: string) {
  if (name.length < 3) return null
  // RETURN、Printf：C 区分大小写
  const lower = name.toLowerCase()
  if (lower !== name && KEYWORDS.includes(lower))
    return { keyword: lower, glued: false, cased: true }
  // return0：关键字和后面的值之间少了空格
  const glued = KEYWORDS.find((keyword) => name.startsWith(keyword) && name.length > keyword.length)
  if (glued && /^\d/.test(name.slice(glued.length)))
    return { keyword: glued, glued: true, cased: false }
  const keyword = KEYWORDS.find(
    (item) => item !== name && distance(item, name) <= (item.length > 5 ? 2 : 1),
  )
  return keyword ? { keyword, glued: false, cased: false } : null
}
const OUTSIDE_MAIN =
  "这些语句写在了 main 外面：printf、scanf 这些都要写在 int main() { 和 } 之间。看看 } 是不是提前结束了 main。"

const RULES: Rule[] = [
  // 名字里有中文：要输出的文字忘了加引号（printf(你好)），或者中文写到了代码里
  [
    /^(?:'[^']*\P{ASCII}[^']*' (?:undeclared|was not declared)|unknown type name '[^']*\P{ASCII})/u,
    () =>
      '中文只能写在英文双引号里（要输出的文字），或者写在注释里。要原样输出的文字，比如 printf("你好");。',
  ],
  [/^expected (?:';'|',' or ';') before ':' token/, () => COLON_FOR_SEMICOLON],
  [/^expected ';' before '(\S+)'/, () => MISSING_SEMICOLON],
  // 报在下一句开头（`before 'int'`），真正少分号的是上一句；也可能是几个变量之间少了逗号
  [
    /^expected ',' or ';' before/,
    (_, { atLineStart }) =>
      atLineStart
        ? PREVIOUS_SEMICOLON
        : "这一句少了分号或者逗号：一行里定义几个变量，变量之间要用逗号隔开，最后加分号，比如 int a, b;。",
  ],
  [
    /^'(\w+)' (?:undeclared|was not declared in this scope)(?:.*did you mean '(\w+)')?/,
    ([, name, suggestion], { source, code, language }) => {
      if (language === "C++" && /^(cout|cin|endl)$/.test(name!))
        return `「${name}」要先引入：程序开头写 #include <iostream>，再写 using namespace std;。`
      if (language === "C++" && /^(setprecision|setw|fixed)$/.test(name!))
        return `用「${name}」要在程序开头加上 #include <iomanip>。`
      const typo = keywordTypo(name!)
      if (typo?.glued)
        return `「${typo.keyword}」和后面的值之间要空一格，写成 ${typo.keyword} ${name!.slice(typo.keyword.length)}。`
      if (typo?.cased) return `C 语言区分大小写，「${name}」要写成「${typo.keyword}」。`
      if (typo) return `「${name}」拼错了，是不是想写「${typo.keyword}」？`
      // printf(Hello) —— 要原样输出的文字没加引号
      if (
        new RegExp(`\\b(printf|puts)\\s*\\(\\s*${name}\\b|<<\\s*${name}\\b`).test(source) ||
        /^[A-Z]{4,}$/.test(name!)
      )
        return language === "C++"
          ? '要原样输出的文字得放在英文双引号里，比如 cout << "Hello";。'
          : '要原样输出的文字得放在英文双引号里，比如 printf("Hello");。'
      // gcc 的「did you mean」会从库函数里挑（num → enum、Hello → ftello），
      // 只信学生自己代码里有的名字
      if (suggestion && new RegExp(`\\b${suggestion}\\b`).test(code))
        return `「${name}」没有定义过，是不是想写「${suggestion}」？`
      return `「${name}」这个变量还没定义就用了：先写 int ${name}; 这样的定义，也检查一下拼写和大小写。`
    },
  ],
  [
    /^expected declaration or statement at end of input|^expected '}' at end of input/,
    () => "少写了 }：数一数每个 { 是不是都有对应的 }。",
  ],
  [
    /^expected expression before '(.+?)'/,
    ([, token], { source }) => {
      if (/=<|=>/.test(source)) return "小于等于要写成 <=，大于等于要写成 >=，等号放在后面。"
      if (token === "else") return "else 前面的 if 写得不完整：看看 if 那一行末尾是不是多写了分号。"
      if (TYPE_NAMES.has(token!))
        return `「${token}」是类型名，不能当变量用，这里要写你自己起的变量名。`
      return "这里少了一个值：运算符、逗号的两边都得有东西，看看是不是多写了符号，或者漏写了变量。"
    },
  ],
  [
    /^expected '=', ',', ';', 'asm' or '__attribute__' (?:before|at end of input)/,
    (_, { source, atLineStart }) => {
      if (/^include\b/.test(source)) return "#include 前面的 # 没有写。"
      if (atLineStart) return PREVIOUS_SEMICOLON
      return "定义变量的这一句写法不对：几个变量之间要用逗号隔开，最后加分号，比如 int a, b;。也看看上一行末尾是不是少了分号。"
    },
  ],
  [
    /^missing terminating (["']) character/,
    () => "引号没有配对：文字要用两个英文双引号包起来，看看是不是少了一个，或者混进了中文引号。",
  ],
  [
    /^stray '\\' in program/,
    () => '\\n 这类带反斜杠的写法要放在双引号里面，比如 printf("%d\\n", a);。',
  ],
  [
    /^stray '#' in program/,
    () => "#include 要单独占一行、写在最前面。看看是不是把代码粘贴了两遍。",
  ],
  [
    /^stray '/,
    () => "这里有一个不能出现在代码里的字符，多半是中文输入法打出来的，删掉后用英文输入法重新打。",
  ],
  [
    /^invalid preprocessing directive #(\w+); did you mean #include\?/,
    ([, name]) => `「#${name}」拼错了，应该是 #include。`,
  ],
  [
    /^invalid preprocessing directive/,
    () => "# 这一行写错了，引入头文件要写成 #include <stdio.h>。",
  ],
  [
    /^(\S+): No such file or directory/,
    ([, file], { language }) => {
      if (language === "C" && /^(iostream|bits\/stdc\+\+\.h|cstdio|cmath|string)$/.test(file!))
        return `${file} 是 C++ 的头文件，语言要选 C++。C 语言的输入输出用 #include <stdio.h>。`
      return `头文件「${file}」不存在，多半是拼错了：常用的是 stdio.h、math.h、string.h。`
    },
  ],
  [/^#include expects/, () => "#include 后面要用尖括号把头文件名括起来：#include <stdio.h>。"],
  [
    /^'else' without a previous 'if'/,
    () => "else 前面没有配对的 if：看看 if 那一行末尾是不是多写了分号，或者 if 的 { } 没有配对。",
  ],
  [
    /^invalid operands to binary & /,
    () => '格式和变量之间要用逗号隔开，比如 scanf("%d%d", &a, &b)。',
  ],
  [/^invalid operands to binary % /, () => "取余 % 只能用在整数上，小数不能取余。"],
  [/^invalid operands to binary/, () => "这两个值不能做这种运算，看看两边的类型对不对。"],
  [
    /^(unknown type name|'\w+' does not name a type)/,
    (match) => {
      const name = match.input!.match(/'(\w+)'/)?.[1]
      const suggestion = match.input!.match(/did you mean '(\w+)'/)?.[1]
      if (name === "string")
        return "C 语言没有 string 类型，字符串要用 char 数组，比如 char s[100];。"
      if (name === "bool") return "用 bool 要在程序开头加上 #include <stdbool.h>。"
      // C++ 的 does not name a type：语句写在函数外面
      if (/does not name a type/.test(match.input!)) return OUTSIDE_MAIN
      const typo = name ? keywordTypo(name) : null
      if (typo && !typo.glued) return `「${name}」拼错了，是不是想写「${typo.keyword}」？`
      if (name && suggestion) return `「${name}」不是类型名，是不是想写「${suggestion}」？`
      if (name && /^[a-z]\w*$/.test(name) && name.length <= 8)
        return `「${name}」不是类型名：常用的类型是 int、float、double、char，也看看上一行末尾是不是少了分号。`
      return OUTSIDE_MAIN
    },
  ],
  [
    /^expected declaration specifiers|^expected identifier or '\(' before|^expected unqualified-id|^expected constructor, destructor, or type conversion/,
    (_, { source }) =>
      // int main(); 下一行才是 {
      source.startsWith("{")
        ? "上一行末尾多了分号：int main() 后面直接跟 {，不能加分号。"
        : OUTSIDE_MAIN,
  ],
  [
    /^expected '\)' before/,
    (_, { source }) =>
      /\b(printf|scanf)\s*\(\s*"[^"]*"\s*[^\s,)]/.test(source)
        ? '格式和变量之间要用逗号隔开，比如 printf("%d", a)。'
        : "括号没有配对，或者括号里几个值之间少了逗号。",
  ],
  [/^expected '\(' before/, () => "if、while、for 后面的条件要用圆括号括起来，比如 if (a > 0)。"],
  [/^expected ':' before/, () => "case 后面要用冒号 :，比如 case 1:。"],
  [/^empty character constant/, () => "两个单引号中间不能是空的；要输出文字，用双引号。"],
  [/^no match for 'operator(<<|>>)'/, () => "cin 要用 >>，cout 要用 <<，方向不能写反。"],
  [
    /^expected primary-expression before/,
    () => "这里少了一个值：比如 cout << 的后面不能空着，运算符的两边都要有东西。",
  ],
  [/^array size missing/, () => "数组要写上大小，比如 int a[10];。"],
  [
    /^initializer element is not constant/,
    () => "main 外面定义的变量只能给固定的值：要用输入或者计算的结果，就把它挪到 main 里面。",
  ],
  [
    /^request for member/,
    () => "只有结构体才能用点 . 取里面的东西。像 s.split() 这种是 Python 的写法，C 语言里没有。",
  ],
  [/^duplicate case value/, () => "switch 里有两个 case 的值是一样的。"],
  [
    /^lvalue required as left operand of assignment/,
    () => "等号 = 的左边只能是一个变量。判断相等要用两个等号 ==。",
  ],
  [
    /^(?:redeclaration|redefinition) of '(\w+)'/,
    ([, name]) => `「${name}」定义了两次：同一个变量只能定义一次，后面再用的时候直接写名字。`,
  ],
  [
    /^invalid suffix "(.+?)" on (?:integer|floating) constant/,
    () => "数字后面紧跟着字母了：比如 2x 要写成 2*x；变量名也不能用数字开头。",
  ],
  [
    /^too (?:few|many) arguments to function '(\w+)'/,
    ([, name]) => `调用「${name}」时括号里给的值的个数不对。`,
  ],
  [
    /^(break|continue) statement not within loop/,
    ([, keyword]) => `${keyword} 只能写在循环${keyword === "break" ? "或者 switch " : ""}里面。`,
  ],
  [
    /^conflicting types for '(\w+)'/,
    ([, name]) => `「${name}」前后的类型不一致，或者和自带的函数重名了，换一个名字试试。`,
  ],
]

function translate(detail: string, context: Context) {
  for (const [pattern, render] of RULES) {
    const match = detail.match(pattern)
    const text = match && render(match, context)
    if (text) return text
  }
  return null
}

/** 没有 #include、却有 print( / input( / def / elif：交的是 Python */
function looksLikePython(code: string) {
  if (/\b(printf|scanf|puts|cout|cin)\b/.test(code)) return false
  return /\b(print|input)\s*\(|^\s*(def|elif)\b|^\s*for\s+\w+\s+in\b/m.test(code)
}

function looksLikeCpp(code: string) {
  return /#\s*include\s*<(iostream|bits\/stdc\+\+\.h)>|\bcout\s*<<|\bcin\s*>>|\busing\s+namespace\b/.test(
    code,
  )
}

/** 东亚宽字符（中文、全角标点）在 gcc 的列里占两格 */
const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u

/**
 * gcc 的 `^` 按显示宽度对齐（-fdiagnostics-column-unit 默认是 display）：中文占两格。
 * 换算成字符下标；摘录里的 Tab 已经展开成空格，所以不用管 Tab
 */
function displayToIndex(text: string, column: number) {
  let width = 0
  let index = 0
  for (const char of text) {
    if (width >= column) return width === column ? index : null
    width += WIDE.test(char) ? 2 : 1
    index += char.length
  }
  return width >= column ? index : null
}

/** 第 `line` 行 gcc 摘录的那一行，和 `^` 标的范围 */
function snippet(lines: string[], index: number, line: number) {
  for (let i = index + 1; i < Math.min(lines.length, index + 3); i++) {
    const match = lines[i]!.match(/^\s*(\d+) \| (.*)$/)
    if (!match || Number(match[1]) !== line) continue
    const text = match[2]!
    const indent = text.length - text.trimStart().length
    const source = text.trimStart()
    const marks = lines[i + 1]?.match(/^\s*\| (.*)$/)?.[1] ?? ""
    const from = marks.indexOf("^")
    const width = marks.slice(from).match(/^[\^~]+/)?.[0].length ?? 1
    const start = displayToIndex(text, from)
    const end = displayToIndex(text, from + width)
    const caret =
      from >= 0 && start !== null && end !== null && start >= indent
        ? { from: start - indent, to: Math.max(end, start + 1) - indent }
        : null
    return { source, caret }
  }
  return { source: "", caret: null }
}

/** 翻不出来就返回 null，界面照旧显示原文 */
export function explainCCompileError(
  errInfo: string,
  code: string,
  language: string,
): PythonErrorExplanation | null {
  const text = errInfo.trim()
  const where = text.match(FIRST_ERROR_RE)
  if (!where) return null

  const base = { sourceLine: null, caret: null, punctuation: null }
  if (looksLikePython(code)) {
    return {
      ...base,
      line: null,
      message: `这是 Python 的写法，可提交时选的语言是 ${language}。要么把语言换成 Python，要么改成 ${language} 的写法：输入输出用 ${language === "C++" ? "cin 和 cout" : "scanf 和 printf"}。`,
    }
  }
  if (!/\bmain\s*\(/.test(code)) {
    return {
      ...base,
      line: null,
      message: "程序要从 int main() { 开始写，最后是 }，这里没有 main。",
    }
  }
  if (language === "C" && looksLikeCpp(code)) {
    return {
      ...base,
      line: null,
      message: "这是 C++ 的写法（iostream、cout、cin），提交时语言要选 C++。",
    }
  }

  const punctuation = findChinesePunctuation(code, language)[0]
  if (punctuation) {
    const char = code[punctuation.from]!
    const name = PUNCTUATION_NAMES[char] ?? "标点"
    return {
      ...base,
      line: code.slice(0, punctuation.from).split("\n").length,
      message: `这里的${name}是中文输入法打出来的，要换成英文的${name}。写代码的时候先切换到英文输入法。`,
      punctuation: char,
    }
  }

  // 链接错误：函数名拼错、没有 main。没有行号，到代码里找它第一次出现的地方
  const linked = where[4]
  if (linked) {
    if (linked === "main")
      return { ...base, line: null, message: "程序要从 int main() 开始写，这里没有找到 main。" }
    const at = code.search(new RegExp(`\\b${linked}\\s*\\(`))
    return {
      ...base,
      line: at < 0 ? null : code.slice(0, at).split("\n").length,
      message: IO_TYPO.test(linked)
        ? `「${linked}」这个函数不存在，多半是拼错了：输出是 printf，输入是 scanf。`
        : `「${linked}」这个函数不存在：检查一下拼写，或者是不是忘了定义它。`,
    }
  }

  let line = Number(where[1])
  const detail = unescapeGcc(where[3]!)
  const lines = text.split("\n")
  const index = lines.findIndex((item) => item.includes(where[0]))
  const { source, caret } = snippet(lines, index, line)
  const token = detail.match(/before '([^']+)'/)?.[1]
  const atLineStart = !!token && source.startsWith(token)
  const message = translate(detail, { source, atLineStart, code, language })
  if (!message) return null

  // 报在下一句开头：往回找到真正少分号的那一行（跳过空行）
  if (message === PREVIOUS_SEMICOLON) {
    const codeLines = code.split("\n")
    let previous = line - 1
    while (previous > 1 && !codeLines[previous - 1]?.trim()) previous--
    if (previous >= 1) return { ...base, line: previous, message }
  }
  if (line > code.split("\n").length) line = code.split("\n").length
  return { line, sourceLine: caret ? source : null, caret, message, punctuation: null }
}

import type { StatisticInfo } from "@oj2/contract"

/**
 * 把运行时错误的诊断（`statistic_info.runtime_error`，后端 judge/runtime-diagnosis.ts
 * 写的）翻成给中职学生看的中文。界面上不出现英文的异常名。
 *
 * 诊断里只有异常类型、归好类的 kind 和学生代码里的名字，**没有异常的原文消息**
 * （原文里常带着隐藏测试点的输入），所以这里的说明都是按类型写的通用话，
 * 定位靠行号和编辑器里的标红。
 */
export type RuntimeErrorInfo = NonNullable<StatisticInfo["runtime_error"]>

/**
 * 说得最多的一句：input() 读进来的是文字。只在代码里真有 input( 时才说 —— 列表练习题
 * 里的类型错误压根没读输入，硬说这句等于指错方向（题目模板里的 input() 看不到，不算）
 */
const INPUT_IS_TEXT = "input() 读进来的是文字，要计算先用 int() 或 float() 转成数字。"

/** 参数个数不对时，按函数补一句正确用法。都是学生最常用错的几个 */
const ARG_TIPS: Record<string, string> = {
  append:
    'append() 一次只能加一个值；要一次加好几个，用 extend()，把它们放进一个列表：extend(["甲", "乙"])。',
  extend: 'extend() 括号里只放一个列表，比如 extend(["甲", "乙"])，不是把几个值分开写。',
  insert: 'insert() 要两个值：先写位置，再写要插进去的值，比如 insert(1, "甲")。',
  pop: "pop() 括号里最多放一个位置，不写就是取出最后一个。",
  remove: "remove() 括号里只放要删掉的那一个值。",
  index: "index() 括号里放要找的那个值。",
  count: "count() 括号里放要数的那个值。",
  find: "find() 括号里放要找的那段文字。",
  len: "len() 括号里只放一个值，比如 len(line)。",
  input: "input() 括号里最多放一句提示文字；要输出几个值，用 print()。",
  replace: 'replace() 要两个值：先写旧的，再写新的，比如 replace("a", "b")。',
  range: "range() 括号里放一到三个整数，比如 range(5)、range(1, 10)。",
  join: 'join() 括号里只放一个列表，比如 "、".join(line)。',
}

/** 学生常当成方法写的内置函数：s.len()、line.sorted() */
const BUILTIN_FUNCTIONS = new Set([
  "len",
  "sorted",
  "sum",
  "max",
  "min",
  "int",
  "str",
  "float",
  "list",
  "print",
  "input",
  "reversed",
  "round",
  "abs",
])

type Explain = (info: RuntimeErrorInfo, hasInput: boolean) => string

const BY_KIND: Record<string, Explain> = {
  "int-parse": (_, hasInput) =>
    hasInput
      ? "把输入转成整数的时候失败了：读到的内容不是一个整数。常见原因：一行里输入了好几个数，要先用 split() 拆开再转换；或者输入的是小数，要用 float()。"
      : "把文字转成整数的时候失败了：这段文字不是一个整数，比如里面有空格、小数点或者别的字。",
  "float-parse": (_, hasInput) =>
    hasInput
      ? "把输入转成数字的时候失败了：读到的内容不是一个数。常见原因：一行里输入了好几个数，要先用 split() 拆开再转换。"
      : "把文字转成数字的时候失败了：这段文字不是一个数。",
  unpack: () =>
    "等号左边的变量个数，和右边拆出来的值的个数对不上。比如 a, b = input().split() 要求这一行正好有两个值，对照题目的输入格式看看一行里有几个数。",
  "math-domain": () => "数学函数拿到了不合法的值，比如给负数开平方。",
  "empty-sep": () =>
    "split() 的括号里不能放空的 ''：要按空格拆，括号里什么都不写，就是 split()；要把文字拆成一个个字，用 list(文字)。",
  "not-in-list": () =>
    "要找或者要删的值不在列表里：index() 和 remove() 只能用列表里真有的值。可以先用 in 判断一下，比如 if x in line:。",
  "format-spec": () =>
    "保留小数的格式写错了：要写成 %.2f 或者 {:.2f}。中间的点是英文句点，不是逗号，也不是中文句号；点后面写数字，最后是 f。",
  "str-concat": (_, hasInput) =>
    `文字和数字不能直接用 + 连在一起。${hasInput ? INPUT_IS_TEXT : ""}要拼成一句话，就用 str() 把数字转成文字。`,
  operand: (_, hasInput) =>
    hasInput
      ? `这两个值的类型不能做这种运算，多半是拿文字和数字一起算。${INPUT_IS_TEXT}`
      : "这两个值的类型不能做这种运算，比如文字和数字不能相减、相除。",
  "not-int": (_, hasInput) =>
    `这里需要一个整数，给的却是文字、小数或者列表。比如 range() 里要放整数${hasInput ? "，input() 读进来的要先用 int() 转换" : ""}。`,
  compare: (_, hasInput) => `文字和数字不能比大小。${hasInput ? INPUT_IS_TEXT : ""}`,
  "not-callable": () =>
    "把一个不是函数的东西当成函数用了。常见原因：乘法漏写了 *（比如 2(a+b) 要写成 2*(a+b)），或者拿 print、input、sum 这类名字当了变量名。",
  "not-subscriptable": () =>
    "对一个数字用了下标 [ ]。只有列表、字符串这类值才能用 [ ] 取出其中一个。",
  "missing-arg": () => "调用函数的时候，括号里少给了值。",
  "index-type": (_, hasInput) =>
    `下标要用整数。${hasInput ? "input() 读进来的是文字，要先用 int() 转换。" : ""}`,
  "index-comma": () => "下标里不能写逗号：取一个用 s[2]，取一段用冒号，比如 s[2:4]。",
  "slice-type": () =>
    "表示位置的值要用整数。常见的是 index()：括号里先写要找的那个值，后面如果再写，就是查找范围的起止位置，只能是整数；切片 a[开始:结束] 里的位置也一样。",
  "arg-count": ({ name }) => {
    if (!name) return "调用函数的时候，括号里给的值的个数不对。"
    return `「${name}()」括号里给的值的个数不对。${ARG_TIPS[name] ?? ""}`
  },
  keyword: ({ name, suggestion }) => {
    if (name && suggestion) return `「${name}=」这个名字写错了，是不是想写「${suggestion}=」？`
    if (name) return `函数不认识「${name}=」这个写法，检查一下拼写。`
    return "函数不认识括号里「名字=」这个写法，检查一下拼写。"
  },
  "no-keyword": ({ name }) =>
    `${name ? `「${name}()」的` : ""}括号里不能写「名字=值」，直接写值就行。`,
  descriptor: ({ name }) =>
    name
      ? `要写成「变量名.${name}(...)」：点前面是你自己的那个列表或字符串，而不是 list、str 这种类型名。`
      : "要写成「变量名.方法名(...)」：点前面是你自己的那个列表或字符串，而不是 list、str 这种类型名。",
  "type-subscript": ({ name }) =>
    name
      ? `「${name}」后面要用圆括号：写成 ${name}(...)，不是 ${name}[...]。`
      : "类型名后面要用圆括号，比如 int(...)，不是 int[...]。",
  "func-value": () =>
    "有一个函数名后面忘了写括号：比如 input 要写成 input()，s.split 要写成 s.split()。不写括号，拿到的是函数本身，不是它的结果。",
  "none-value": () =>
    "这个值是 None，也就是什么都没有：print()、append()、sort() 这类函数只做事、不给结果，自己写的函数没写 return 也一样。比如 a = print(x) 之后 a 就是 None，别拿它接着用。",
  "type-name": () =>
    "list、dict 这些是 Python 自带的类型名，不是你的变量：这里要写你自己起的变量名，比如 scores[i]，而不是 list[i]。",
  "map-value": () =>
    "map() 的结果不能直接用 len() 或者下标 [ ]，先用 list() 把它转成列表，比如 scores = list(map(int, input().split()))。",
  "str-mod": (_, hasInput) =>
    hasInput
      ? `对文字用了 %：% 用在文字上是格式化，不是取余。${INPUT_IS_TEXT}`
      : "对文字用了 %：% 用在文字上是格式化，不是取余；用 % 格式化的话，文字里 % 的个数要和后面给的值一样多。",
  "seq-mul": (_, hasInput) =>
    `文字只能乘一个整数，意思是把它重复几遍，不能和文字或者小数相乘。${hasInput ? INPUT_IS_TEXT : ""}`,
  unary: () =>
    "+ 的左边少了东西：比如写成了 print(+a) 或者 , +b，+ 只有右边有值。要把文字连起来，+ 两边都要有值；要分开输出，用逗号隔开就行，不用再写 +。",
  "unpack-number": (_, hasInput) =>
    hasInput
      ? "一个数不能拆给好几个变量。一行里有好几个数的话，要先用 split() 拆开，比如 a, b = map(int, input().split())。"
      : "一个数不能拆给好几个变量：等号右边要是一组值，比如 a, b = 1, 2。",
  "convert-arg": (_, hasInput) =>
    `int() 和 float() 一次只能转换一个值，不能直接转换整个列表。${hasInput ? "一行里有好几个数的话，写成 map(int, input().split())。" : ""}`,
  "not-iterable": () =>
    "这个值不能一个个地取出来：for 和 in 后面要放列表、字符串或者 range()，比如 for i in 5 要写成 for i in range(5)。",
  "no-len": () => "数字没有长度：len() 只能用在字符串、列表这类值上。",
  "read-only": ({ name }) =>
    name
      ? `「${name}」是方法，要用括号调用，写成「变量名.${name}(...)」，不能用等号给它赋值。`
      : "方法要用括号调用，不能用等号给它赋值。",
  "eval-syntax": (_, hasInput) =>
    `eval() 读到的内容不是一个完整的算式。${hasInput ? "常见原因：一行里有好几个数用空格隔开，这时要用 input().split() 拆开，再用 int() 转换。" : ""}`,
  "number-attr": ({ name }) =>
    `数字没有${name ? `「${name}」这个` : "这个"}方法，split()、count() 这些是文字和列表才有的。常见原因：先用 int() 转换、再 split()，顺序反了，要先拆开再转换。`,
  import: ({ name }) =>
    name
      ? `用「${name}」之前要先导入：在程序的开头写 import ${name}。`
      : "用到的模块还没导入：在程序的开头写 import 和模块名。",
}

const BY_TYPE: Record<string, string> = {
  ValueError: "这里用到的值不符合要求。",
  TypeError:
    "这一行里有个值的类型不对，或者某个函数的用法不对，对照一下每个值是什么、函数该怎么用。",
  IndexError:
    "下标越界了：要取的位置超出了列表或字符串的长度。下标从 0 开始，长度是 n 的话，最后一个是 [n-1]。",
  UnboundLocalError: "函数里的这个变量还没赋值就先用了。",
  ZeroDivisionError: "除数是 0 了（除法 / 、整除 // 或者取余 %）。做除法之前先判断除数是不是 0。",
  EOFError:
    "程序读的输入比题目给的多：input() 用的次数超过了输入的行数。看看输入格式，如果几个数在同一行，要用一次 input() 读进来，再用 split() 拆开。",
  KeyError: "字典里没有这个键。取之前先用 in 判断一下键在不在字典里。",
  RecursionError: "函数自己调用自己的层数太多了，检查一下递归有没有写结束条件。",
  ModuleNotFoundError: "导入的模块不存在，判题的环境里只有 Python 自带的模块。",
  ImportError: "导入的模块或者名字不存在，判题的环境里只有 Python 自带的模块。",
  MemoryError: "程序占用的内存太多了。",
  OverflowError: "算出来的数太大了，超出了能表示的范围。",
}

function explainPython(info: RuntimeErrorInfo, code: string) {
  const byKind = info.kind ? BY_KIND[info.kind] : undefined
  if (byKind) return byKind(info, /\binput\s*\(/.test(code))
  if (info.type === "NameError") {
    if (!info.name)
      return "用到了一个没有定义过的名字：检查拼写和大小写，或者是不是还没赋值就先用了。"
    if (info.suggestion)
      return `「${info.name}」这个名字没有定义过，是不是想写「${info.suggestion}」？`
    return `「${info.name}」这个名字没有定义过：检查拼写和大小写，或者是不是还没赋值就先用了。`
  }
  if (info.type === "AttributeError") {
    if (info.name && BUILTIN_FUNCTIONS.has(info.name))
      return `「${info.name}」不是方法，是函数：要写成 ${info.name}(值)，不是 值.${info.name}()。`
    if (info.suggestion)
      return `${info.name ? `这个值没有「${info.name}」这个方法` : "方法名写错了"}，是不是想写「${info.suggestion}」？`
    const what = info.name ? `「${info.name}」这个` : "你用的这个"
    return `这个值没有${what}方法或属性：可能是拼错了，或者这个值的类型不对。`
  }
  return (info.type && BY_TYPE[info.type]) || "程序运行到这里出错，停下来了。"
}

/**
 * C / C++ 只有信号和退出码。31、25 两个分支是照全库 C 运行时错误重跑补的（2026-09）：
 * 两类占了一半多，原来都只有一句「崩溃了」
 */
function explainNative(info: RuntimeErrorInfo, code: string) {
  switch (info.signal) {
    case 11:
      return "程序访问了不该访问的内存。常见原因：scanf 的变量前面忘了写 &；数组下标越界了；数组开得太大（可以挪到 main 外面定义）。"
    case 8:
      return "整数除以 0 了：除法 / 或者取余 % 的右边是 0。"
    case 6:
      return "程序被强制终止了，常见原因是内存访问出错、数组越界，C++ 里也可能是有异常没有处理。"
    // 判题沙箱拦下的系统调用：system("pause") 要起子进程；字符数组溢出时 glibc 要去开
    // /dev/tty 报错，也被拦成了这个
    case 31:
      return /\bsystem\s*\(/.test(code)
        ? '判题的时候不能用 system()，比如 system("pause")，把这一行删掉。'
        : "程序被判题机拦下来了。常见原因：字符数组开得太小，装不下输入的内容（字符串的结尾还要多留一个位置），把数组开大一点。"
    case 25:
      return "输出的内容太多了：多半是循环停不下来，一直在打印。检查循环条件会不会变成假、循环变量有没有在变。"
  }
  if (info.signal) return "程序运行的时候崩溃了。"
  if (info.exit_code) {
    if (!/\bint\s+main\s*\(/.test(code))
      return "main 前面要写 int，写成 int main()，最后再写 return 0;。"
    return `程序结束时返回的是 ${info.exit_code} 而不是 0：main 函数的最后要写 return 0;`
  }
  return "程序运行到一半出错，停下来了。"
}

/**
 * `code` 是学生自己的代码（不含题目模板）：Python 用来判断说不说「input() 读进来的是
 * 文字」，C 用来认出 system() 和没写 int 的 main
 */
export function explainRuntimeError(info: RuntimeErrorInfo, code: string) {
  return info.type ? explainPython(info, code) : explainNative(info, code)
}

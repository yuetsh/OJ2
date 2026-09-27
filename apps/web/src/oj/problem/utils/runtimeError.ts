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

/** 说得最多的一句：input() 读进来的是文字。学生栽在类型上，十有八九是这个 */
const INPUT_IS_TEXT = "input() 读进来的是文字，要计算先用 int() 或 float() 转成数字。"

const BY_KIND: Record<string, string> = {
  "int-parse":
    "把输入转成整数的时候失败了：读到的内容不是一个整数。常见原因：一行里输入了好几个数，要先用 split() 拆开再转换；或者输入的是小数，要用 float()。",
  "float-parse":
    "把输入转成数字的时候失败了：读到的内容不是一个数。常见原因：一行里输入了好几个数，要先用 split() 拆开再转换。",
  unpack:
    "等号左边的变量个数，和右边拆出来的值的个数对不上。比如 a, b = input().split() 要求这一行正好有两个值，对照题目的输入格式看看一行里有几个数。",
  "math-domain": "数学函数拿到了不合法的值，比如给负数开平方。",
  "str-concat": `文字和数字不能直接用 + 连在一起。${INPUT_IS_TEXT}要拼成一句话，就用 str() 把数字转成文字。`,
  operand: `这两个值的类型不能做这种运算，多半是拿文字和数字一起算。${INPUT_IS_TEXT}`,
  "not-int":
    "这里需要一个整数，给的却是文字或小数。比如 range() 里要放整数，input() 读进来的要先用 int() 转换。",
  compare: `文字和数字不能比大小。${INPUT_IS_TEXT}`,
  "not-callable":
    "把一个不是函数的东西当成函数用了。常见原因：乘法漏写了 *（比如 2(a+b) 要写成 2*(a+b)），或者拿 print、input、sum 这类名字当了变量名。",
  "not-subscriptable": "对一个数字用了下标 [ ]。只有列表、字符串这类值才能用 [ ] 取出其中一个。",
  "missing-arg": "调用函数的时候少给了参数。",
  "index-type": "下标要用整数。input() 读进来的是文字，要先用 int() 转换。",
}

const BY_TYPE: Record<string, string> = {
  ValueError: "这里用到的值不符合要求。",
  TypeError: `这里的值类型不对，比如把文字当成数字来用。${INPUT_IS_TEXT}`,
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

function explainPython(info: RuntimeErrorInfo) {
  if (info.type === "NameError") {
    if (!info.name)
      return "用到了一个没有定义过的名字：检查拼写和大小写，或者是不是还没赋值就先用了。"
    if (info.suggestion)
      return `「${info.name}」这个名字没有定义过，是不是想写「${info.suggestion}」？`
    return `「${info.name}」这个名字没有定义过：检查拼写和大小写，或者是不是还没赋值就先用了。`
  }
  if (info.type === "AttributeError") {
    const what = info.name ? `「${info.name}」这个` : "你用的这个"
    return `这个值没有${what}方法或属性：可能是拼错了，或者这个值的类型不对。`
  }
  return (
    (info.kind && BY_KIND[info.kind]) ||
    (info.type && BY_TYPE[info.type]) ||
    "程序运行到这里出错，停下来了。"
  )
}

function explainNative(info: RuntimeErrorInfo) {
  switch (info.signal) {
    case 11:
      return "程序访问了不该访问的内存。常见原因：scanf 的变量前面忘了写 &；数组下标越界了；数组开得太大（可以挪到 main 外面定义）。"
    case 8:
      return "整数除以 0 了：除法 / 或者取余 % 的右边是 0。"
    case 6:
      return "程序被强制终止了，常见原因是内存访问出错、数组越界，C++ 里也可能是有异常没有处理。"
  }
  if (info.signal) return "程序运行的时候崩溃了。"
  if (info.exit_code)
    return `程序结束时返回的是 ${info.exit_code} 而不是 0：main 函数的最后要写 return 0;`
  return "程序运行到一半出错，停下来了。"
}

export function explainRuntimeError(info: RuntimeErrorInfo) {
  return info.type ? explainPython(info) : explainNative(info)
}

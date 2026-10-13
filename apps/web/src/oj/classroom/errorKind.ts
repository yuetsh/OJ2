import { classifyDiff, type DiffKind } from "oj/problem/utils/wrongAnswer"
import { JUDGE_STATUS, SubmissionStatus } from "utils/constants"
import type { ClassBoardCell } from "utils/types"

/**
 * 课堂看板：一道题错着的人「按错法归堆」（设计稿「课堂看板重设计」A+B）。老师讲错误时
 * 要的是「这道题全班错在哪」：同一种错讲一遍就够，所以按最后一次提交归类，堆名要短，
 * 一眼能读完 —— 长的中文解释在点开之后的弹层里（和提交详情同一份）。
 *
 * 依据是提交里存的 runtime_error / sample_check（判题机写的），和提交详情、题目页结果区同源。
 */
export type BoardLatest = NonNullable<ClassBoardCell["latest"]>

export interface ErrorKind {
  /** 归堆用：同一个 key 是同一种错 */
  key: string
  label: string
  /** 报错指到的行，答案错误没有 */
  line: number | null
}

const DIFF_LABEL: Record<DiffKind, string> = {
  "no-output": "什么都没输出",
  whitespace: "只差空格、换行",
  punctuation: "中英文标点不对",
  case: "大小写不对",
  extra: "多输出了东西",
  missing: "少输出了东西",
  "number-format": "小数位数不对",
  values: "算出来的数不对",
  other: "输出和例子不一样",
}

/** runtime-diagnosis.ts 细分出来的 kind 里常见的几种；没列的按异常类型归 */
const KIND_LABEL: Record<string, string> = {
  "int-parse": "int() 转换失败",
  "float-parse": "float() 转换失败",
  unpack: "拆出来的个数对不上",
  "unpack-number": "一个数拆给好几个变量",
  "str-concat": "文字和数字用 + 连",
  operand: "文字和数字一起算",
  compare: "文字和数字比大小",
  "not-int": "该给整数的地方不是整数",
  "format-spec": "保留小数的格式写错",
  "not-callable": "把不是函数的当函数用",
  "func-value": "函数名后面忘了括号",
  "none-value": "拿 None 接着用",
  "map-value": "map() 的结果没转成列表",
}

const TYPE_LABEL: Record<string, string> = {
  EOFError: "input() 用多了",
  IndexError: "下标越界",
  ZeroDivisionError: "除以 0",
  KeyError: "字典里没有这个键",
  RecursionError: "递归停不下来",
  UnboundLocalError: "变量还没赋值就用",
  ModuleNotFoundError: "导入了没有的模块",
  ImportError: "导入了没有的模块",
  ValueError: "值不符合要求",
  TypeError: "类型不对",
}

/** C / C++ 只有信号：11 段错误、8 除零 */
const SIGNAL_LABEL: Record<number, string> = {
  11: "数组越界或指针出错",
  8: "除以 0",
}

export function errorKind(latest: BoardLatest): ErrorKind {
  const result = latest.result
  if (result === SubmissionStatus.wrong_answer) {
    const check = latest.sampleCheck
    if (!check) return { key: "wa", label: "答案错误", line: null }
    if (check.passed) return { key: "wa-hidden", label: "例子都对，错在没公开的测试点", line: null }
    const diff = classifyDiff(check.expected ?? "", check.output ?? "")
    return { key: `wa-${diff}`, label: DIFF_LABEL[diff], line: null }
  }
  if (result === SubmissionStatus.runtime_error) {
    const rt = latest.runtimeError
    const line = rt?.line ?? null
    if (!rt) return { key: "re", label: "运行时出错", line }
    if (rt.signal && SIGNAL_LABEL[rt.signal]) {
      return { key: `re-signal-${rt.signal}`, label: SIGNAL_LABEL[rt.signal]!, line }
    }
    if (rt.type === "NameError") {
      return rt.name
        ? { key: `re-name-${rt.name}`, label: `「${rt.name}」没有定义`, line }
        : { key: "re-name", label: "用了没定义的名字", line }
    }
    if (rt.kind && KIND_LABEL[rt.kind]) {
      return { key: `re-${rt.kind}`, label: KIND_LABEL[rt.kind]!, line }
    }
    if (rt.type && TYPE_LABEL[rt.type]) {
      return { key: `re-${rt.type}`, label: TYPE_LABEL[rt.type]!, line }
    }
    return { key: "re", label: "运行时出错", line }
  }
  if (result === SubmissionStatus.compile_error) {
    return { key: "ce", label: "编译没通过", line: null }
  }
  return {
    key: `r${result}`,
    label: JUDGE_STATUS[result as keyof typeof JUDGE_STATUS]?.name ?? "没通过",
    line: null,
  }
}

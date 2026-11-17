import type { DataAnalysisRunError } from '@oj2/contract'
import { explainPythonCompileError } from 'utils/pythonError'

/**
 * 「数据分析」运行出错时给学生看的中文。界面上不出现英文（异常名、原文只给老师看）。
 *
 * 运行器回的是 Python 的异常名 + 原文消息（docker/data-analysis/kernel.py 的 error_info），
 * 这里按数据分析课最常见的几种错写说法：列名写错（KeyError）、文件名写错、变量没定义 ……
 * 语法错误走题目页那套编译错误的翻译（utils/pythonError.ts）。
 */

/** 运行器的库白名单，和 docker/data-analysis/requirements.txt 对齐 */
const LIBRARIES = 'pandas、numpy、matplotlib、seaborn、openpyxl、jieba、wordcloud'

function quoted(message: string) {
  // KeyError: '数学' / name 'avg' is not defined / No module named 'xlrd'
  return /['"]([^'"]+)['"]/.exec(message)?.[1] ?? null
}

const BY_TYPE: Record<string, (e: DataAnalysisRunError) => string> = {
  NameError: (e) => {
    const name = quoted(e.message)
    return name ? `用到了还没有的「${name}」：检查名字有没有写错，或者是不是在前面那一步里定义的、那一步还没写对。` : '用到了一个还没有定义的名字。'
  },
  KeyError: (e) => {
    const name = quoted(e.message)
    return name ? `表里没有「${name}」这一列（或这一项）：检查名字和表里的是不是一模一样，有没有多打空格。` : '表里没有你要找的这一列（或这一项）。'
  },
  FileNotFoundError: (e) => {
    const name = quoted(e.message)
    return `找不到文件${name ? `「${name}」` : ''}：文件名要和上面素材里的一模一样，包括 .xlsx 这样的后缀。`
  },
  ModuleNotFoundError: (e) => {
    const name = quoted(e.message)
    return `没有${name ? `「${name}」` : '这个'}库。这里能用的库有：${LIBRARIES}。`
  },
  AttributeError: (e) => {
    const m = /'(\w+)' object has no attribute '(\w+)'/.exec(e.message)
    if (m) return `「${m[1]}」没有「${m[2]}」这个用法：检查拼写，或者看看前面得到的东西是不是你以为的那种（表、一列、数字）。`
    const mod = /module '([\w.]+)' has no attribute '(\w+)'/.exec(e.message)
    if (mod) return `「${mod[1]}」里没有「${mod[2]}」：检查拼写。`
    return '用了一个不存在的用法，检查拼写。'
  },
  TypeError: () => '数据的类型不对：比如拿文字和数字一起算，或者给函数的东西不是它要的那种。',
  ValueError: () => '给的值不合适：比如数据的个数对不上，或者要数字却给了文字。',
  IndexError: () => '位置超出范围了：要的那一行（那一项）不存在。',
  ZeroDivisionError: () => '除数是 0。',
  EOFError: () => '数据分析里没有键盘输入，数据从上面的素材文件里读。',
  MemoryError: () => '用的内存太多了，数据是不是被重复复制了很多遍？',
  RecursionError: () => '函数调用自己太多层了。',
  Timeout: () => '运行太久了，是不是写了停不下来的循环？',
  Crashed: () => '程序意外退出了，多半是用的内存太多。',
}

export interface DataAnalysisErrorExplanation {
  /** 第几步，从 1 数 */
  step: number
  line: number | null
  message: string
}

export function explainDataAnalysisError(error: DataAnalysisRunError, code = ''): DataAnalysisErrorExplanation {
  if (error.type === 'SyntaxError' || error.type === 'IndentationError' || error.type === 'TabError') {
    const compiled = explainPythonCompileError(error.traceback, code)
    return { step: error.step, line: compiled?.line ?? error.line, message: compiled?.message ?? '代码的写法有错，Python 看不懂这一行。' }
  }
  const explain = BY_TYPE[error.type]
  return { step: error.step, line: error.line, message: explain ? explain(error) : '运行出错了。' }
}

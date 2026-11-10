import type { MascotMistakes } from '@oj2/contract'

/**
 * 她指出过的代码错误，给人看的名字（后端给的是台词组的名字 `lint.typo` 这类）。
 * 几组说的是同一种错的合成一条（中文标点一处 / 好几处、变量没定义猜到 / 没猜到、括号多了 / 少了）。
 * 加了新的指错规则（oj/problem/utils/codeLint.ts）要在这里补名字，没补的不显示
 */
const NAMES: Record<string, string> = {
  'problem.chinesePunct': '用了中文标点',
  'problem.chinesePuncts': '用了中文标点',
  'lint.typo': '函数名写错',
  'lint.printf': '在 Python 里写 printf',
  'lint.bareMethod': 'split、append 单独用',
  'lint.inputPrompt': 'input() 里写了提示文字',
  'lint.colon': 'if、for 那行少了冒号',
  'lint.assignInIf': '判断相等只写了一个等号',
  'lint.cOperator': '用了 C 语言的写法',
  'lint.shadowBuiltin': '给 print、input 赋值',
  'lint.elseIf': '把 elif 写成 else if',
  'lint.keywordCase': 'if、for 写成了大写',
  'lint.printStatement': 'print 没加括号',
  'lint.noInt': 'input() 没转成数字就计算',
  'lint.wrongLangC': '语言选错了',
  'lint.wrongLangPython': '语言选错了',
  'lint.noInclude': '没写 #include',
  'lint.undefinedName': '用了没定义的变量',
  'lint.undefinedNameGuess': '用了没定义的变量',
  'lint.noPrint': '忘了写 print',
  'lint.unclosedBracket': '括号没配对',
  'lint.extraBracket': '括号没配对',
  'lint.unclosedQuote': '引号没配对',
}

/** 合并成给人看的清单，次数多的在前 */
export function mistakeList(mistakes: MascotMistakes) {
  const totals = new Map<string, number>()
  for (const it of mistakes) {
    const name = NAMES[it.situation]
    if (name) totals.set(name, (totals.get(name) ?? 0) + it.count)
  }
  return [...totals.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

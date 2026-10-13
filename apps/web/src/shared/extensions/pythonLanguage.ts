import { pythonLanguage } from "@codemirror/lang-python"
import { styleTags, tags as t } from "@lezer/highlight"

/**
 * Python 的解析器在上色上补几处，向 VS Code 看齐。编辑器（extensions/language.ts）和
 * 静态代码（shared/highlight.ts）都用这一份，两边的颜色才一样。
 *
 * - `from` / `as` / `with` 和 `if`、`import` 一样算管流程的词（lezer 把 `from` 和 `def` 归成一类）
 * - f-string 的 `{ }` 和 `:.2f` 一样是格式占位符的颜色
 * - `print` 一律是函数：lezer 把不带括号的 `print`（Python 2 的写法）当关键字，`print"yes"`、
 *   全角括号的 `print（c）` 就变成关键字色，和旁边的 `print(...)` 不一样
 *
 * 单独放一个文件是为了不绕圈：language.ts → codeMarks.ts → highlight.ts 要用到它。
 */
export const ojPythonLanguage = pythonLanguage.configure({
  props: [
    styleTags({
      "from as with": t.controlKeyword,
      "FormatReplacement/{ FormatReplacement/} FormatSpec/:": t.modifier,
      print: t.function(t.variableName),
    }),
  ],
})

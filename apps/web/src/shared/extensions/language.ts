import { cpp } from "@codemirror/lang-cpp"
import { python, pythonLanguage } from "@codemirror/lang-python"
import { sql, SQLite } from "@codemirror/lang-sql"
import { LanguageSupport } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { styleTags, tags as t } from "@lezer/highlight"
import type { LANGUAGE } from "utils/types"
import { formatPlaceholders } from "./formatPlaceholder"

/**
 * Python 的解析器在上色上补几处，向 VS Code 看齐：`from` / `as` / `with` 和 `if`、`import` 一样算管流程
 * 的词（lezer 把 `from` 和 `def` 归成一类）；f-string 的 `{ }` 和 `:.2f` 一样是格式占位符的颜色。
 * 静态代码（shared/highlight.ts）也用这一份，编辑器和题面的颜色才一样。
 */
export const ojPythonLanguage = pythonLanguage.configure({
  props: [
    styleTags({
      "from as with": t.controlKeyword,
      "FormatReplacement/{ FormatReplacement/} FormatSpec/:": t.modifier,
    }),
  ],
})

/**
 * 语言对应的高亮扩展。学生端和教师端共用同一份（两边都是题目页上的 SyncCodeEditor） ——
 * 两边各选各的，就是老师看到的高亮和补全跟学生手里那份对不上。
 *
 * Java / Golang / JavaScript 没有单独的包，落到 cpp()，是既有行为，不是遗漏。
 */
export function languageExtension(language: LANGUAGE): Extension {
  if (language === "SQL") return sql({ dialect: SQLite, upperCaseKeywords: true })
  if (language === "Python") {
    return [new LanguageSupport(ojPythonLanguage, python().support), formatPlaceholders("python")]
  }
  return [cpp(), formatPlaceholders("c")]
}

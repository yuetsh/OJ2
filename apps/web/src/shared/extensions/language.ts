import { cpp } from "@codemirror/lang-cpp"
import { python } from "@codemirror/lang-python"
import { sql, SQLite } from "@codemirror/lang-sql"
import type { Extension } from "@codemirror/state"
import type { LANGUAGE } from "utils/types"

/**
 * 语言对应的高亮扩展。学生端（SyncCodeEditor）和教师端（CollabModal）共用同一份 ——
 * 两边各选各的，就是老师看到的高亮和补全跟学生手里那份对不上。
 *
 * Java / Golang / JavaScript 没有单独的包，落到 cpp()，是既有行为，不是遗漏。
 */
export function languageExtension(language: LANGUAGE): Extension {
  if (language === "SQL") return sql({ dialect: SQLite, upperCaseKeywords: true })
  return ["Python2", "Python3"].includes(language) ? python() : cpp()
}

import { z } from "zod"

/**
 * 判题沙箱认得的语言。**这是全仓唯一的语言集合定义处。**
 *
 * 键名必须与 `apps/api/src/judge/languages.ts` 的 `languageConfigs` 一致 ——
 * 沙箱的编译/运行命令按这些键查表，查不到就是 `Unsupported judge language`。
 * 后端那边是 `Record<string, …>`（判题机要按名字取配置，不能窄化成联合），
 * 所以这个联合是**手写**的，改 languages.ts 时两边一起改。
 *
 * 这 6 种是**现在还能提交**的语言。含历史值 `Python2`：判题机已经没有它的
 * 编译配置了，但生产库里有 3 条当年用 Python2 提交的记录，提交列表要能渲染出来。
 */
export const judgeLanguageSchema = z.enum([
  "Python2",
  "Python3",
  "C",
  "C++",
  "Java",
  "JavaScript",
  "Golang",
])

/**
 * 题目可以挂的语言 = 沙箱语言 + 两种非沙箱题型。
 *
 * - `SQL` 走 `judge/sql/` 那条独立链路（子进程 + sql.js），不经过沙箱；
 * - `Flowchart` 走 AI 评分（flowchart/run.ts），也不经过沙箱。
 *
 * **两者都是真实可选、真实有历史数据的**，不是预留值：生产库 961 道题里有
 * 9 道 SQL 题、124191 条提交里有 91 条 SQL。前端原来手抄的语言联合漏了 SQL，
 * 于是那 91 条提交的 `language` 在类型上是 `undefined` —— 这就是两份真相
 * 各自演进的代价，现在并成一份。
 */
export const problemLanguageSchema = z.enum([
  ...judgeLanguageSchema.options,
  "SQL",
  "Flowchart",
])

/** 沙箱语言组成的数组（顺序即提权顺序，前端用它排语言 tab） */
export const JUDGE_LANGUAGES = judgeLanguageSchema.options

export type JudgeLanguage = z.infer<typeof judgeLanguageSchema>
export type ProblemLanguage = z.infer<typeof problemLanguageSchema>

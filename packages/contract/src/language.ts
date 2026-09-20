import { z } from "zod"

/**
 * 判题沙箱认得的语言。**这是全仓唯一的语言集合定义处。**
 *
 * 键名必须与 `apps/api/src/judge/languages.ts` 的 `languageConfigs` 一致 ——
 * 沙箱的编译/运行命令按这些键查表，查不到就是 `Unsupported judge language`。
 * 后端那边是 `Record<string, …>`（判题机要按名字取配置，不能窄化成联合），
 * 所以这个联合是**手写**的，改 languages.ts 时两边一起改。
 *
 * **这里列的是历史上出现过的值，不等于现在能提交的语言。** 现在判题沙箱只认
 * `C` / `C++` / `Python`（`languages.ts` 里就这三块），前端的语言复选框也只给这三个
 * 加 SQL。`Java`(44 条) / `Golang`(15) / `JavaScript`(3) 是历史值：判题机没有它们的
 * 编译配置、镜像里也没有工具链了，但生产库里有这些提交记录，提交列表要能渲染出来，
 * 所以键必须留着。
 *
 * Java / JavaScript / Golang 是 2026-09 随判题镜像升级一起下掉的，理由见
 * `apps/api/src/judge/languages.ts` 顶部。
 *
 * `Python2` / `Python3` 这两个旧值**已经不在这里了** —— 0019 迁移把库里的
 * 104530 条提交、937 道题、1235 个用户的成就指标全并成了 `Python`。万一还有旧值
 * 从别处冒出来（旧客户端的 localStorage、迁移之前排进队列的任务），走下面的
 * `normalizeLanguage()`，别直接 parse。
 */
export const judgeLanguageSchema = z.enum([
  "C",
  "C++",
  "Python",
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

export type JudgeLanguage = z.infer<typeof judgeLanguageSchema>
export type ProblemLanguage = z.infer<typeof problemLanguageSchema>

/**
 * 旧语言名 → 现在的值。**库里已经没有旧值了**（0019 迁移清干净并核对过），
 * 这张表挡的是数据之外的三条路：
 *
 * 1. 学生浏览器 localStorage 里存着上次选的 `Python3`（上线那一刻还在那儿）；
 * 2. 迁移之前就排进 BullMQ 的判题任务；
 * 3. 万一要回滚 —— 旧版后端读 `Python` 会查不到配置，所以**回滚必须连数据一起回**，
 *    别只滚代码。
 */
const LANGUAGE_ALIASES: Record<string, ProblemLanguage> = {
  Python2: "Python",
  Python3: "Python",
}

/** 把可能是旧值的语言名归一化；认不出来返回 null，由调用方决定怎么兜底。 */
export function normalizeLanguage(value: unknown): ProblemLanguage | null {
  if (typeof value !== "string") return null
  const parsed = problemLanguageSchema.safeParse(
    LANGUAGE_ALIASES[value] ?? value,
  )
  return parsed.success ? parsed.data : null
}

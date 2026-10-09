/**
 * 题目的代码模板在库里是带标记的一整段：
 *
 *   //PREPEND BEGIN … //PREPEND END   藏在学生代码前面一起运行（学生看不到）
 *   //TEMPLATE BEGIN … //TEMPLATE END 学生打开编辑器时里面已经有的代码
 *   //APPEND BEGIN … //APPEND END     藏在后面
 *
 * 出题页只让老师写三段内容，标记在这里拼。解析和后端 judge/template.ts 同一个正则 ——
 * 段落内容非空时必须以换行结尾（`([\s\S]+?)//X END` 的口径），拼的时候补上。
 */
export interface TemplateParts {
  prepend: string
  template: string
  append: string
}

const section = (raw: string, name: string) =>
  raw.match(new RegExp(`//${name} BEGIN\\n([\\s\\S]+?)//${name} END`))?.[1] ?? ""

/** 段落末尾那个换行是标记格式要的，不是内容，显示时去掉 */
const strip = (text: string) => text.replace(/\n$/, "")

export function parseTemplate(raw: string | undefined): TemplateParts {
  if (!raw) return { prepend: "", template: "", append: "" }
  return {
    prepend: strip(section(raw, "PREPEND")),
    template: strip(section(raw, "TEMPLATE")),
    append: strip(section(raw, "APPEND")),
  }
}

export function isBlankTemplate(parts: TemplateParts) {
  return !parts.prepend.trim() && !parts.template.trim() && !parts.append.trim()
}

/** 三段都空就不存（返回 null），学生打开时用全站默认的 */
export function buildTemplate(parts: TemplateParts): string | null {
  if (isBlankTemplate(parts)) return null
  return [
    `//PREPEND BEGIN\n${body(parts.prepend)}//PREPEND END`,
    `//TEMPLATE BEGIN\n${body(parts.template)}//TEMPLATE END`,
    `//APPEND BEGIN\n${body(parts.append)}//APPEND END`,
  ].join("\n\n")
}

/** 跑标准答案时套上前后两段，和判题时（routes/trial-run.ts、judgeSubmission）一个拼法 */
export function wrapWithTemplate(code: string, parts: TemplateParts) {
  if (!parts.prepend.trim() && !parts.append.trim()) return code
  return `${body(parts.prepend)}\n${code}\n${body(parts.append)}`
}

/** 一段内容：非空时统一以一个换行结尾 */
function body(text: string) {
  return text.trim() ? `${text.replace(/\n*$/, "")}\n` : ""
}

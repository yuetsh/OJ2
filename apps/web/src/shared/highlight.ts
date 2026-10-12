/**
 * 代码高亮：自学的练一练、以及 Markdown.vue 里的代码块共用这一份（配色在 highlight.css）。
 * 只注册判题机认的几种语言，别的语言和不标语言的代码块按原文显示。
 */
import hljs from "highlight.js/lib/core"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import python from "highlight.js/lib/languages/python"
import sql from "highlight.js/lib/languages/sql"

hljs.registerLanguage("python", python)
hljs.registerLanguage("c", c)
hljs.registerLanguage("cpp", cpp)
hljs.registerLanguage("sql", sql)

const LANGUAGE_ALIASES: Record<string, string> = {
  python: "python",
  py: "python",
  python3: "python",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  sql: "sql",
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function normalizeLang(lang?: string): string | null {
  return LANGUAGE_ALIASES[lang?.toLowerCase() ?? ""] ?? null
}

// 把整段代码高亮为 HTML；不支持的语言或异常时回退为转义文本
export function highlight(code: string, lang?: string): string {
  const language = normalizeLang(lang)
  if (language) {
    try {
      return hljs.highlight(code, { language }).value
    } catch {
      // fall through
    }
  }
  return escapeHtml(code)
}

// 按行高亮：整体高亮后再按行切分，保证跨行 token 着色正确，返回逐行 HTML 数组
export function highlightLines(lines: string[], lang?: string): string[] {
  const language = normalizeLang(lang)
  if (language) {
    try {
      const html = hljs.highlight(lines.join("\n"), { language }).value
      return html.split("\n")
    } catch {
      // fall through
    }
  }
  return lines.map((line) => escapeHtml(line))
}

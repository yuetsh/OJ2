/**
 * 代码高亮：全站一套。编辑器（CodeMirror）和静态的代码（Markdown.vue 的代码块、自学的练一练、
 * App.vue 交给 n-code 的提交代码）都用同一个解析器（lezer）、同一张类名表，同一段代码在哪儿颜色都一样。
 * 颜色在 highlight.css。
 *
 * 原来静态代码走 highlight.js，它和编辑器的分词不一样（`int` 一边是类型一边是基本类型，
 * `printf(` 一边是内置函数一边是函数调用），配色表写得再一致，染出来也对不上。
 *
 * 只认判题机认的几种语言，别的语言和不标语言的代码块按原文显示。
 */
import { cppLanguage } from "@codemirror/lang-cpp"
import { pythonLanguage } from "@codemirror/lang-python"
import { SQLite } from "@codemirror/lang-sql"
import { highlightCode, tagHighlighter, tags as t } from "@lezer/highlight"
import type { ConfigProviderProps } from "naive-ui"

/** 词的种类 → 类名。编辑器在 shared/themes/codeTheme.ts 里挂的也是它 */
export const codeHighlighter = tagHighlighter([
  // `int` 这类基本类型和关键字一个颜色，自定义的类型（struct 名）才是类型色
  {
    tag: [
      t.keyword,
      t.modifier,
      t.operator,
      t.processingInstruction,
      t.escape,
      t.standard(t.typeName),
    ],
    class: "tok-keyword",
  },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "tok-function" },
  { tag: t.string, class: "tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom, t.self], class: "tok-number" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.name)], class: "tok-type" },
  { tag: t.comment, class: "tok-comment" },
  { tag: t.invalid, class: "tok-invalid" },
  { tag: t.heading, class: "tok-heading" },
  { tag: t.strong, class: "tok-strong" },
  { tag: t.emphasis, class: "tok-emphasis" },
  { tag: [t.link, t.url], class: "tok-link" },
  { tag: t.monospace, class: "tok-monospace" },
  { tag: t.quote, class: "tok-quote" },
  { tag: t.strikethrough, class: "tok-strikethrough" },
])

type Parser = typeof cppLanguage.parser

// C 和编辑器一样用 C++ 的解析器
const PARSERS: Record<string, Parser> = {
  python: pythonLanguage.parser,
  py: pythonLanguage.parser,
  python3: pythonLanguage.parser,
  c: cppLanguage.parser,
  cpp: cppLanguage.parser,
  "c++": cppLanguage.parser,
  sql: SQLite.language.parser,
}

function parserFor(lang?: string): Parser | null {
  return PARSERS[lang?.toLowerCase() ?? ""] ?? null
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function span(text: string, classes: string): string {
  const html = escapeHtml(text)
  return classes ? `<span class="${classes}">${html}</span>` : html
}

/** 按顺序吐出每一段文字和它的类名，换行单独吐一个 "\n"。跨行的词（块注释、三引号字符串）在换行处断开 */
function walk(
  code: string,
  lang: string | undefined,
  put: (text: string, classes: string) => void,
) {
  const parser = parserFor(lang)
  if (!parser) {
    put(code, "")
    return
  }
  highlightCode(code, parser.parse(code), codeHighlighter, put, () => put("\n", ""))
}

/** 逐行高亮，返回每行的 HTML，每行的标签自己闭合 */
function toLines(code: string, lang?: string): string[] {
  const lines = [""]
  walk(code, lang, (text, classes) => {
    text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push("")
      lines[lines.length - 1] += span(part, classes)
    })
  })
  return lines
}

/** 把整段代码高亮为 HTML；不支持的语言按转义后的原文 */
export function highlight(code: string, lang?: string): string {
  return toLines(code, lang).join("\n")
}

/** 按行高亮：整段一起解析再切行，跨行的词也能染对 */
export function highlightLines(lines: string[], lang?: string): string[] {
  return toLines(lines.join("\n"), lang)
}

/**
 * 填空题用：代码按「空里已经填上答案」的样子解析，但答案不输出，每个空的位置吐一个空的序号。
 * 直接拿挖了空的代码去解析不行：语法被空搅乱，`(humidity ____ 40)` 会被认成类型声明，
 * humidity 染成类型的颜色。holes 按位置从前往后排、互不重叠。
 */
export function highlightWithHoles(
  code: string,
  holes: { from: number; to: number }[],
  lang?: string,
): (string | number)[] {
  const out: (string | number)[] = []
  let html = ""
  let pos = 0
  let hole = 0
  const flush = () => {
    if (html) out.push(html)
    html = ""
  }
  walk(code, lang, (text, classes) => {
    const end = pos + text.length
    let at = pos
    while (at < end) {
      const h = holes[hole]
      if (h && at >= h.from) {
        if (at === h.from) {
          flush()
          out.push(hole)
        }
        at = Math.min(end, h.to)
        if (at === h.to) hole++
        continue
      }
      const stop = h ? Math.min(end, h.from) : end
      html += span(text.slice(at - pos, stop - pos), classes)
      at = stop
    }
    pos = end
  })
  flush()
  // 落在代码末尾、长度为 0 的空
  for (; hole < holes.length; hole++) out.push(hole)
  return out
}

/**
 * 给 n-code 的：它只认 highlight.js 的接口。类型照 highlight.js 写（结果里还要 relevance 之类），
 * 但 n-code 只调 getLanguage() 和读 highlight().value，所以只给这两样
 */
export const hljs = {
  getLanguage: (lang: string) => (parserFor(lang) ? {} : undefined),
  highlight: (code: string, { language }: { language: string }) => ({
    value: highlight(code, language),
  }),
} as unknown as NonNullable<ConfigProviderProps["hljs"]>

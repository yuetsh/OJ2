/**
 * Markdown / HTML 正文渲染，配 shared/components/Markdown.vue 用。
 *
 * 原来用 md-editor-v3 的 MdPreview：不管正文里有没有代码、公式，每次打开都去 unpkg.com
 * 拉 highlight.js、katex、mermaid、echarts（实测，6.x 起就这样），机房网络下慢且不稳；
 * 而我们只用到最基础的 Markdown —— 题面 95% 是富文本编辑器存的 HTML，教程是标题、表格、
 * 图片，AI 的输出是标题、列表、表格、少量代码块，库里一处公式、mermaid 都没有。
 * 现在直接用 markdown-it（md-editor 内部也是它），代码高亮走本地的 shared/highlight.ts。
 *
 * 两档信任：
 * - 题面、教程是老师写的，原生 HTML 必须放行（富文本存的就是 HTML），原来 md-editor 也是放行的；
 * - AI 生成的东西不放行。学生能在代码里夹带指令，诱导 AI 吐出 <img onerror> 一类的 HTML，
 *   老师在后台一打开就执行。库里 1196 条 AI 输出一个 HTML 标签都没有，关掉不影响显示。
 */
import MarkdownIt from "markdown-it"
import { highlight } from "./highlight"

function create(html: boolean) {
  return new MarkdownIt({
    html,
    // 和 md-editor 的默认值一致：单个换行就换行、裸网址变链接
    breaks: true,
    linkify: true,
    highlight: (code, lang) => highlight(code, lang),
  })
}

let trusted: MarkdownIt | null = null
let untrusted: MarkdownIt | null = null

export function renderMarkdown(content: string, allowHtml: boolean): string {
  if (allowHtml) return (trusted ??= create(true)).render(content)
  return (untrusted ??= create(false)).render(content)
}

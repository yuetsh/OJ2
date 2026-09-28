/**
 * 把题面里的一段 Markdown 摊成一行纯文字，放进结果页签里那种「题目原话：……」的小字里。
 * 不是完整的 Markdown 解析：题面用到的就是强调、行内代码、链接、图片、标题、列表、
 * 公式这几样，去掉记号、留下字就够了。太长的截断，免得一句提示撑满半屏。
 */
export function markdownToText(markdown: string, max = 120) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\$\$?([^$]*)\$\$?/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
  // 题面是富文本编辑器存的 HTML：标签去掉之后还剩 &quot; &nbsp; 这些实体，得换回字
  const decoded = decodeEntities(text).replace(/\s+/g, " ").trim()
  return decoded.length > max ? `${decoded.slice(0, max)}…` : decoded
}

/** 走浏览器自己的 HTML 解析，标签在前面已经去掉了，这里只剩实体 */
function decodeEntities(text: string) {
  if (!text.includes("&")) return text
  return new DOMParser().parseFromString(text, "text/html").documentElement.textContent ?? text
}

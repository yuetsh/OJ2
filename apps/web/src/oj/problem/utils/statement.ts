/**
 * 题面正文（描述 / 输入 / 输出 / 提示）在渲染前去掉空段落。
 *
 * 库里的题面多是 wangEditor 时代的 HTML，老师为了「隔开一点」敲的空行存成
 * `<p><br></p>`、`<p>&nbsp;</p>`，每个都撑出一整行高的缝（2020 一道题就有两处）。
 * 段落之间的间距题面自己会给，这些空段落一律去掉。只动「整段什么字都没有」的，
 * 段落里带图片、带字的都不碰。
 */
const EMPTY_PARAGRAPH = /<p(?:\s[^>]*)?>(?:\s|&nbsp;|&#160;| |<br\s*\/?>)*<\/p>/gi

export function tidyStatement(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(EMPTY_PARAGRAPH, '')
}

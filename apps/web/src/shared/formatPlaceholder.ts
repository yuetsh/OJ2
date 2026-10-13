/**
 * 字符串里的格式占位符：printf 的 %d、%.2f、%%，Python 的 "%d 个" % n。
 * lezer 把整个字符串当一个词，不分出占位符，所以另外扫一遍。静态代码在 shared/highlight.ts 里拆，
 * 编辑器在 shared/extensions/formatPlaceholder.ts 里挂装饰，两边用这一份正则。
 *
 * 正则和颜色照 VS Code 的语法文件：C 是 constant.other.placeholder（变量色），
 * Python 是 constant.character.format.placeholder（关键字色），所以两种语言类名不同。
 */
export type FormatFamily = "c" | "python"

const PATTERNS: Record<FormatFamily, RegExp> = {
  c: /%(\d+\$)?[#0\- +']*(-?\d+|\*)?(\.(-?\d+|\*)?)?(hh|h|ll|l|j|t|z|L)?[diouxXeEfFgGaAcspn%]/g,
  python: /%(\([\w\s]*\))?[-+#0 ]*(\d+|\*)?(\.(\d+|\*))?[hlL]?[diouxXeEfFgGcrsa%]/g,
}

export const FORMAT_CLASS: Record<FormatFamily, string> = {
  c: "tok-format",
  python: "tok-format-py",
}

/** 字符串里每个占位符的位置（相对 text 开头） */
export function formatSpans(text: string, family: FormatFamily): { from: number; to: number }[] {
  return [...text.matchAll(PATTERNS[family])].map((m) => ({
    from: m.index,
    to: m.index + m[0].length,
  }))
}

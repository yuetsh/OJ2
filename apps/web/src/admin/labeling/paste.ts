import type { LabelingKind, LabelingSpan } from '@oj2/contract'

/**
 * 出题页的批量粘贴（设计文档第 5 节、3.5 节第 3 条）。每行一条：
 * - 文字分类：`文字 ⇥ 标签 ⇥ 理由`，理由可省；
 * - 实体标注：`[李白](人名)出生在[碎叶城](地名) ⇥ 理由`，理由可省。
 * 分隔符同时认 Tab、`|`、全角 `｜`：老师多半在 Excel / WPS 里整理好再复制，粘过来是 Tab。
 * 不对的行逐行报出来，对的照加。
 */

export interface PastedItem {
  text: string
  answer: string | null
  spans: LabelingSpan[]
  reason: string
}

export interface PasteResult {
  items: PastedItem[]
  errors: string[]
}

function splitLine(line: string) {
  const parts = line.includes('\t') ? line.split('\t') : line.split(/[|｜]/)
  return parts.map((p) => p.trim())
}

/** 把 `[李白](人名)…` 拆成纯文字和段（按字数，和契约 LabelingSpan 一样） */
export function parseMarkup(source: string, labels: string[]): { text: string; spans: LabelingSpan[] } | string {
  const chars = Array.from(source)
  const out: string[] = []
  const spans: LabelingSpan[] = []
  let i = 0
  while (i < chars.length) {
    if (chars[i] !== '[') {
      out.push(chars[i]!)
      i++
      continue
    }
    const close = chars.indexOf(']', i + 1)
    if (close < 0) return `「${chars.slice(i, i + 8).join('')}」少了一个 ]`
    if (chars[close + 1] !== '(' && chars[close + 1] !== '（') return `「${chars.slice(i, close + 1).join('')}」后面要跟着 (类别)`
    let end = close + 2
    while (end < chars.length && chars[end] !== ')' && chars[end] !== '）') end++
    if (end >= chars.length) return `「${chars.slice(i, close + 2).join('')}」少了一个 )`
    const words = chars.slice(i + 1, close).join('')
    const label = chars
      .slice(close + 2, end)
      .join('')
      .trim()
    if (!words) return '有一对 [] 里是空的'
    if (words.includes('[')) return `「${words}」里多了一个 [`
    if (!labels.includes(label)) return `「${label}」不是这一节的类别`
    const start = out.length
    out.push(...Array.from(words))
    spans.push({ start, end: out.length, label })
    i = end + 1
  }
  return { text: out.join(''), spans }
}

export function parsePaste(kind: LabelingKind, source: string, labels: string[]): PasteResult {
  const items: PastedItem[] = []
  const errors: string[] = []
  source.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return
    const where = `第 ${index + 1} 行`
    const parts = splitLine(raw)
    if (kind === 'span') {
      const parsed = parseMarkup(parts[0] ?? '', labels)
      if (typeof parsed === 'string') return errors.push(`${where}没加：${parsed}`)
      if (!parsed.text.trim()) return errors.push(`${where}没加：是空的`)
      items.push({ text: parsed.text, answer: null, spans: parsed.spans, reason: parts.slice(1).join(' ').trim() })
      return
    }
    const [text = '', label = '', ...rest] = parts
    if (!text) return errors.push(`${where}没加：文字是空的`)
    if (!label) return errors.push(`${where}没加：没写标签`)
    if (!labels.includes(label)) return errors.push(`${where}没加：「${label}」不是这节的标签`)
    items.push({ text, answer: label, spans: [], reason: rest.join(' ').trim() })
  })
  return { items, errors }
}

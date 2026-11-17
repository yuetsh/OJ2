/**
 * 实体标注每个类别一种颜色（按类别在这一节里的序号取）。底色在明暗两套主题上分开给，
 * 文字跟主题走；颜色之间深浅也拉开，再加上每段左下角的小字类别名，不靠颜色也分得出（设计稿 LabelSpanStudent）。
 */
const LIGHT = [
  { bg: '#d6e6ff', fg: '#123d7a', tag: '#1d4f9e', swatch: '#6c9be8' },
  { bg: '#ffe2b8', fg: '#5e3300', tag: '#8a4b00', swatch: '#f0a64a' },
  { bg: '#e6dcf7', fg: '#3d2470', tag: '#5b3a9e', swatch: '#9b7fd1' },
  { bg: '#d3f0dc', fg: '#0d4a26', tag: '#17693a', swatch: '#4fb878' },
  { bg: '#fbd5dc', fg: '#6e1526', tag: '#9b2338', swatch: '#e2687e' },
  { bg: '#d4eef0', fg: '#0d4448', tag: '#166a70', swatch: '#4bb3ba' },
]

const DARK = [
  { bg: '#23406b', fg: '#dbe8ff', tag: '#9cc0ff', swatch: '#6c9be8' },
  { bg: '#5a3a10', fg: '#ffe7c4', tag: '#ffc27a', swatch: '#f0a64a' },
  { bg: '#3e2f63', fg: '#ece3fb', tag: '#c5aef0', swatch: '#9b7fd1' },
  { bg: '#1d4a2d', fg: '#d6f3e0', tag: '#86d9a3', swatch: '#4fb878' },
  { bg: '#5c2230', fg: '#fbdde3', tag: '#f2a0b0', swatch: '#e2687e' },
  { bg: '#1c4649', fg: '#d6f1f3', tag: '#86d4da', swatch: '#4bb3ba' },
]

export function labelColor(labels: string[], label: string, dark: boolean) {
  const index = Math.max(0, labels.indexOf(label))
  return (dark ? DARK : LIGHT)[index % LIGHT.length]!
}

/**
 * 实体标注的标题里出现了类别名（「标出人名和地名」），就把那几个字铺上对应的颜色，学生一眼知道哪个颜色是哪一类。
 * 按字面找，长的类别名先匹配（「地名」和「外国地名」都在时不会只铺半截）。`missing`：有类别标题里没写到。
 */
export function titlePieces(title: string, labels: string[]) {
  const names = labels.filter(Boolean).sort((a, b) => b.length - a.length)
  const pieces: { text: string; label: string | null }[] = []
  const seen = new Set<string>()
  let plain = ''
  let at = 0
  while (at < title.length) {
    const hit = names.find((name) => title.startsWith(name, at))
    if (hit) {
      if (plain) pieces.push({ text: plain, label: null })
      plain = ''
      pieces.push({ text: hit, label: hit })
      seen.add(hit)
      at += hit.length
    } else {
      plain += title[at]
      at += 1
    }
  }
  if (plain) pieces.push({ text: plain, label: null })
  return { pieces, missing: labels.some((label) => !seen.has(label)) }
}

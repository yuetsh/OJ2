import { PLACEHOLDER, type LaidNode } from './layout'

/**
 * 框的颜色和形状：画流程图的画布（index.vue）和只看的图（FlowchartView.vue）共用一份，
 * 两边才长得一样。题面里的 Mermaid 图在 useMermaid.ts 另有一份，改颜色两边一起改。
 *
 * 输入 / 输出 / 处理 / 判断 / 循环各一种颜色；绿和红不给框用 —— 绿是起止框和选中，红是标错
 */

type Paint = { fill: string; stroke: string; text: string }

const LIGHT: Record<string, Paint> = {
  terminal: { fill: '#eef8f2', stroke: '#18a058', text: '#0c6b3b' },
  input: { fill: '#eef4fd', stroke: '#2f6bc4', text: '#1d4f9c' },
  output: { fill: '#f4effc', stroke: '#8a55c9', text: '#5d2f99' },
  process: { fill: '#ffffff', stroke: '#7d828a', text: '#1f2225' },
  if: { fill: '#fdf5e6', stroke: '#d08a1c', text: '#8a5200' },
  while: { fill: '#e8f6f8', stroke: '#1590a6', text: '#0b5e6e' },
}
const DARK: Record<string, Paint> = {
  terminal: { fill: 'rgba(24,160,88,0.16)', stroke: '#3fbf7f', text: '#8fe0b4' },
  input: { fill: 'rgba(70,130,220,0.18)', stroke: '#5b8fdc', text: '#a9c6f2' },
  output: { fill: 'rgba(150,100,215,0.2)', stroke: '#a57ee0', text: '#d2bcf4' },
  process: { fill: '#26272b', stroke: '#8a8f98', text: '#e6e7ea' },
  if: { fill: 'rgba(208,138,28,0.18)', stroke: '#e0a040', text: '#f2cd8c' },
  while: { fill: 'rgba(30,160,185,0.18)', stroke: '#3cb4c8', text: '#9edce6' },
}

export function useFlowPaint() {
  const isDark = useDark()
  function paint(kind: LaidNode['kind']) {
    const paints = isDark.value ? DARK : LIGHT
    if (kind === 'start' || kind === 'end') return paints.terminal!
    return paints[kind] ?? paints.process!
  }
  const lineColor = computed(() => (isDark.value ? '#8a8f98' : '#7d828a'))
  return { isDark, paint, lineColor }
}

/** 判断、循环是菱形，输入输出是平行四边形（处理、起止是 rect，不走这里） */
export function shapePoints(node: LaidNode) {
  const { x, y, w, h } = node
  if (node.kind === 'if' || node.kind === 'while') return `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`
  const s = 10
  return `${x + s},${y} ${x + w},${y} ${x + w - s},${y + h} ${x},${y + h}`
}

export function nodeLabel(node: LaidNode) {
  if (node.kind === 'start' || node.kind === 'end') return node.text
  return node.text.trim() || PLACEHOLDER[node.kind]
}

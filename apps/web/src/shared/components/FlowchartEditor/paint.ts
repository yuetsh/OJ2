import { PLACEHOLDER, type LaidNode } from "./layout"

/**
 * 框的颜色和形状：画流程图的画布（index.vue）和只看的图（FlowchartView.vue）共用一份，
 * 两边才长得一样
 */

type Paint = { fill: string; stroke: string; text: string }

const LIGHT: Record<string, Paint> = {
  terminal: { fill: "#eef8f2", stroke: "#18a058", text: "#0c6b3b" },
  io: { fill: "#eef4fd", stroke: "#2f6bc4", text: "#1d4f9c" },
  process: { fill: "#ffffff", stroke: "#7d828a", text: "#1f2225" },
  decision: { fill: "#fdf5e6", stroke: "#d08a1c", text: "#8a5200" },
}
const DARK: Record<string, Paint> = {
  terminal: { fill: "rgba(24,160,88,0.16)", stroke: "#3fbf7f", text: "#8fe0b4" },
  io: { fill: "rgba(70,130,220,0.18)", stroke: "#5b8fdc", text: "#a9c6f2" },
  process: { fill: "#26272b", stroke: "#8a8f98", text: "#e6e7ea" },
  decision: { fill: "rgba(208,138,28,0.18)", stroke: "#e0a040", text: "#f2cd8c" },
}

export function useFlowPaint() {
  const isDark = useDark()
  function paint(kind: LaidNode["kind"]) {
    const paints = isDark.value ? DARK : LIGHT
    if (kind === "start" || kind === "end") return paints.terminal!
    if (kind === "input" || kind === "output") return paints.io!
    if (kind === "if" || kind === "while") return paints.decision!
    return paints.process!
  }
  const lineColor = computed(() => (isDark.value ? "#8a8f98" : "#7d828a"))
  return { isDark, paint, lineColor }
}

/** 判断、循环是菱形，输入输出是平行四边形（处理、起止是 rect，不走这里） */
export function shapePoints(node: LaidNode) {
  const { x, y, w, h } = node
  if (node.kind === "if" || node.kind === "while")
    return `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`
  const s = 10
  return `${x + s},${y} ${x + w},${y} ${x + w - s},${y + h} ${x},${y + h}`
}

export function nodeLabel(node: LaidNode) {
  if (node.kind === "start" || node.kind === "end") return node.text
  return node.text.trim() || PLACEHOLDER[node.kind]
}

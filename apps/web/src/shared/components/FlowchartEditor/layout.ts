import {
  END_ID,
  START_ID,
  type Branch,
  type FlowDoc,
  type FlowStep,
  type Slot,
  type StepKind,
} from "./model"

/**
 * 结构树 → 坐标。纯函数，每次改动整张重排（13 个框的图不到一毫秒）。
 *
 * 排法照教科书上的流程图：主线竖着往下；判断的「是」往左、「否」往右，从菱形的两个角
 * 横着出去再往下，两路走完合回中线；循环的条件成立往下走循环体，走完从左边绕回菱形，
 * 不成立从右边出去绕到下面。每一段竖线上留一个 +（插一步的地方）。
 *
 * 画布稿（画布「画流程图重设计」页 FlowEdB）是用同一套排法的 Python 版画的，两边的
 * 常量对得上。
 */

export type NodeKind = StepKind | "start" | "end"

export interface LaidNode {
  id: string
  kind: NodeKind
  text: string
  /** 左上角 */
  x: number
  y: number
  w: number
  h: number
}

export interface LaidSlot {
  key: string
  slot: Slot
  x: number
  y: number
}

export interface LaidLabel {
  x: number
  y: number
  text: string
  anchor: "start" | "end"
}

export interface Layout {
  nodes: LaidNode[]
  /** 带箭头的线、不带箭头的线（合流那几段） */
  arrows: string[]
  lines: string[]
  dots: { x: number; y: number }[]
  labels: LaidLabel[]
  slots: LaidSlot[]
  width: number
  height: number
}

const H = 32
const DH = 40
/** 两步之间的竖线长度，中间放 + */
const G = 30
/** 判断左右两支之间至少空这么多 */
const HG = 32
const PAD = 28

export const PLACEHOLDER: Record<StepKind, string> = {
  input: "输入什么",
  output: "输出什么",
  process: "做什么",
  if: "条件",
  while: "条件",
}

type Measure = (text: string) => number

type Item = FlowStep | { kind: "start" | "end"; id: string; text: string }

interface Extent {
  L: number
  R: number
  h: number
}

export function layoutDoc(doc: FlowDoc, measure: Measure): Layout {
  const shown = (step: Item) =>
    step.text.trim() || (step.kind in PLACEHOLDER ? PLACEHOLDER[step.kind as StepKind] : "")

  const nodeW = (step: Item) => {
    const t = measure(shown(step))
    if (step.kind === "if" || step.kind === "while") return Math.max(t + 64, 104)
    if (step.kind === "input" || step.kind === "output") return Math.max(t + 44, 100)
    if (step.kind === "start" || step.kind === "end") return Math.max(t + 40, 80)
    return Math.max(t + 32, 92)
  }

  const extentCache = new Map<Item, Extent>()

  const measureBlock = (items: Item[]): Extent => {
    let L = 0
    let R = 0
    let h = 0
    items.forEach((item, i) => {
      const e = measureItem(item)
      L = Math.max(L, e.L)
      R = Math.max(R, e.R)
      h += e.h + (i ? G : 0)
    })
    return { L, R, h }
  }

  const ifGeom = (step: Extract<FlowStep, { kind: "if" }>) => {
    const dw = nodeW(step)
    const yes = measureBlock(step.yes)
    const no = measureBlock(step.no)
    const lx = step.yes.length ? Math.min(-dw / 2 - 16, -HG / 2 - yes.R) : -dw / 2 - 16
    const rx = step.no.length ? Math.max(dw / 2 + 16, HG / 2 + no.L) : dw / 2 + 16
    const bh = Math.max(yes.h, no.h, 24)
    return { dw, yes, no, lx, rx, bh }
  }

  const measureItem = (item: Item): Extent => {
    const cached = extentCache.get(item)
    if (cached) return cached
    let e: Extent
    if (item.kind === "if") {
      const { dw, yes, no, lx, rx, bh } = ifGeom(item)
      e = {
        L: Math.max(dw / 2, -lx + yes.L),
        R: Math.max(dw / 2, rx + no.R),
        h: DH + 24 + bh + 22,
      }
    } else if (item.kind === "while") {
      const dw = nodeW(item)
      const body = measureBlock(item.body)
      e = {
        L: Math.max(dw / 2, body.L) + 28,
        R: Math.max(dw / 2, body.R) + 28,
        h: DH + G + Math.max(body.h, 8) + 20 + 20,
      }
    } else {
      const w = nodeW(item)
      e = { L: w / 2, R: w / 2, h: H }
    }
    extentCache.set(item, e)
    return e
  }

  const out: Layout = {
    nodes: [],
    arrows: [],
    lines: [],
    dots: [],
    labels: [],
    slots: [],
    width: 0,
    height: 0,
  }
  const pathOf = (pts: [number, number][]) =>
    "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")
  const arrow = (pts: [number, number][]) => out.arrows.push(pathOf(pts))
  const line = (pts: [number, number][]) => out.lines.push(pathOf(pts))
  const slot = (parent: string | null, branch: Branch, index: number, x: number, y: number) =>
    out.slots.push({
      key: `${parent ?? "main"}:${branch}:${index}`,
      slot: { parent, branch, index },
      x,
      y,
    })

  const place = (item: Item, cx: number, y: number) => {
    const w = nodeW(item)
    const h = item.kind === "if" || item.kind === "while" ? DH : H
    out.nodes.push({ id: item.id, kind: item.kind, text: item.text, x: cx - w / 2, y, w, h })
  }

  /**
   * 竖着排一串。main：两头是开始 / 结束，第 j 个缝对应 steps 的第 j-1 个位置；
   * 分支：第 i 个缝就是第 i 个位置（头尾的 + 由判断 / 循环自己放）
   */
  const drawBlock = (
    items: Item[],
    cx: number,
    y: number,
    parent: string | null,
    branch: Branch,
  ): number => {
    const offset = branch === "main" ? -1 : 0
    items.forEach((item, i) => {
      if (i) {
        arrow([
          [cx, y - G],
          [cx, y - 1],
        ])
        slot(parent, branch, i + offset, cx, y - G + 11)
      }
      drawItem(item, cx, y)
      y += measureItem(item).h + (i < items.length - 1 ? G : 0)
    })
    return y
  }

  const drawItem = (item: Item, cx: number, y: number) => {
    if (item.kind === "if") {
      const { dw, lx, rx, bh } = ifGeom(item)
      place(item, cx, y)
      const my = y + DH / 2
      const top = y + DH + 24
      const merge = top + bh + 22
      const sides = [
        { label: "是", bx: cx + lx, steps: item.yes, branch: "yes" as const, corner: cx - dw / 2 },
        { label: "否", bx: cx + rx, steps: item.no, branch: "no" as const, corner: cx + dw / 2 },
      ]
      for (const side of sides) {
        if (side.steps.length) {
          arrow([
            [side.corner, my],
            [side.bx, my],
            [side.bx, top - 1],
          ])
          slot(item.id, side.branch, 0, side.bx, my + 22)
          const end = drawBlock(side.steps, side.bx, top, item.id, side.branch)
          slot(item.id, side.branch, side.steps.length, side.bx, end + 11)
          line([
            [side.bx, end],
            [side.bx, merge],
            [cx, merge],
          ])
        } else {
          line([
            [side.corner, my],
            [side.bx, my],
            [side.bx, merge],
            [cx, merge],
          ])
          slot(item.id, side.branch, 0, side.bx, (my + merge) / 2)
        }
        out.labels.push({
          x: side.label === "是" ? side.corner - 6 : side.corner + 6,
          y: my - 7,
          text: side.label,
          anchor: side.label === "是" ? "end" : "start",
        })
      }
      out.dots.push({ x: cx, y: merge })
      return
    }
    if (item.kind === "while") {
      const dw = nodeW(item)
      const body = measureBlock(item.body)
      place(item, cx, y)
      const my = y + DH / 2
      const top = y + DH + G
      ;(item.body.length ? arrow : line)([
        [cx, y + DH],
        [cx, item.body.length ? top - 1 : top + 8],
      ])
      out.labels.push({ x: cx + 16, y: y + DH + 15, text: "是", anchor: "start" })
      slot(item.id, "body", 0, cx, y + DH + 12)
      let end = top + 8
      if (item.body.length) {
        end = drawBlock(item.body, cx, top, item.id, "body")
        slot(item.id, "body", item.body.length, cx, end + 10)
      }
      const L = Math.max(dw / 2, body.L) + 28
      const R = Math.max(dw / 2, body.R) + 28
      const back = end + 20
      arrow([
        [cx, end],
        [cx, back],
        [cx - L, back],
        [cx - L, my],
        [cx - dw / 2 - 1, my],
      ])
      const exit = back + 20
      line([
        [cx + dw / 2, my],
        [cx + R, my],
        [cx + R, exit],
        [cx, exit],
      ])
      out.labels.push({ x: cx + dw / 2 + 6, y: my - 7, text: "否", anchor: "start" })
      return
    }
    place(item, cx, y)
  }

  const items: Item[] = [
    { kind: "start", id: START_ID, text: "开始" },
    ...doc.steps,
    { kind: "end", id: END_ID, text: "结束" },
  ]
  const ext = measureBlock(items)
  // 竖线和 + 的位置跟着 doc.steps 走：空图时开始和结束之间也要有一个 +
  const cx = PAD + ext.L
  drawBlock(items, cx, PAD, null, "main")
  out.width = ext.L + ext.R + PAD * 2
  out.height = ext.h + PAD * 2
  return out
}

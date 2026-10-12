/**
 * 流程图的数据：一棵结构树，不是「一堆框 + 一堆线」。
 *
 * 原来的编辑器（vue-flow）存的是自由摆放的节点和学生手拉的连线，能画出断线、孤立的框、
 * 一个「是」连出去三根线 —— 学生大半时间花在拖框、对连接点、理线上。现在只有三种结构：
 * 顺序、判断（是 / 否两路，走完合回来）、循环（当型，条件成立就走一遍循环体再回来判断），
 * 「开始」「结束」固定在两头不进数据。画不出来的只有乱跳的线，中职教的三种结构都画得出。
 *
 * 存进数据库（flowchart_submission.flowchart_data，压缩过）和本地草稿的都是 FlowDoc。
 * 2026-10 之前的提交存的是 vue-flow 的 nodes / edges，parseDoc 认不出来就是 null ——
 * 那些只能看 Mermaid 渲染出来的图，载不回画布。
 */

export type BoxKind = "input" | "output" | "process"
export type StepKind = BoxKind | "if" | "while"

interface StepBase {
  id: string
  text: string
}
export type BoxStep = StepBase & { kind: BoxKind }
export type IfStep = StepBase & { kind: "if"; yes: FlowStep[]; no: FlowStep[] }
export type WhileStep = StepBase & { kind: "while"; body: FlowStep[] }
export type FlowStep = BoxStep | IfStep | WhileStep

export interface FlowDoc {
  version: 2
  steps: FlowStep[]
}

/** 一个步骤列表在树里的位置：主线，或者某个判断 / 循环的哪一支 */
export type Branch = "main" | "yes" | "no" | "body"
/** 可以插一步的地方：某个列表的第 index 个位置之前（index = 长度就是末尾） */
export interface Slot {
  parent: string | null
  branch: Branch
  index: number
}

/** 画布上亮出某一组数据走过的路：order 是按先后经过的框，bad 是最先出问题的那个 */
export interface FlowHighlight {
  order: string[]
  bad: string | null
}

/** 开始、结束在画布上的 id（它们不进数据） */
export const START_ID = "__start"
export const END_ID = "__end"

export const STEP_LABEL: Record<StepKind, string> = {
  input: "输入",
  output: "输出",
  process: "处理",
  if: "判断",
  while: "循环",
}

export function emptyDoc(): FlowDoc {
  return { version: 2, steps: [] }
}

let seq = 0
function newId() {
  seq = (seq + 1) % 1_000_000
  return `s${Date.now().toString(36)}${seq.toString(36)}`
}

export function newStep(kind: StepKind): FlowStep {
  const base = { id: newId(), text: "" }
  if (kind === "if") return { ...base, kind, yes: [], no: [] }
  if (kind === "while") return { ...base, kind, body: [] }
  return { ...base, kind }
}

export function cloneDoc(doc: FlowDoc): FlowDoc {
  return JSON.parse(JSON.stringify(doc)) as FlowDoc
}

/** 按 id 找一步，顺带带出它所在的列表 */
export function findStep(
  steps: FlowStep[],
  id: string,
): { step: FlowStep; list: FlowStep[]; index: number } | null {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!
    if (step.id === id) return { step, list: steps, index }
    for (const child of children(step)) {
      const found = findStep(child, id)
      if (found) return found
    }
  }
  return null
}

function children(step: FlowStep): FlowStep[][] {
  if (step.kind === "if") return [step.yes, step.no]
  if (step.kind === "while") return [step.body]
  return []
}

function listAt(doc: FlowDoc, parent: string | null, branch: Branch): FlowStep[] | null {
  if (parent === null) return branch === "main" ? doc.steps : null
  const found = findStep(doc.steps, parent)
  if (!found) return null
  const step = found.step
  if (step.kind === "if" && (branch === "yes" || branch === "no")) return step[branch]
  if (step.kind === "while" && branch === "body") return step.body
  return null
}

/** 在 slot 处插一步，原地改 doc，返回新那一步 */
export function insertStep(doc: FlowDoc, slot: Slot, kind: StepKind): FlowStep | null {
  const list = listAt(doc, slot.parent, slot.branch)
  if (!list) return null
  const step = newStep(kind)
  list.splice(Math.max(0, Math.min(slot.index, list.length)), 0, step)
  return step
}

/** 删一步（判断 / 循环连同里面的一起删），返回一共删掉几个框 */
export function removeStep(doc: FlowDoc, id: string): number {
  const found = findStep(doc.steps, id)
  if (!found) return 0
  found.list.splice(found.index, 1)
  return countSteps([found.step])
}

export function countSteps(steps: FlowStep[]): number {
  return steps.reduce(
    (sum, step) => sum + 1 + children(step).reduce((n, c) => n + countSteps(c), 0),
    0,
  )
}

/** 还没写字的框有几个 */
export function countBlank(steps: FlowStep[]): number {
  return steps.reduce(
    (sum, step) =>
      sum + (step.text.trim() ? 0 : 1) + children(step).reduce((n, c) => n + countBlank(c), 0),
    0,
  )
}

/**
 * 一张图「长什么样」，不带 id：载回旧版、和交过的那一版比，只看结构和字。
 */
export function signature(doc: FlowDoc): string {
  const strip = (steps: FlowStep[]): unknown[] =>
    steps.map((step) => [step.kind, step.text.trim(), ...children(step).map(strip)])
  return JSON.stringify(strip(doc.steps))
}

// ==================== 读回来的数据 ====================

const KINDS = new Set<string>(["input", "output", "process", "if", "while"])

function parseSteps(raw: unknown): FlowStep[] | null {
  if (!Array.isArray(raw)) return null
  const out: FlowStep[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") return null
    const step = item as Record<string, unknown>
    const kind = step.kind
    if (typeof kind !== "string" || !KINDS.has(kind)) return null
    const id = typeof step.id === "string" && step.id ? step.id : newId()
    const text = typeof step.text === "string" ? step.text : ""
    if (kind === "if") {
      const yes = parseSteps(step.yes ?? [])
      const no = parseSteps(step.no ?? [])
      if (!yes || !no) return null
      out.push({ id, text, kind, yes, no })
    } else if (kind === "while") {
      const body = parseSteps(step.body ?? [])
      if (!body) return null
      out.push({ id, text, kind, body })
    } else {
      out.push({ id, text, kind: kind as BoxKind })
    }
  }
  return out
}

/** 本地草稿、交过的某一版：是新格式就读出来，旧的 vue-flow 格式或者坏数据给 null */
export function parseDoc(raw: unknown): FlowDoc | null {
  if (!raw || typeof raw !== "object") return null
  const data = raw as Record<string, unknown>
  if (data.version !== 2) return null
  const steps = parseSteps(data.steps)
  return steps ? { version: 2, steps } : null
}

// ==================== Mermaid ====================

/**
 * 交给 AI 的、结果页签和提交列表里渲染缩略图的，都是这份 Mermaid。
 *
 * 形状照国标流程图：起止是圆角跑道、输入输出是平行四边形、处理是矩形、判断是菱形。
 * 原来起止画成圆、输入输出和画布上的样子对不上，AI 还会说「输出框应该用矩形」。
 * class 行留着给 useMermaid 上色；classDef 不写了 —— 颜色是渲染那边的事，写进来
 * AI 会把「用了颜色样式」也当成优点打分。
 *
 * 学生敲的字直接塞进 "..."，一个双引号就会把语法撑破：坏掉的代码还会原样送去打分，
 * 学生不知道扣分是因为一个引号。`#` 必须先转，否则本来就有的 `#quot;` 会被当成实体。
 */
function escapeLabel(raw: string) {
  return raw.replace(/#/g, "#35;").replace(/"/g, "#quot;").replace(/\r?\n/g, "<br/>")
}

/**
 * Mermaid 里第 n 个框（nN）是画布上的哪一步：开始、各步按先序（判断先「是」再「否」）、结束。
 * 和下面 toMermaid 建框的顺序一致 —— AI 走例子时报的是 nN，结果页签靠它在画布上亮出路径
 */
export function mermaidOrder(doc: FlowDoc): string[] {
  const order = [START_ID]
  const walk = (steps: FlowStep[]) => {
    for (const step of steps) {
      order.push(step.id)
      for (const child of children(step)) walk(child)
    }
  }
  walk(doc.steps)
  order.push(END_ID)
  return order
}

export function toMermaid(doc: FlowDoc): string {
  const lines: string[] = ["flowchart TD"]
  const classes: string[] = []
  let n = 0
  const node = (shape: (label: string) => string, text: string, cls: string) => {
    const id = `n${n++}`
    lines.push(`    ${id}${shape(escapeLabel(text.trim() || " "))}`)
    classes.push(`    class ${id} ${cls}`)
    return id
  }
  /** 还没接上下一步的出口：从哪个框出来、线上写什么 */
  type Exit = { from: string; label?: string }
  const link = (exits: Exit[], to: string) => {
    for (const exit of exits) {
      lines.push(
        exit.label ? `    ${exit.from} -->|"${exit.label}"| ${to}` : `    ${exit.from} --> ${to}`,
      )
    }
  }
  const walk = (steps: FlowStep[], entries: Exit[]): Exit[] => {
    let exits = entries
    for (const step of steps) {
      if (step.kind === "if") {
        const id = node((l) => `{"${l}"}`, step.text, "decision")
        link(exits, id)
        exits = [
          ...walk(step.yes, [{ from: id, label: "是" }]),
          ...walk(step.no, [{ from: id, label: "否" }]),
        ]
      } else if (step.kind === "while") {
        const id = node((l) => `{"${l}"}`, step.text, "decision")
        link(exits, id)
        link(walk(step.body, [{ from: id, label: "是" }]), id)
        exits = [{ from: id, label: "否" }]
      } else {
        const shape =
          step.kind === "process" ? (l: string) => `["${l}"]` : (l: string) => `[/"${l}"/]`
        const id = node(shape, step.text, step.kind)
        link(exits, id)
        exits = [{ from: id }]
      }
    }
    return exits
  }
  const start = node((l) => `(["${l}"])`, "开始", "startNode")
  const exits = walk(doc.steps, [{ from: start }])
  const end = node((l) => `(["${l}"])`, "结束", "endNode")
  link(exits, end)
  return [...lines, "", ...classes].join("\n")
}

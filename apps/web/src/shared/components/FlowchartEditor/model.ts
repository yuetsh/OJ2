/**
 * 画布上改图的那些操作。图的数据结构（结构树）、读回、转 Mermaid 在契约
 * `@oj2/contract` 的 flowchart-doc.ts —— 后端评分也要按同一棵树把框对上号。
 * 这里转出去一份短名字，编辑器和结果页签都从这里引。
 */
import {
  countBlankSteps,
  flowChildren,
  flowSignature,
  flowToMermaid,
  FLOW_END_ID,
  FLOW_START_ID,
  mermaidOrder,
  parseFlowDoc,
  type FlowDoc,
  type FlowStep,
  type StepKind,
} from '@oj2/contract'

export type { BoxKind, FlowDoc, FlowStep, StepKind } from '@oj2/contract'
export {
  countBlankSteps as countBlank,
  flowSignature as signature,
  flowToMermaid as toMermaid,
  FLOW_END_ID as END_ID,
  FLOW_START_ID as START_ID,
  mermaidOrder,
  parseFlowDoc as parseDoc,
}

/** 一个步骤列表在树里的位置：主线，或者某个判断 / 循环的哪一支 */
export type Branch = 'main' | 'yes' | 'no' | 'body'
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
  /** 标红那个框旁边的小标签（「要改这个框」）；不给就不画 */
  label?: string
}

export const STEP_LABEL: Record<StepKind, string> = {
  input: '输入',
  output: '输出',
  process: '处理',
  if: '判断',
  while: '循环',
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
  const base = { id: newId(), text: '' }
  if (kind === 'if') return { ...base, kind, yes: [], no: [] }
  if (kind === 'while') return { ...base, kind, body: [] }
  return { ...base, kind }
}

export function cloneDoc(doc: FlowDoc): FlowDoc {
  return JSON.parse(JSON.stringify(doc)) as FlowDoc
}

/** 按 id 找一步，顺带带出它所在的列表 */
export function findStep(steps: FlowStep[], id: string): { step: FlowStep; list: FlowStep[]; index: number } | null {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!
    if (step.id === id) return { step, list: steps, index }
    for (const child of flowChildren(step)) {
      const found = findStep(child, id)
      if (found) return found
    }
  }
  return null
}

function listAt(doc: FlowDoc, parent: string | null, branch: Branch): FlowStep[] | null {
  if (parent === null) return branch === 'main' ? doc.steps : null
  const found = findStep(doc.steps, parent)
  if (!found) return null
  const step = found.step
  if (step.kind === 'if' && (branch === 'yes' || branch === 'no')) return step[branch]
  if (step.kind === 'while' && branch === 'body') return step.body
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
  return steps.reduce((sum, step) => sum + 1 + flowChildren(step).reduce((n, c) => n + countSteps(c), 0), 0)
}

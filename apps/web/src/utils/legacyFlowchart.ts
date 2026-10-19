/**
 * 老师手写的老参考流程图，显示前按标准符号重排。
 *
 * 现在的流程图（学生的画布、出题页的参考图）都由结构树生成，每个框带 `class nX input` 这样的
 * 种类，useMermaid 按种类上标准的形状和颜色。2026-10 之前老师直接手写 Mermaid 的参考图
 * （库里 36 张，全是这种）一个种类都没标：输入写成普通方框 `B[输入n]`、开始写成正圆，
 * 显示时只能按框里的字分彩色，和学生图上的标准符号对不上。
 *
 * 这里只处理**一个种类都没标**的图（学生的老提交全都标了，不受影响），按写法和字认框：
 * 花括号是判断；字是「开始 / 结束」的是起止；以「输入」「输出」「打印」开头（或者直接写着
 * input( / print(）的是输入输出框；其余是处理框。认出来就换成标准形状、补上种类。靠字猜的：「a = 输入」会被当成处理框。
 * 数据不动，只改显示。
 */

const SEMANTIC_CLASS =
  /^\s*class\s+[\w,-]+\s+(startNode|endNode|startEnd|input|output|process|decision|loop)\s*;?\s*$/m

/** 节点的开口和对应的收口，长的在前（`((` 要先于 `(` 认） */
const SHAPES: [string, string][] = [
  ["((", "))"],
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["{{", "}}"],
  ["[/", "/]"],
  ["[\\", "\\]"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
]

/** 这些开头的行不是节点：声明、分组、样式 */
const SKIP_LINE = /^\s*(graph|flowchart|subgraph|end\s*$|class|classDef|style|linkStyle|click|%%)/

const START = /^(开始|start)$/i
const END = /^(结束|end)$/i
const INPUT = /^(输入|读入|读取|input)/i
const OUTPUT = /^(输出|打印|显示|print|output)/i

type Kind = "startNode" | "endNode" | "input" | "output" | "process" | "decision"

function plain(body: string) {
  const text = body.trim()
  return text.startsWith('"') && text.endsWith('"') && text.length >= 2 ? text.slice(1, -1) : text
}

function kindOf(open: string, text: string): Kind {
  const word = text.replace(/<br\s*\/?>/gi, " ").trim()
  if (START.test(word)) return "startNode"
  if (END.test(word)) return "endNode"
  if (open === "{" || open === "{{") return "decision"
  // 有老师直接写代码：「a = float(input())」是读数据
  if (INPUT.test(word) || /\binput\s*\(/.test(word)) return "input"
  if (OUTPUT.test(word)) return "output"
  return "process"
}

function shaped(kind: Kind, text: string) {
  const label = `"${text.replace(/"/g, "#quot;")}"`
  if (kind === "startNode" || kind === "endNode") return `([${label}])`
  if (kind === "decision") return `{${label}}`
  if (kind === "input" || kind === "output") return `[/${label}/]`
  return `[${label}]`
}

/** 从 start 起找收口，引号里的不算 */
function closeAt(line: string, start: number, close: string) {
  let quoted = false
  for (let i = start; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (!quoted && line.startsWith(close, i)) return i
  }
  return -1
}

function rewriteLine(line: string, kinds: Map<string, Kind>) {
  let out = ""
  let i = 0
  while (i < line.length) {
    const id = /^[A-Za-z_][\w-]*/.exec(line.slice(i))
    const prev = i > 0 ? line[i - 1]! : " "
    if (!id || /[\w-]/.test(prev)) {
      out += line[i]
      i++
      continue
    }
    const after = i + id[0].length
    const shape = SHAPES.find(([open]) => line.startsWith(open, after))
    const end = shape ? closeAt(line, after + shape[0].length, shape[1]) : -1
    if (!shape || end < 0) {
      out += id[0]
      i = after
      continue
    }
    const text = plain(line.slice(after + shape[0].length, end))
    const kind = kindOf(shape[0], text)
    kinds.set(id[0], kind)
    out += id[0] + shaped(kind, text)
    i = end + shape[1].length
  }
  return out
}

export function normalizeLegacyFlowchart(code: string) {
  if (!/^\s*(graph|flowchart)\b/.test(code) || SEMANTIC_CLASS.test(code) || code.includes(":::"))
    return code
  const kinds = new Map<string, Kind>()
  const lines = code
    .split("\n")
    .map((line) => (SKIP_LINE.test(line) ? line : rewriteLine(line, kinds)))
  if (!kinds.size) return code
  return [...lines, "", ...[...kinds].map(([id, kind]) => `    class ${id} ${kind}`)].join("\n")
}

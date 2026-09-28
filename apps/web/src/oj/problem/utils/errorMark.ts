import { StateEffect, StateField, type EditorState } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view"
import type { PunctuationFix } from "./chinesePunctuation"

/**
 * 在题目页的编辑器里标出编译错误的位置：整行淡红底，`^` 标的那一段加红波浪线。
 *
 * 中职学生读不懂英文报错，「看这里」比任何文字都直接。标记跟着编辑映射位置
 * （在上面插一行，标记跟着往下走），下一次提交时清掉。
 */

interface Mark {
  line: number
  /** 行内列号，[from, to)；没有就只标整行 */
  from?: number
  to?: number
}

const setMark = StateEffect.define<Mark | null>()

const lineDeco = Decoration.line({ class: "cm-error-line" })
const rangeDeco = Decoration.mark({ class: "cm-error-range" })

function build(state: EditorState, mark: Mark): DecorationSet {
  if (mark.line < 1 || mark.line > state.doc.lines) return Decoration.none
  const line = state.doc.line(mark.line)
  const ranges = [lineDeco.range(line.from)]
  if (mark.from !== undefined && mark.to !== undefined) {
    const from = line.from + Math.min(mark.from, line.length)
    const to = line.from + Math.min(mark.to, line.length)
    if (to > from) ranges.push(rangeDeco.range(from, to))
  }
  return Decoration.set(ranges)
}

/**
 * 中文标点的标记：报错只点名第一处，但「把中文标点都换成英文（N 处）」说的是 N 处 ——
 * 编辑器里只看得到一处的话，学生对不上那个 N，也不知道一键替换会改哪里。
 * 字符串和注释里的不标（那是合法的，见 chinesePunctuation.ts）
 */
const setPunctuation = StateEffect.define<PunctuationFix[]>()
const punctuationDeco = Decoration.mark({ class: "cm-punctuation-mark" })

const punctuationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setPunctuation)) {
        const max = tr.state.doc.length
        deco = Decoration.set(
          effect.value
            .filter((fix) => fix.to <= max && fix.to > fix.from)
            .map((fix) => punctuationDeco.range(fix.from, fix.to)),
          true,
        )
      }
      // 清错误标记的时候（下一次提交、一键替换）一起清
      if (effect.is(setMark) && effect.value === null) deco = Decoration.none
    }
    return deco
  },
  provide: (field) => EditorView.decorations.from(field),
})

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setMark)) deco = effect.value ? build(tr.state, effect.value) : Decoration.none
    }
    return deco
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * 题目页当前那个编辑器。结果面板和编辑器是兄弟组件，隔着好几层，
 * 与其一路透传 ref，不如让编辑器挂载时自己登记。只挂在题目页主编辑器上
 * （ProblemEditor 的扩展数组），自测、流程图那些编辑器不登记。
 */
let current: EditorView | null = null

const tracker = ViewPlugin.define((view) => {
  current = view
  return {
    destroy() {
      if (current === view) current = null
    },
  }
})

const theme = EditorView.baseTheme({
  ".cm-error-line": { backgroundColor: "rgba(208, 48, 80, 0.12)" },
  ".cm-error-range": {
    textDecoration: "underline wavy #d03050",
    textUnderlineOffset: "3px",
    backgroundColor: "rgba(208, 48, 80, 0.18)",
  },
  ".cm-punctuation-mark": {
    backgroundColor: "rgba(240, 160, 32, 0.35)",
    outline: "1px solid rgba(240, 160, 32, 0.8)",
    borderRadius: "2px",
  },
})

export const errorMarkExtensions = [markField, punctuationField, tracker, theme]

/** 标出这些中文标点（位置是整篇代码里的偏移，来自 findChinesePunctuation） */
export function showPunctuationMarks(fixes: PunctuationFix[]) {
  current?.dispatch({ effects: setPunctuation.of(fixes) })
}

/**
 * 标出第 `line` 行并滚过去。`sourceLine` 是报错里打出来的那一行（去了行首空格），
 * 编辑器里这一行对得上才标列范围 —— 学生看结果之前可能已经改过代码了，
 * 对不上时列号没有意义，只标整行。
 */
export function showErrorMark(
  line: number,
  sourceLine: string | null,
  caret: { from: number; to: number } | null,
) {
  const view = current
  if (!view || line < 1 || line > view.state.doc.lines) return
  const text = view.state.doc.line(line).text
  const mark: Mark = { line }
  if (caret && sourceLine !== null) {
    const stripped = text.replace(/^ +/, "")
    if (stripped.trimEnd() === sourceLine.trimEnd()) {
      const indent = text.length - stripped.length
      mark.from = indent + caret.from
      mark.to = indent + caret.to
    }
  }
  const pos = view.state.doc.line(line).from
  view.dispatch({
    effects: [setMark.of(mark), EditorView.scrollIntoView(pos, { y: "center" })],
  })
}

export function clearErrorMark() {
  current?.dispatch({ effects: setMark.of(null) })
}

/** 当前编辑器里的代码；编辑器没挂载时为 null */
export function currentCode() {
  return current?.state.doc.toString() ?? null
}

/**
 * 在编辑器里批量替换。走编辑器事务而不是直接改 store 里的字符串：
 * 这样一次 Ctrl+Z 就能撤回，协作中的对方也能同步到。
 *
 * 不打 userEvent：editTrace 按 `isUserEvent("input")` 数「自己敲的字」，
 * 打成 `input.*` 就会把这次替换算成学生手打的。
 */
export function applyFixes(fixes: PunctuationFix[]) {
  if (!current || !fixes.length) return false
  current.dispatch({ changes: fixes, effects: setMark.of(null) })
  return true
}

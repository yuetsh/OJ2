import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/**
 * 在出错那一步的编辑器里把出错的行标成淡红底（「看这里」比任何文字都直接）。
 *
 * 题目页那套（oj/problem/utils/errorMark.ts）只认页面上「当前那一个」编辑器，
 * 数据分析一页有好几个编辑器、报错还可能落在前面某一步，所以这里按 DOM 找到那一步的编辑器再标。
 * 标记跟着编辑挪位置，下一次运行时清掉。
 */
const setLine = StateEffect.define<number | null>()
const lineDeco = Decoration.line({ class: 'cm-data-analysis-error-line' })

const field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setLine)) continue
      const line = effect.value
      deco = line && line >= 1 && line <= tr.state.doc.lines ? Decoration.set([lineDeco.range(tr.state.doc.line(line).from)]) : Decoration.none
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// 不用 baseTheme：光标停在出错那行时，代码主题的「当前行」底色会把它盖掉
const theme = EditorView.theme({
  '.cm-line.cm-data-analysis-error-line': { backgroundColor: 'rgba(208, 48, 80, 0.14)' },
})

/** 传给 CodeEditor 的 extra-extensions；模块级常量，实例稳定，编辑器不会反复重配 */
export const dataAnalysisLineMarkExtensions = [field, theme]

/** 在 `container` 里的那个编辑器上标第 `line` 行；null 清掉 */
export function markLine(container: Element | null | undefined, line: number | null) {
  const dom = container?.querySelector('.cm-editor')
  const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null
  if (!view) return
  view.dispatch({ effects: setLine.of(line) })
}

import { syntaxTree } from "@codemirror/language"
import { RangeSetBuilder, type Extension } from "@codemirror/state"
import { Decoration, type DecorationSet, type EditorView, ViewPlugin } from "@codemirror/view"
import { FORMAT_CLASS, type FormatFamily, formatSpans } from "../formatPlaceholder"

/** 编辑器里给字符串中的 %d 这类占位符上色，正则见 shared/formatPlaceholder.ts。只扫看得见的部分 */
export function formatPlaceholders(family: FormatFamily): Extension {
  const mark = Decoration.mark({ class: FORMAT_CLASS[family] })

  function build(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>()
    let last = 0
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter: (node) => {
          if (node.name !== "String" && node.name !== "FormatString") return
          // 同一个字符串跨两段可见区（中间折叠了）时只加一次，builder 要求从前往后
          if (node.from >= last) {
            const text = view.state.doc.sliceString(node.from, node.to)
            for (const s of formatSpans(text, family)) {
              builder.add(node.from + s.from, node.from + s.to, mark)
            }
            last = node.to
          }
          return false
        },
      })
    }
    return builder.finish()
  }

  return ViewPlugin.define(
    (view) => ({
      decorations: build(view),
      update(u) {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = build(u.view)
        }
      },
    }),
    { decorations: (v) => v.decorations },
  )
}

import { syntaxTree } from '@codemirror/language'
import type { Extension, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin } from '@codemirror/view'
import { highlightTree } from '@lezer/highlight'
import { type CodeFamily, extraMarks, fakeStrings } from '../codeMarks'
import { codeHighlighter } from '../highlight'

/**
 * 编辑器里补的标记（%d、全角标点、Python 内置类型、SQL 函数），规则见 shared/codeMarks.ts。
 * 和静态代码一样按 codeHighlighter 分出来的词逐个过 extraMarks()；只扫看得见的部分。
 */
export function codeMarks(family: CodeFamily): Extension {
  const decos = new Map<string, Decoration>()
  const deco = (cls: string) => {
    let d = decos.get(cls)
    if (!d) decos.set(cls, (d = Decoration.mark({ class: cls })))
    return d
  }

  function build(view: EditorView): DecorationSet {
    const tree = syntaxTree(view.state)
    const ranges: Range<Decoration>[] = []
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to)
      const fake = fakeStrings(tree, (a, b) => view.state.doc.sliceString(a, b), from, to)
      const prev = (pos: number) => (pos > from ? text[pos - from - 1] : '')
      const add = (start: number, end: number, classes: string) => {
        if (fake.some((r) => start >= r.from && start < r.to)) classes = ''
        for (const m of extraMarks(text.slice(start - from, end - from), classes, family, prev(start), view.state.doc.sliceString(end, end + 20))) {
          ranges.push(deco(m.cls).range(start + m.from, start + m.to))
        }
      }
      // highlightTree 只吐有类名的词，中间没类名的空档（全角标点多半在这里）另外补
      let at = from
      highlightTree(
        tree,
        codeHighlighter,
        (start, end, classes) => {
          if (start > at) add(at, start, '')
          add(start, end, classes)
          at = end
        },
        from,
        to,
      )
      if (to > at) add(at, to, '')
    }
    return Decoration.set(ranges, true)
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

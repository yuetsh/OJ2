import { RangeSetBuilder } from "@codemirror/state"
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view"

/**
 * 手机上代码折行。原来是横着滚，可没有滚动条也看不出右边还有，
 * 综合练习那种长 print 整整半行看不见。折下来的那截缩到这一行的代码下面再进两格，
 * 一眼看得出还是同一行。
 */

/** 行首空白占几格，tab 按 4 */
function leadingWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    if (ch === " ") width++
    else if (ch === "\t") width += 4
    else break
  }
  return width
}

/** 静态的代码行（练一练的排序、找错、填空）：折行，接着的那截悬挂缩进 */
export function hangStyle(text: string): Record<string, string> {
  const width = leadingWidth(text) + 2
  return {
    whiteSpace: "pre-wrap",
    // 中文连着的一串别从中间断（「类」「型」各在一行），实在放不下才随便断
    wordBreak: "keep-all",
    overflowWrap: "anywhere",
    paddingLeft: `${width}ch`,
    textIndent: `-${width}ch`,
  }
}

function hangDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos)
      const width = leadingWidth(line.text) + 2
      // 6px 是 CodeMirror 给 .cm-line 的左内边距，盖掉了要补回来
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          attributes: {
            style: `padding-left: calc(${width}ch + 6px); text-indent: -${width}ch; word-break: keep-all; overflow-wrap: anywhere`,
          },
        }),
      )
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const hangPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = hangDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = hangDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** 编辑器（正文里能运行的代码块）：折行 + 悬挂缩进 */
export const hangWrapExtensions = [EditorView.lineWrapping, hangPlugin]

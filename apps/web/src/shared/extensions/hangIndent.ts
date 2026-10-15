import { RangeSetBuilder } from "@codemirror/state"
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view"

/**
 * 手机上代码折行（题目页的编辑器）。原来是横着滚，可没有滚动条也看不出右边还有。
 * 折下来的那截缩到这一行的代码下面再进两格，一眼看得出还是同一行。
 * 自学的代码块和练一练也这么折过，用户嫌不好看，又改回横着滚了。
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

const glue = Decoration.mark({ attributes: { style: "white-space: nowrap" } })

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
      // 行首缩进后面紧跟一长串没空格的（printf("%d",a*100+b*10+c);），浏览器会在缩进后面折，
      // 第一行只剩一截空白。把缩进和第一个字粘成不折的一段，长串就接在缩进后面再折
      const indent = line.text.match(/^[ \t]+/)?.[0].length ?? 0
      if (indent > 0 && indent < line.length) {
        builder.add(line.from, line.from + indent + 1, glue)
      }
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

/** 编辑器：折行 + 悬挂缩进 */
export const hangWrapExtensions = [EditorView.lineWrapping, hangPlugin]

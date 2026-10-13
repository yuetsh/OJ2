import { insertBracket } from "@codemirror/autocomplete"
import { EditorView } from "@codemirror/view"
import { ref } from "vue"
import { currentEditorView } from "./errorMark"

/**
 * 手机上写代码的符号键（SymbolKeys.vue）。括号、引号、冒号在手机键盘上都要切到符号页，
 * 一行 print(int(input())) 来回切七八次。
 */

/** 题目页主编辑器有没有焦点 —— 有焦点就是键盘弹着，这时才摆符号键 */
export const editorFocused = ref(false)

export const editorFocusTracker = EditorView.focusChangeEffect.of((_state, focusing) => {
  editorFocused.value = focusing
  return null
})

export interface SymbolKey {
  label: string
  /** 插进去的字；不写就是 label */
  text?: string
}

const INDENT: SymbolKey = { label: "缩进", text: "    " }

/** 按语言给一排：最常用的在前，放不下的往右滑 */
export const SYMBOL_KEYS: Record<"python" | "c" | "sql", SymbolKey[]> = {
  python: [
    INDENT,
    ...["(", ")", '"', ":", "=", "[", "]", ",", "'", "+", "-", "*", "/", "%", "<", ">", "#"].map(
      (label) => ({ label }),
    ),
  ],
  c: [
    INDENT,
    ...[
      "(",
      ")",
      ";",
      '"',
      "{",
      "}",
      "=",
      "%",
      "&",
      "[",
      "]",
      ",",
      "+",
      "-",
      "*",
      "/",
      "<",
      ">",
    ].map((label) => ({ label })),
  ],
  sql: ["(", ")", "'", ",", "*", "=", ";", "<", ">", "%"].map((label) => ({ label })),
}

/**
 * 在光标处插一个键。括号、引号走 CodeMirror 自己的配对规则（和键盘上敲是一样的：
 * 敲「(」补上「)」、光标前正好是「)」时敲「)」是跳过去），别的原样插。
 */
export function typeSymbol(key: SymbolKey) {
  const view = currentEditorView()
  if (!view) return
  const text = key.text ?? key.label
  const bracket = text.length === 1 ? insertBracket(view.state, text) : null
  view.dispatch(
    bracket ?? view.state.update(view.state.replaceSelection(text), { userEvent: "input.type" }),
  )
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head) })
  view.focus()
}

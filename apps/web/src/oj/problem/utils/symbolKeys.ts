import { insertBracket } from "@codemirror/autocomplete"
import { EditorView } from "@codemirror/view"
import { computed, ref } from "vue"
import { currentEditorView } from "./errorMark"

/**
 * 手机上写代码的符号键（SymbolKeys.vue）。括号、引号、冒号在手机键盘上都要切到符号页，
 * 一行 print(int(input())) 来回切七八次。
 */

/** 题目页主编辑器有没有焦点 */
export const editorFocused = ref(false)

export const editorFocusTracker = EditorView.focusChangeEffect.of((_state, focusing) => {
  editorFocused.value = focusing
  return null
})

/**
 * 软键盘是不是弹着。光看焦点不够：安卓按返回键收键盘，编辑器**不失焦**，
 * 符号键就一直贴在屏幕底下，「运行例子 / 提交」也不回来，学生找不到地方交。
 *
 * 键盘弹起时可视视口变矮（iOS 和 Chrome 108+ 布局视口不变；更老的安卓连
 * innerHeight 一起变矮），所以和这个宽度下见过的最高值比。宽度变了（转屏）重新量。
 * 乘 scale 是为了双指放大时别误判成键盘弹着。
 */
const keyboardUp = ref(false)
let baseline = 0
let baselineWidth = 0

export function measureKeyboard() {
  const viewport = window.visualViewport
  if (!viewport) return
  if (window.innerWidth !== baselineWidth) {
    baselineWidth = window.innerWidth
    baseline = 0
  }
  const visible = viewport.height * viewport.scale
  baseline = Math.max(baseline, window.innerHeight, visible)
  keyboardUp.value = visible < baseline - 120
}

/** 正在打字：编辑器有焦点、键盘也弹着。这时才摆符号键，底栏让位 */
export const typing = computed(
  () => editorFocused.value && (!window.visualViewport || keyboardUp.value),
)

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

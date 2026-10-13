import { syntaxHighlighting } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { codeHighlighter } from "../highlight"

/**
 * 编辑器的外观：亮 / 暗两套只管底色、光标、选区、行号这些「框」，
 * 代码的颜色两套都是 codeHighlighter 打的 tok-* 类名，跟着 html.dark 在 highlight.css 里切。
 * 框的颜色照 VS Code 的默认值（src/vs/editor/common/core/editorColorRegistry.ts 等），
 * 只有暗色的底色用网站自己的，不用 VS Code 的 #1E1E1E。
 *
 * 当前行照 VS Code 是一圈边框不是底色，并且只在编辑器有焦点时画：
 * 自学一课里有十几个代码块，不然每块第一行都框着。
 */
const highlighting = syntaxHighlighting(codeHighlighter)

// CodeMirror 自带的选区规则带着 > .cm-scroller > .cm-selectionLayer，选择器短了压不过它
const focusedSelection = "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground"

const light = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "var(--code-fg)",
  },
  ".cm-content": { caretColor: "#000000" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#000000" },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#ADD6FF80" },
  [focusedSelection]: { backgroundColor: "#ADD6FF" },
  ".cm-selectionMatch": { backgroundColor: "#ADD6FF80" },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "#0064001a",
    outline: "1px solid #B9B9B9",
  },
  ".cm-searchMatch": { backgroundColor: "#EA5C0055" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#A8AC94" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused .cm-activeLine": { boxShadow: "inset 0 0 0 2px #eeeeee" },
  ".cm-gutters": {
    backgroundColor: "#ffffff",
    borderRight: "none",
    color: "#237893",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  "&.cm-focused .cm-activeLineGutter": { color: "#0B216F" },
  ".cm-tooltip": {
    border: "1px solid #e0e0e0",
    backgroundColor: "#f8f8f8",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "#e8e8e8",
      color: "#000000",
    },
  },
})

const darkBackground = "#26262a",
  background = "#101014", // naive-ui
  tooltipBackground = "#353a42",
  highlightBackground = "#2c313a"

const dark = EditorView.theme(
  {
    "&": {
      color: "var(--code-fg)",
      backgroundColor: background,
    },
    ".cm-content": { caretColor: "#AEAFAD" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#AEAFAD" },
    ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#264F7880" },
    [focusedSelection]: { backgroundColor: "#264F78" },
    ".cm-selectionMatch": { backgroundColor: "#ADD6FF26" },
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: "#0064001a",
      outline: "1px solid #888888",
    },
    ".cm-searchMatch": { backgroundColor: "#EA5C0055" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#515C6A" },
    ".cm-panels": { backgroundColor: darkBackground, color: "var(--code-fg)" },
    ".cm-panels.cm-panels-top": { borderBottom: "2px solid black" },
    ".cm-panels.cm-panels-bottom": { borderTop: "2px solid black" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    "&.cm-focused .cm-activeLine": { boxShadow: "inset 0 0 0 2px #282828" },
    ".cm-gutters": {
      backgroundColor: background,
      color: "#858585",
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    "&.cm-focused .cm-activeLineGutter": { color: "#C6C6C6" },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: "#ddd",
    },
    ".cm-tooltip": {
      border: "none",
      backgroundColor: tooltipBackground,
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
      borderTopColor: "transparent",
      borderBottomColor: "transparent",
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
      borderTopColor: tooltipBackground,
      borderBottomColor: tooltipBackground,
    },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": {
        backgroundColor: highlightBackground,
        color: "var(--code-fg)",
      },
    },
  },
  { dark: true },
)

export const lightCodeTheme: Extension = [light, highlighting]
export const darkCodeTheme: Extension = [dark, highlighting]

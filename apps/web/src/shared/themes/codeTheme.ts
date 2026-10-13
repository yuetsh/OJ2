import { syntaxHighlighting } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { codeHighlighter } from "../highlight"

/**
 * 编辑器的外观：亮 / 暗两套只管底色、光标、选区、行号这些「框」，
 * 代码的颜色两套都是 codeHighlighter 打的 tok-* 类名，跟着 html.dark 在 highlight.css 里切。
 * 框沿用原来的 smoothy（亮）和 One Dark（暗），只把代码配色换成了 Alucard / Dracula。
 */
const highlighting = syntaxHighlighting(codeHighlighter)

const light = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "var(--code-fg)",
  },
  ".cm-content": { caretColor: "#000000" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#000000" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#FFFD0054",
  },
  ".cm-activeLine": { backgroundColor: "#00000008" },
  ".cm-gutters": {
    backgroundColor: "#ffffff",
    borderRight: "none",
    color: "#00000070",
  },
  ".cm-activeLineGutter": { backgroundColor: "#00000008" },
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
  highlightBackground = "#2c313a",
  background = "#101014", // naive-ui
  tooltipBackground = "#353a42",
  stone = "#7d8799",
  cursor = "#528bff"

const dark = EditorView.theme(
  {
    "&": {
      color: "var(--code-fg)",
      backgroundColor: background,
    },
    ".cm-content": { caretColor: cursor },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: cursor },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#3E4451",
    },
    ".cm-panels": { backgroundColor: darkBackground, color: "var(--code-fg)" },
    ".cm-panels.cm-panels-top": { borderBottom: "2px solid black" },
    ".cm-panels.cm-panels-bottom": { borderTop: "2px solid black" },
    ".cm-searchMatch": {
      backgroundColor: "#72a1ff59",
      outline: "1px solid #457dff",
    },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#6199ff2f" },
    ".cm-activeLine": { backgroundColor: "#6699ff0b" },
    ".cm-selectionMatch": { backgroundColor: "#aafe661a" },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "#bad0f847",
    },
    ".cm-gutters": {
      backgroundColor: background,
      color: stone,
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: highlightBackground },
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

import { EditorState, RangeSetBuilder, Transaction, type Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

/**
 * C 教程里没写 main 的片段（```c main）：运行时套上一层 main，套的这几行灰着、改不了。
 *
 * 套的行就放在编辑器里，不是另外拼在提交的代码上 —— 这样报错的行号和学生看到的一样，
 * 复制出去的也是一份完整能跑的程序。
 */
const HEAD = ['#include <stdio.h>', '', 'int main(void) {']
const FOOT = ['    return 0;', '}']

export function wrapMain(code: string) {
  const body = code.split('\n').map((line) => (line ? `    ${line}` : line))
  return [...HEAD, ...body, ...FOOT].join('\n')
}

/** 头尾两段的字符范围：头到片段第一行行首，尾从片段最后一行行尾起（换行符算在套的那边） */
function lockedRanges(state: EditorState) {
  const doc = state.doc
  const headEnd = doc.line(HEAD.length + 1).from
  const footStart = doc.line(doc.lines - FOOT.length + 1).from - 1
  return { headEnd, footStart }
}

// 边界上插入是放行的（实测 changeFilter 只拦范围内部），所以片段首行行首、末行行尾照常能打字。
// 只拦学生的编辑：「还原」、换课时 CodeMirror.vue 整篇替换文档，那一下不带 userEvent
const lock = EditorState.changeFilter.of((tr) => {
  if (!tr.annotation(Transaction.userEvent)) return true
  const { headEnd, footStart } = lockedRanges(tr.startState)
  return [0, headEnd, footStart, tr.startState.doc.length]
})

const dim = Decoration.line({ class: 'cm-main-wrap' })

const dimLines = EditorView.decorations.compute(['doc'], (state) => {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = state.doc
  for (let n = 1; n <= doc.lines; n++) {
    if (n <= HEAD.length || n > doc.lines - FOOT.length) builder.add(doc.line(n).from, doc.line(n).from, dim)
  }
  return builder.finish()
})

export const mainWrapExtensions: Extension[] = [lock, dimLines]

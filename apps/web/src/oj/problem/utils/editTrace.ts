import { EditorView } from "@codemirror/view"
import type { SubmissionTrace } from "@oj2/contract"

/**
 * 编辑过程信号的采集，随提交一起报给后端（落进 `submission_trace`）。
 * 字段含义见契约的 `submissionTraceSchema`。**只数字符数和次数，不留任何按键内容。**
 *
 * 是模块单例而不是 Pinia store：编辑器（ProblemEditor / ContestEditor 里）和
 * 提交按钮（Form → SubmitCode）是兄弟组件，得共用一份计数；而 CodeMirror 的
 * 扩展对象一旦经过 store 就会被包成响应式代理，facet 靠身份比较，代理过的扩展
 * 直接失效。计数本身也不需要响应式。
 *
 * **只数带 userEvent 的事务。** 下面这些都不带，所以天然不会被算进去：
 * - `codeStore.setCode()` —— vue-codemirror 的 setDoc 只 dispatch 一个 changes：
 *   提交前的自动格式化、载入草稿 / 模板、切语言都走这条；
 * - 课堂协作里对方的改动 —— y-codemirror.next 应用远程更新时只挂 ySyncAnnotation。
 *
 * 撤销 / 重做、编辑器内部拖动（`move.drop`）也不数：它们既不是新写的也不是外来的。
 */

/** 两次编辑间隔超过这个就算走开了，中间这段不计入活跃时长 */
const IDLE_MS = 60_000

let key: string | null = null
let startedAt = 0
let lastEditAt: number | null = null
let activeMs = 0
let typedChars = 0
let pastedChars = 0
let pasteCount = 0
let maxPaste = 0
let deletedChars = 0
let blurCount = 0
let initialLen = 0

function reset(len: number) {
  startedAt = performance.now()
  lastEditAt = null
  activeMs = 0
  typedChars = 0
  pastedChars = 0
  pasteCount = 0
  maxPaste = 0
  deletedChars = 0
  blurCount = 0
  initialLen = len
}

/**
 * 开始（或接着）记一道题。编辑器载入代码之后调。
 *
 * `traceKey` 没变就**什么都不做** —— 同一道题里切去看提交记录、再切回来，
 * 编辑器可能会重新挂载，不能因此把这一段的计数清掉。换了题才重新开始。
 * 切语言不换 key：学生改用另一种语言重写这道题，仍然是同一段做题过程。
 */
export function beginEditTrace(traceKey: string, len: number) {
  if (traceKey === key) return
  key = traceKey
  reset(len)
}

/** 这一段的快照，附在提交请求上 */
export function snapshotEditTrace(collab: boolean): SubmissionTrace {
  return {
    activeMs: Math.round(activeMs),
    sinceOpenMs: Math.round(performance.now() - startedAt),
    typedChars,
    pastedChars,
    pasteCount,
    maxPaste,
    deletedChars,
    blurCount,
    initialLen,
    collab,
  }
}

/** 提交成功之后调：下一条提交只记从这里往后的那一段 */
export function restartEditTrace(len: number) {
  reset(len)
}

function touch() {
  const now = performance.now()
  if (lastEditAt !== null && now - lastEditAt <= IDLE_MS)
    activeMs += now - lastEditAt
  lastEditAt = now
}

// 只数 hidden 这一个事件：切标签页时 window 的 blur 和 visibilitychange 会一起触发，
// 两个都数就是一次记两下。代价是同屏切到别的窗口（页面仍可见）不计，这本来就只是辅助信号。
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return
  blurCount++
  // 切走的这段不算活跃，回来之后的第一下编辑重新起算
  lastEditAt = null
})

/** 挂到题目页的代码编辑器上。同一个实例，别每次渲染新建 —— 那会让编辑器反复重配扩展 */
export const editTraceExtensions = [
  EditorView.updateListener.of((update) => {
    if (!update.docChanged) return
    for (const tr of update.transactions) {
      if (!tr.docChanged) continue
      // 顺序要紧：isUserEvent("input") 也会匹配 "input.paste"
      const pasted =
        tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop")
      const typed = !pasted && tr.isUserEvent("input")
      const deleted = tr.isUserEvent("delete")
      if (!pasted && !typed && !deleted) continue

      let inserted = 0
      let removed = 0
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
        // 原样替换不算：closeBrackets 越过已有的右括号 / 引号时，是把 `)` 替换成 `)`
        // 而不是只挪光标（@codemirror/autocomplete 的 handleClose），不排掉的话
        // 每敲一个右括号就多记一个键入加一个删除
        if (
          toA - fromA === text.length &&
          tr.startState.sliceDoc(fromA, toA) === text.toString()
        )
          return
        removed += toA - fromA
        inserted += text.length
      })

      // 选中一段再打字 / 粘贴，被替换掉的那部分也算删除
      deletedChars += removed
      if (pasted) {
        pastedChars += inserted
        pasteCount++
        if (inserted > maxPaste) maxPaste = inserted
      } else if (typed) {
        typedChars += inserted
      }
      touch()
    }
  }),
]

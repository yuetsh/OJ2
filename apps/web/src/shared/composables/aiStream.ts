import { streamAI } from "utils/stream"

/**
 * 组件里发 AI 流式请求：同一时刻只跑一条（再点一次会先掐掉上一条），组件卸载时
 * 自动中止 —— 原来班级分析、班级 PK 两处离开页面后流还在跑，白占一个 AI 名额。
 *
 * - `waiting`：请求发出、第一个字还没到。按钮 loading、占位转圈用它
 * - `running`：整条流还没结束
 *
 * `run` 失败时抛 Error（message 可直接给用户看）；被中止时静默返回，不抛。
 */
export function useAIStream() {
  const waiting = ref(false)
  const running = ref(false)
  let controller: AbortController | null = null

  function abort() {
    controller?.abort()
    controller = null
    waiting.value = false
    running.value = false
  }

  async function run<Done = Record<string, unknown>>(
    path: string,
    body: unknown,
    handlers: {
      onDelta: (content: string) => void
      onDone?: (data: Done) => void
    },
  ) {
    abort()
    const own = new AbortController()
    controller = own
    waiting.value = true
    running.value = true
    try {
      await streamAI<Done>(path, body, {
        ...handlers,
        signal: own.signal,
        onDelta(content) {
          waiting.value = false
          handlers.onDelta(content)
        },
      })
    } catch (error) {
      if (own.signal.aborted) return
      throw error
    } finally {
      // 被下一次 run 顶掉的那条不碰状态，状态归新的那条管
      if (controller === own) {
        controller = null
        waiting.value = false
        running.value = false
      }
    }
  }

  if (getCurrentScope()) onScopeDispose(abort)

  return { waiting, running, run, abort }
}

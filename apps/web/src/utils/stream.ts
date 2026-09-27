import { handleGlobalApiError } from "./api"

export interface JSONEventStreamHandlers<T = any> {
  onMessage: (data: T, event?: string) => void
  onEvent?: (event: string) => void
  signal?: AbortSignal | null
}

export async function consumeJSONEventStream<T = any>(
  response: Response,
  handlers: JSONEventStreamHandlers<T>,
) {
  if (!response.body) {
    throw new Error("当前环境不支持可读流")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""

  const { onMessage, onEvent, signal } = handlers

  const handleEvent = (raw: string) => {
    const lines = raw.split("\n")
    let eventName: string | undefined
    const dataLines: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith("event:")) {
        eventName = trimmed.slice(6).trim()
      } else if (trimmed.startsWith("data:")) {
        dataLines.push(trimmed.slice(5).trim())
      }
    }

    if (dataLines.length === 0) {
      if (eventName && onEvent) {
        onEvent(eventName)
      }
      return
    }

    const payloadStr = dataLines.join("\n")

    let parsed: T
    try {
      parsed = JSON.parse(payloadStr)
    } catch (error) {
      throw new Error(`无法解析服务端事件数据: ${payloadStr}`)
    }

    onMessage(parsed, eventName)
  }

  const processBuffer = (flush = false) => {
    let idx = buffer.indexOf("\n\n")
    while (idx !== -1) {
      const rawEvent = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      if (rawEvent.trim()) {
        handleEvent(rawEvent)
      }
      idx = buffer.indexOf("\n\n")
    }

    if (flush && buffer.trim()) {
      handleEvent(buffer.trim())
      buffer = ""
    }
  }

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        break
      }

      const { value, done } = await reader.read()
      if (value) {
        buffer += decoder.decode(value, { stream: true })
        processBuffer()
      }

      if (done) {
        buffer += decoder.decode()
        processBuffer(true)
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * AI 端点的非 2xx 响应体是 JSON 不是 SSE，直接丢给上面的解析器只会抛
 * 「无法解析服务端事件数据: {...}」。后端 error.message 是英文的，按 code 换成中文。
 *
 * 登录失效 / 账号禁用走和 axios 拦截器同一套处理（弹登录框 / 提示禁用）——
 * 原来这里裸 fetch 绕过了拦截器，未登录时只显示一句「AI 分析生成失败」。
 */
async function aiStreamError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string }
  } | null
  const code = body?.error?.code ?? "network-error"
  handleGlobalApiError(code, body?.error?.message)
  switch (code) {
    case "login-required":
      return new Error("请先登录")
    case "account-disabled":
      return new Error("账号已被禁用，请联系老师")
    case "too-many-requests":
      return new Error("AI 请求太频繁了，歇一会儿再试")
    case "hint-locked":
      return new Error("再多试几次，AI 提示会自动解锁")
    case "contest-hint-disabled":
      return new Error("比赛中不提供 AI 提示")
    case "permission-denied":
      return new Error("没有权限使用这个功能")
    default:
      return new Error("AI 分析生成失败")
  }
}

/** AI 流的事件形状，和 apps/api/src/services/ai.ts 的 streamChat / streamWhole 一致 */
type AIStreamEvent =
  | { type: "delta"; content?: string }
  | { type: "error"; message?: string }
  | ({ type: "done" } & Record<string, unknown>)

export interface AIStreamHandlers<Done> {
  onDelta: (content: string) => void
  /** done 事件里后端并进来的额外字段（比如 AI 提示的 hintId / level） */
  onDone?: (data: Done) => void
  signal?: AbortSignal
}

/**
 * 发起一次 AI 流式请求并读到结束。学情分析、班级分析、班级 PK、AI 提示四个入口共用 ——
 * 原来是四份几乎一样的 fetch + SSE 解析，错误处理各漏各的。
 *
 * 失败抛 Error，`message` 是能直接给用户看的中文（后端下发的错误文案本来就是固定的
 * 中文，见 services/ai.ts 的 CLIENT_ERROR_MESSAGE）。被 abort 时抛 AbortError，
 * 调用方一般用 `useAIStream` 就不用自己分辨。
 */
export async function streamAI<Done = Record<string, unknown>>(
  path: string,
  body: unknown,
  handlers: AIStreamHandlers<Done>,
) {
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })
  if (!response.ok) throw await aiStreamError(response)
  await consumeJSONEventStream<AIStreamEvent>(response, {
    signal: handlers.signal,
    onMessage(event) {
      if (event.type === "delta") {
        if (event.content) handlers.onDelta(event.content)
      } else if (event.type === "error") {
        throw new Error(event.message || "AI 服务异常")
      } else if (event.type === "done") {
        handlers.onDone?.(event as Done)
      }
    },
  })
}

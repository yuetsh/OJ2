import { config } from "../config"

interface ChatMessage {
  role: "system" | "user"
  content: string
}

function requestBody(messages: ChatMessage[], stream: boolean) {
  return {
    model: config.aiModel,
    messages,
    stream,
    temperature: 0,
    thinking: { type: "disabled" },
  }
}

/**
 * 非流式调用的超时。fetch 默认不超时，AI 侧一挂就会把 worker 的并发位一直占着，
 * 学生那边的按钮也就一直转。流式调用不设：那边超时会把正在推的长回答直接掐断，
 * 客户端断开本来就能收尾。
 */
const COMPLETE_TIMEOUT_MS = 60_000

export async function completeChat(system: string, user: string) {
  if (!config.aiKey) throw new Error("缺少 AI_KEY")
  const response = await fetch(new URL("/chat/completions", config.aiBaseUrl), {
    method: "POST",
    signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.aiKey}`,
    },
    body: JSON.stringify(
      requestBody(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        false,
      ),
    ),
  })
  if (!response.ok)
    throw new Error(
      `AI provider returned HTTP ${response.status}: ${await response.text()}`,
    )
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return payload.choices?.[0]?.message?.content?.trim() ?? ""
}

export interface StreamChatHooks {
  /**
   * 生成完整结束后调，拿到的是全文。**返回的对象会并进 `done` 事件**，
   * 用来把落库之后才有的东西（比如 ai_hint 的 id）交给前端。
   */
  onComplete?: (value: string) => Promise<Record<string, unknown> | void>
  /**
   * 生成失败时调（没配 AI_KEY、provider 报错、流中途断掉）。只用来留痕，
   * 抛出的异常会被吞掉 —— 记录失败不该再搅乱这条流本身的收尾。
   */
  onError?: (message: string) => Promise<void>
}

export function streamChat(
  system: string,
  user: string,
  hooks: StreamChatHooks = {},
) {
  const encoder = new TextEncoder()
  const reportError = (message: string) =>
    hooks.onError?.(message).catch((error) => {
      console.error("streamChat onError hook failed", error)
    })
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: string) => controller.enqueue(encoder.encode(value))
      if (!config.aiKey) {
        await reportError("缺少 AI_KEY")
        send(
          `data: ${JSON.stringify({ type: "error", message: "缺少 AI_KEY" })}\n\n`,
        )
        send("event: end\n\n")
        controller.close()
        return
      }
      try {
        const response = await fetch(
          new URL("/chat/completions", config.aiBaseUrl),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${config.aiKey}`,
            },
            body: JSON.stringify(
              requestBody(
                [
                  { role: "system", content: system },
                  { role: "user", content: user },
                ],
                true,
              ),
            ),
          },
        )
        if (!response.ok || !response.body)
          throw new Error(
            `AI provider returned HTTP ${response.status}: ${await response.text()}`,
          )
        send("event: start\n\n")
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        const chunks: string[] = []
        while (true) {
          const { done, value } = await reader.read()
          buffer += decoder.decode(value, { stream: !done })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          for (const raw of lines) {
            const line = raw.trim()
            if (!line.startsWith("data:")) continue
            const data = line.slice(5).trim()
            if (data === "[DONE]") continue
            try {
              const item = JSON.parse(data) as {
                choices?: Array<{
                  delta?: { content?: string }
                  finish_reason?: string | null
                }>
              }
              const choice = item.choices?.[0]
              const content = choice?.delta?.content
              if (content) {
                chunks.push(content)
                send(`data: ${JSON.stringify({ type: "delta", content })}\n\n`)
              }
            } catch {
              // Provider keepalive or a partial non-data line.
            }
          }
          if (done) break
        }
        const full = chunks.join("").trim()
        const extra = hooks.onComplete
          ? await hooks.onComplete(full)
          : undefined
        send(`data: ${JSON.stringify({ ...extra, type: "done" })}\n\n`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // 先留痕再回前端：客户端已经断开的话下面这个 send 自己也会抛
        await reportError(message)
        send(`data: ${JSON.stringify({ type: "error", message })}\n\n`)
      } finally {
        send("event: end\n\n")
        controller.close()
      }
    },
  })
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  })
}

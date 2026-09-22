import { config } from "../config"

interface ChatMessage {
  role: "system" | "user"
  content: string
}

function requestBody(messages: ChatMessage[], stream: boolean, json = false) {
  return {
    model: config.aiModel,
    messages,
    stream,
    temperature: 0,
    thinking: { type: "disabled" },
    // DeepSeek 的 JSON 模式：保证回的是合法 JSON，但 prompt 里得出现「json」字样
    ...(json ? { response_format: { type: "json_object" } } : {}),
  }
}

/**
 * 非流式调用的超时。fetch 默认不超时，AI 侧一挂就会把 worker 的并发位一直占着，
 * 学生那边的按钮也就一直转。流式调用不设：那边超时会把正在推的长回答直接掐断，
 * 客户端断开本来就能收尾。
 */
const COMPLETE_TIMEOUT_MS = 60_000

export async function completeChat(
  system: string,
  user: string,
  options: { json?: boolean; timeoutMs?: number } = {},
) {
  if (!config.aiKey) throw new Error("缺少 AI_KEY")
  const response = await fetch(new URL("/chat/completions", config.aiBaseUrl), {
    method: "POST",
    signal: AbortSignal.timeout(options.timeoutMs ?? COMPLETE_TIMEOUT_MS),
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
        options.json,
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

/**
 * 整段生成、拿到全文之后一次性推给前端（AI 时代 OJ 设计 2.6）。
 *
 * AI 提示走这条而不是 `streamChat`：提示要过**输出后过滤**，而边流式边过滤做不到 ——
 * 发现违规时内容已经在学生屏幕上了。所以 `produce` 里把生成、过滤、重生成、落库全
 * 做完，再把定稿的全文当**一个 delta** 发出去，逐字显示交给前端模拟。
 *
 * 事件形状和 `streamChat` 完全一样（start / delta / done / error + `event: end`），
 * 前端那套 `consumeJSONEventStream` 不用分叉。`event: start` 在 `produce` 之前就发，
 * 学生那边的等待态和原来一样先亮起来。
 *
 * **`produce` 期间必须发心跳。** 这条流和 `streamChat` 最大的不同是中间有一大段静默：
 * 诊断 20s + 生成 60s + 重生成 60s，最坏能到 140 秒，而 NPM / nginx 的
 * `proxy_read_timeout` 默认就是 60 秒 —— 超了学生看到「请求失败」，后端却还在烧第二次
 * 调用，而且那条提示照样落库、照样把等级推上去（学生白花一级）。所以每
 * `HEARTBEAT_MS` 发一行 SSE 注释：前端 `utils/stream.ts` 只认 `event:` / `data:` 开头的
 * 行，注释行被静默跳过，不用改前端。
 */
export function streamWhole(
  produce: () => Promise<{ content: string; extra?: Record<string, unknown> }>,
  hooks: { onError?: (message: string) => Promise<void> } = {},
) {
  const encoder = new TextEncoder()
  // 反代的读超时是 60s（见上），取它的四分之一，够抗一次抖动
  const HEARTBEAT_MS = 15_000
  let closed = false
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 学生关掉页面之后 enqueue 会抛，而这时 produce 还在跑（留痕要它跑完），
      // 所以 send 自己吞掉异常并记下「已经断了」，后面几步不用各写一遍 try
      const send = (value: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(value))
        } catch {
          closed = true
        }
      }
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS)
      try {
        send("event: start\n\n")
        const { content, extra } = await produce()
        send(`data: ${JSON.stringify({ type: "delta", content })}\n\n`)
        send(`data: ${JSON.stringify({ ...extra, type: "done" })}\n\n`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // 先留痕再回前端
        await hooks.onError?.(message).catch((e) => {
          console.error("streamWhole onError hook failed", e)
        })
        send(`data: ${JSON.stringify({ type: "error", message })}\n\n`)
      } finally {
        clearInterval(heartbeat)
        send("event: end\n\n")
        if (!closed) controller.close()
      }
    },
    cancel() {
      closed = true
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

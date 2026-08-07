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

export async function completeChat(system: string, user: string) {
  if (!config.aiKey) throw new Error("缺少 AI_KEY")
  const response = await fetch(new URL("/chat/completions", config.aiBaseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.aiKey}` },
    body: JSON.stringify(requestBody([
      { role: "system", content: system },
      { role: "user", content: user },
    ], false)),
  })
  if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}: ${await response.text()}`)
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return payload.choices?.[0]?.message?.content?.trim() ?? ""
}

export function streamChat(
  system: string,
  user: string,
  onComplete?: (value: string) => Promise<void>,
) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: string) => controller.enqueue(encoder.encode(value))
      if (!config.aiKey) {
        send(`data: ${JSON.stringify({ type: "error", message: "缺少 AI_KEY" })}\n\n`)
        send("event: end\n\n")
        controller.close()
        return
      }
      try {
        const response = await fetch(new URL("/chat/completions", config.aiBaseUrl), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.aiKey}` },
          body: JSON.stringify(requestBody([
            { role: "system", content: system },
            { role: "user", content: user },
          ], true)),
        })
        if (!response.ok || !response.body) throw new Error(`AI provider returned HTTP ${response.status}: ${await response.text()}`)
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
              const item = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }> }
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
        if (onComplete) await onComplete(full)
        send(`data: ${JSON.stringify({ type: "done" })}\n\n`)
      } catch (error) {
        send(`data: ${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) })}\n\n`)
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

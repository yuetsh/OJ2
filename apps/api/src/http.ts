import type { Context } from "hono"
import type { z } from "zod"

export function success<T>(c: Context, data: T, status = 200) {
  return c.json({ data }, status as 200)
}

export function failure(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 501 | 502,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status)
}

/**
 * 读 JSON 请求体并按契约校验。body 不是合法 JSON 时按 `null` 交给 schema，
 * 由 schema 统一判失败 —— 原来每个 handler 都手写一遍 `c.req.json().catch(() => null)`，
 * 漏写 `.catch` 就是一个畸形请求打出 500。
 */
export async function readJson<S extends z.ZodType>(c: Context, schema: S) {
  return schema.safeParse(await c.req.json().catch(() => null))
}

/**
 * `readJson` + 校验失败时的 400。绝大多数入参端点就是这个形状：
 *
 *   const parsed = await parseBody(c, schema, "标签名不能为空")
 *   if (!parsed.success) return parsed.response
 *
 * 不给 `message` 就回 zod 的第一条 issue（后台表单要告诉老师具体哪一栏不对）。
 * 失败时要带别的错误码、或者和路径参数一起判的，用 `readJson` 自己写。
 */
export async function parseBody<S extends z.ZodType>(
  c: Context,
  schema: S,
  message?: string,
): Promise<{ success: true; data: z.output<S> } | { success: false; response: Response }> {
  const parsed = await readJson(c, schema)
  if (parsed.success) return { success: true, data: parsed.data }
  return {
    success: false,
    response: failure(
      c,
      400,
      "invalid-request",
      // issues 不会是空的，?? 只是给类型一个交代
      message ?? parsed.error.issues[0]?.message ?? "参数错误",
    ),
  }
}

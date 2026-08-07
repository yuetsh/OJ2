import type { Context } from "hono"

export function success<T>(c: Context, data: T, status = 200) {
  return c.json({ data }, status as 200)
}

export function failure(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status)
}

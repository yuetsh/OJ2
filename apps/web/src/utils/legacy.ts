import type { ApiResponse } from "./http"

/**
 * 新后端一律 camelCase，而现存组件读的都是旧 Django 的 snake_case。
 * 迁移期在 api 层做一次键名转换，组件不动 —— 否则每搬一个端点就要顺带改一堆 .vue，
 * 改动面大到没法一个个验。
 *
 * 迁移完成后这一层应当整体拆掉，届时组件改成 camelCase 是一次性的机械替换。
 */
function snakeKey(key: string) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export function toLegacy<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => toLegacy(item)) as T
  if (!value || typeof value !== "object") return value as T
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [snakeKey(key), toLegacy(item)]),
  ) as T
}

export async function legacyResponse<T>(
  request: Promise<ApiResponse<unknown>>,
): Promise<ApiResponse<T>> {
  const response = await request
  return { error: response.error, data: toLegacy<T>(response.data) }
}

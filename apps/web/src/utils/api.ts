import { createDiscreteApi } from "naive-ui"
import { useAuthModalStore } from "shared/store/authModal"
import { authFetch } from "./auth"
import { STORAGE_KEY } from "./constants"
import storage from "./storage"

const { message: toast } = createDiscreteApi(["message"])

/** 后端失败响应体的形状，见 apps/api/src/http.ts 的 failure */
interface ErrorPayload {
  error?: {
    code?: string
    message?: string
  }
}

/**
 * 请求失败时抛的就是它：`error` 是错误码，`data` 是后端文案。
 *
 * 字段名沿用原来那个裸对象 `{ error, data }`，存量调用点读 `err.error` / `err.data`
 * 的语义不变；做成 Error 的子类是为了在 catch 里能和代码 bug（TypeError 之类）分开，
 * 也顺带有了堆栈。catch 块里别写 `err: any`，用下面的 errorCode / errorMessage。
 */
export class ApiError extends Error {
  constructor(
    readonly error: string,
    readonly data: string,
  ) {
    super(data)
    this.name = "ApiError"
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

/** 接口错误的错误码；不是接口错误（代码 bug、被中止……）就是 undefined */
export function errorCode(err: unknown) {
  return isApiError(err) ? err.error : undefined
}

/** 给用户看的文案：接口错误用后端文案，其它一律 fallback —— 别把 TypeError 的英文甩给学生 */
export function errorMessage(err: unknown, fallback = "未知错误") {
  return isApiError(err) && err.data ? err.data : fallback
}

/**
 * 这几种错误全站都是同样的处理，不放在这里的话每个调用点都得自己 catch，
 * 漏一个就是「点了没反应」。需要分支处理的调用方一律判 `err.error` 里的
 * 错误码，**不要**去 match `err.data` 的文案 —— 文案是后端可以随时改的。
 *
 * 导出给不走 api 客户端的请求用（AI 的流式接口，见 utils/stream.ts）——
 * 同一个错误码从两条路进来，学生看到的结果不该有两个样子。
 */
/** handleGlobalApiError 已经替调用方提示过的错误码，调用方别再弹第二遍 */
export const GLOBALLY_HANDLED_CODES: readonly string[] = [
  "login-required",
  "account-disabled",
  "permission-denied",
]

export function handleGlobalApiError(code: string, message?: string) {
  if (code === "login-required") {
    storage.remove(STORAGE_KEY.AUTHED)
    useAuthModalStore().openLoginModal()
  } else if (code === "account-disabled") {
    // 这里**不能**弹登录框：账号已经被禁用，登进去还是会被拒，
    // 学生会陷入「弹框 → 登录 → 又弹框」的死循环，且看不出发生了什么。
    // 清掉登录态并明确告知，会话在中途被禁用时也走这一支。
    storage.remove(STORAGE_KEY.AUTHED)
    toast.error("账号已被禁用，请联系老师")
  } else if (code === "permission-denied") {
    toast.error(message || "权限不足")
  }
}

const NETWORK_ERROR_MESSAGE = "网络异常，请检查网络后重试"

interface RequestConfig {
  /** 拼进 query string。值是 ""、null、undefined 的键直接丢掉，调用方不用自己挑 */
  params?: Record<string, unknown>
  /** 请求体，只给 delete 用：别的方法的请求体走第二个参数 */
  data?: unknown
}

function withQuery(url: string, params?: Record<string, unknown>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== "" && value !== null && value !== undefined) query.append(key, String(value))
  }
  const search = query.toString()
  return search ? `${url}?${search}` : url
}

async function request<T>(method: string, url: string, body: unknown, config: RequestConfig = {}) {
  const init: RequestInit = { method }
  // FormData 不能手动设 Content-Type：multipart 的 boundary 得让浏览器自己写进去
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" }
    init.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await authFetch(withQuery(`/api/${url}`, config.params), init)
  } catch {
    // 请求根本没到后端（断网、反代挂了），学生看到的就是这一句
    throw new ApiError("network-error", NETWORK_ERROR_MESSAGE)
  }
  const payload = (await response.json().catch(() => null)) as ({ data?: T } & ErrorPayload) | null
  if (response.ok) return payload?.data as T

  // 没有 JSON 信封 = 不是后端回的（网关的错误页之类），当网络问题
  const code = payload?.error?.code ?? "network-error"
  const message = payload?.error?.message ?? NETWORK_ERROR_MESSAGE
  handleGlobalApiError(code, message)
  throw new ApiError(code, message)
}

/**
 * 成功时直接拿到业务数据本身：后端成功响应是 `{ data }`（见 apps/api/src/http.ts
 * 的 success），这层信封在这里剥掉。
 *
 * 失败抛 ApiError，`error` 是错误码、`data` 是文案 —— 和成功路径不对称是故意的：
 * 成功没有错误码可言。分支处理一律判 `err.error` 里的错误码。
 *
 * token 过期换一张重发、换不到当游客重发，都在 authFetch 里，调用方拿到的和一次
 * 成功没有区别。
 */
const api = {
  get: <T>(url: string, config?: RequestConfig) => request<T>("GET", url, undefined, config),
  post: <T>(url: string, data?: unknown, config?: RequestConfig) =>
    request<T>("POST", url, data, config),
  put: <T>(url: string, data?: unknown, config?: RequestConfig) =>
    request<T>("PUT", url, data, config),
  delete: <T>(url: string, config?: RequestConfig) =>
    request<T>("DELETE", url, config?.data, config),
}

export default api

import type { AuthTokens } from "@oj2/contract"
import { STORAGE_KEY } from "./constants"
import storage from "./storage"

/**
 * 登录态的两张 token，存 localStorage。
 *
 * 不用 sessionStorage：「在新标签页打开」是全站常用操作（提交详情、题目、统计……），
 * sessionStorage 不跨标签页，开出去的页面全是未登录。
 *
 * access token 15 分钟过期，到期前由这里拿 refresh token 去换，后端的口径见
 * apps/api/src/auth/session.ts。
 */

/** 剩不到这么久就提前换：别让请求带着还剩两秒的 token 出门、到后端正好过期 */
const REFRESH_AHEAD_MS = 60_000

interface StoredAccess {
  token: string
  /** 本机时钟的毫秒时刻。用后端给的秒数加本机时钟算，机房电脑时钟不准也不受影响 */
  expiresAt: number
}

export function saveTokens(tokens: AuthTokens) {
  storage.set(STORAGE_KEY.ACCESS_TOKEN, {
    token: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  } satisfies StoredAccess)
  // null = 换 token 的宽限期，沿用本地那张，见契约 AuthTokens 的注释
  if (tokens.refreshToken) storage.set(STORAGE_KEY.REFRESH_TOKEN, tokens.refreshToken)
}

export function clearTokens() {
  storage.remove(STORAGE_KEY.ACCESS_TOKEN)
  storage.remove(STORAGE_KEY.REFRESH_TOKEN)
}

export function getRefreshToken(): string | null {
  const value = storage.get(STORAGE_KEY.REFRESH_TOKEN)
  return typeof value === "string" ? value : null
}

function readAccess(): StoredAccess | null {
  const value = storage.get(STORAGE_KEY.ACCESS_TOKEN) as StoredAccess | null
  return value && typeof value.token === "string" && typeof value.expiresAt === "number"
    ? value
    : null
}

/**
 * 换 token 的结果。`network-error` 时**不清** token：断网、后端重启都是暂时的，
 * 清掉等于让学生重新登录；只有后端明确说 refresh token 不认了才清。
 */
export type RefreshOutcome =
  | { token: string; code?: undefined }
  | { token: null; code: "refresh-invalid" | "account-disabled" | "network-error" }

let inflight: Promise<RefreshOutcome> | null = null

/**
 * 拿 refresh token 换一张新的 access token。同一页面里同时只有一次在飞。
 *
 * `stale` 是刚被后端拒掉的那张：排队的这段时间里别的标签页可能已经换过了，
 * 本地存的要是另一张、而且还新鲜，直接用它，不再去换。
 */
export function refreshAccessToken(stale?: string) {
  inflight ??= withRefreshLock(() => runRefresh(stale)).finally(() => (inflight = null))
  return inflight
}

/**
 * 跨标签页排队。`navigator.locks` 只在安全上下文里有，机房走 http 直连 IP 时是
 * undefined —— 那就不排，撞车由后端的宽限期兜住（REFRESH_GRACE_MS）。
 */
function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  return locks ? (locks.request("oj2-token-refresh", task) as Promise<T>) : task()
}

async function runRefresh(stale?: string): Promise<RefreshOutcome> {
  const access = readAccess()
  if (access && access.token !== stale && access.expiresAt - Date.now() > REFRESH_AHEAD_MS) {
    return { token: access.token }
  }
  const refreshToken = getRefreshToken()
  if (!refreshToken) return { token: null, code: "refresh-invalid" }

  let response: Response
  try {
    // 裸 fetch：走 utils/api 的 axios 会再进它的拦截器，绕回这里
    response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
  } catch {
    return { token: null, code: "network-error" }
  }
  const body = (await response.json().catch(() => null)) as {
    data?: AuthTokens
    error?: { code?: string }
  } | null
  if (response.ok && body?.data?.accessToken) {
    saveTokens(body.data)
    return { token: body.data.accessToken }
  }
  const code = body?.error?.code
  if (code === "refresh-invalid" || code === "account-disabled") {
    clearTokens()
    return { token: null, code }
  }
  // 5xx、网关的错误页：当成暂时的，同上
  return { token: null, code: "network-error" }
}

/**
 * 发请求前取一张能用的 access token：快过期了先换。没登录返回 null。
 * 换的时候断网就先用手上这张碰碰运气，后端不认的话请求方会再走一次换 token。
 */
export async function getAccessToken() {
  const access = readAccess()
  if (access && access.expiresAt - Date.now() > REFRESH_AHEAD_MS) return access.token
  if (!access && !getRefreshToken()) return null
  const outcome = await refreshAccessToken()
  if (outcome.token) return outcome.token
  return outcome.code === "network-error" ? (access?.token ?? null) : null
}

/** 后端回的错误码。读的是副本，原响应体留给调用方 */
async function responseCode(response: Response) {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: string } } | null
  return body?.error?.code
}

/**
 * 不走 axios 的请求（AI 流式接口、离开页面时的 keepalive 上报）用它代替 fetch：
 * 带上 token，后端回 `token-expired` 就换一张重试一次 —— 和 utils/api.ts 拦截器
 * 是同一套规矩。
 */
export async function authFetch(input: string, init: RequestInit = {}) {
  const send = (token: string | null) =>
    fetch(input, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  const token = await getAccessToken()
  const response = await send(token)
  if (response.status !== 401 || !token) return response
  if ((await responseCode(response)) !== "token-expired") return response

  const outcome = await refreshAccessToken(token)
  // 账号被禁用：换 token 那一步就知道了，原请求不必再发。造一个和后端同形的响应，
  // 调用方按原样处理（弹「账号已被禁用」而不是登录框）
  if (outcome.code === "account-disabled") {
    return new Response(
      JSON.stringify({ error: { code: "account-disabled", message: "账号已被禁用，请联系老师" } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    )
  }
  // 换不到就拿掉 token 重发：要登录的接口回 login-required 弹登录框，可选登录的当游客
  return send(outcome.token)
}

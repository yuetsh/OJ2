import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios"
import { createDiscreteApi } from "naive-ui"
import { useAuthModalStore } from "shared/store/authModal"
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
 * 拦截器 reject 出来的就是它：`error` 是错误码，`data` 是后端文案。
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
 * 成功时直接拿到业务数据本身。后端成功响应是 `{ data }`（见 apps/api/src/http.ts
 * 的 success），拦截器把 axios 外层和这层信封一起剥掉。
 *
 * 失败走 reject，形状是 `{ error: 错误码, data: 文案 }` —— 和成功路径不对称是
 * 故意的：成功没有错误码可言。分支处理一律判 `err.error` 里的错误码。
 */
interface ApiClient {
  get<T>(url: string, config?: AxiosRequestConfig): Promise<T>
  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  delete<T>(url: string, config?: AxiosRequestConfig): Promise<T>
}

/**
 * 这几种错误全站都是同样的处理，不放在这里的话每个调用点都得自己 catch，
 * 漏一个就是「点了没反应」。需要分支处理的调用方一律判 `err.error` 里的
 * 错误码，**不要**去 match `err.data` 的文案 —— 文案是后端可以随时改的。
 *
 * 导出给不走 axios 的请求用（AI 的流式接口是裸 fetch，见 utils/stream.ts）——
 * 同一个错误码从两条路进来，学生看到的结果不该有两个样子。
 */
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

const instance = axios.create({
  baseURL: "/api",
  withCredentials: true,
})

instance.interceptors.request.use((config) => {
  if (config.params) {
    config.params = Object.fromEntries(
      Object.entries(config.params).filter(
        ([, value]) => value !== "" && value !== null && value !== undefined,
      ),
    )
  }
  return config
})

instance.interceptors.response.use(
  // 这里**故意**不返回 AxiosResponse：把 axios 的外层和后端的 { data } 信封一起
  // 剥掉，让调用方直接拿到业务数据。类型上和 axios 的拦截器签名对不上（它期望原样
  // 返回响应），文件末尾的 `as unknown as ApiClient` 就是为了把真实形状交出去。
  ((response: AxiosResponse) => response.data.data) as unknown as (
    response: AxiosResponse,
  ) => AxiosResponse,
  (error) => {
    const payload = error.response?.data as ErrorPayload | undefined
    const code = payload?.error?.code ?? "network-error"
    // 没有响应体 = 请求根本没到后端（断网、反代挂了、超时），学生看到的就是这一句
    const message = payload?.error?.message ?? "网络异常，请检查网络后重试"

    handleGlobalApiError(code, message)
    return Promise.reject(new ApiError(code, message))
  },
)

export default instance as unknown as ApiClient

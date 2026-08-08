import axios, { type AxiosRequestConfig } from "axios"
import { createDiscreteApi } from "naive-ui"
import { useAuthModalStore } from "shared/store/authModal"
import { STORAGE_KEY } from "./constants"
import type { ApiResponse } from "./http"
import storage from "./storage"

const { message: toast } = createDiscreteApi(["message"])

interface Api2Error {
  error?: {
    code?: string
    message?: string
  }
}

interface Api2Client {
  get<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
  post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<ApiResponse<T>>
  put<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<ApiResponse<T>>
  delete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
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
  (response) => Promise.resolve({ error: null, data: response.data.data }),
  (error) => {
    const payload = error.response?.data as Api2Error | undefined
    const code = payload?.error?.code ?? "network-error"
    const message = payload?.error?.message ?? "Request failed"
    const legacyMessage =
      code === "invalid-credentials"
        ? "Invalid username or password"
        : code === "account-disabled"
          ? "Your account has been disabled"
          : message

    // 与 utils/http.ts 的拦截器保持一致：这两种错误全站都是同样的处理，
    // 不放在这里的话每个调用点都得自己 catch，漏一个就是「点了没反应」。
    if (code === "login-required") {
      storage.remove(STORAGE_KEY.AUTHED)
      useAuthModalStore().openLoginModal()
    } else if (code === "account-disabled") {
      // 这里**不能**弹登录框：账号已经被禁用，登进去还是会被拒，
      // 学生会陷入「弹框 → 登录 → 又弹框」的死循环，且看不出发生了什么。
      // 清掉登录态并明确告知，会话在中途被禁用时也走这一支。
      storage.remove(STORAGE_KEY.AUTHED)
      toast.error(legacyMessage || "账号已被禁用，请联系老师")
    } else if (code === "permission-denied") {
      toast.error(legacyMessage || "权限不足")
    }

    return Promise.reject({ error: code, data: legacyMessage })
  },
)

export default instance as unknown as Api2Client

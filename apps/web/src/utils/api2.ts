import axios, { type AxiosRequestConfig } from "axios"
import { createDiscreteApi } from "naive-ui"
import { useAuthModalStore } from "shared/store/authModal"
import { STORAGE_KEY } from "./constants"
import storage from "./storage"

const { message: toast } = createDiscreteApi(["message"])

// 后端统一返回 { error, data } 信封；拦截器剥掉 axios 外层后，
// 调用方拿到的就是这个信封，data 才是真正的业务数据。
export interface ApiResponse<T = any> {
  error: string | null
  data: T
}

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

    // 这几种错误全站都是同样的处理，不放在这里的话每个调用点都得自己 catch，
    // 漏一个就是「点了没反应」。需要分支处理的调用方一律判 `err.error` 里的
    // 错误码，**不要**去 match `err.data` 的文案 —— 文案是后端可以随时改的。
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

    return Promise.reject({ error: code, data: message })
  },
)

export default instance as unknown as Api2Client

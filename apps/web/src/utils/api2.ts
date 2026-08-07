import axios, { type AxiosRequestConfig } from "axios"
import type { ApiResponse } from "./http"

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
  delete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
}

const instance = axios.create({
  baseURL: "/api2",
  withCredentials: true,
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
    return Promise.reject({ error: code, data: legacyMessage })
  },
)

export default instance as unknown as Api2Client

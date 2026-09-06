import axios from "axios"
import { createDiscreteApi } from "naive-ui"

// 指向新后端的 /api/admin。响应是 zip 二进制，不走 { error, data } 信封，
// 所以不能复用 utils/api 的拦截器（它会把 response.data.data 取出来）。
const http = axios.create({
  baseURL: "/api/admin",
  responseType: "blob",
  withCredentials: true,
})

// 脱离 n-message-provider 也能弹，理由同 utils/api.ts
const { message: toast } = createDiscreteApi(["message"])

/**
 * 失败时把错误信封读出来。`responseType: "blob"` 是给成功路径（zip）设的，
 * 出错时 axios 照样把 JSON 信封包成 Blob 交回来，直接 `.error.message` 取不到。
 */
async function failureMessage(error: unknown) {
  const data = (error as { response?: { data?: unknown } }).response?.data
  if (data instanceof Blob) {
    try {
      const payload = JSON.parse(await data.text())
      const message = payload?.error?.message
      if (typeof message === "string" && message) return message
    } catch {
      // 不是 JSON（网关的 HTML 错误页之类），走下面的兜底文案
    }
  }
  return "下载失败"
}

async function download(url: string) {
  let res
  try {
    res = await http.get(url)
  } catch (error) {
    // 以前这里什么都不接：题目还没传测试点时后端回 404，页面上一点反应都没有
    toast.error(await failureMessage(error))
    return
  }
  const headers = res.headers
  const link = document.createElement("a")
  link.href = window.URL.createObjectURL(
    new window.Blob([res.data], {
      type: String(headers["content-type"] ?? ""),
    }),
  )
  link.download = (headers["content-disposition"] || "").split("filename=")[1]
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export default download

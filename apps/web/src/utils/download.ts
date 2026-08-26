import axios from "axios"

// 指向新后端的 /api/admin。响应是 zip 二进制，不走 { error, data } 信封，
// 所以不能复用 utils/api 的拦截器（它会把 response.data.data 取出来）。
const http = axios.create({
  baseURL: "/api/admin",
  responseType: "blob",
  withCredentials: true,
})

async function download(url: string) {
  const res = await http.get(url)
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

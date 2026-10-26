import { createDiscreteApi } from 'naive-ui'
import { authFetch } from './auth'

// 脱离 n-message-provider 也能弹，理由同 utils/api.ts
const { message: toast } = createDiscreteApi(['message'])

/** 失败时读后端的错误信封；不是 JSON（网关的 HTML 错误页之类）就用兜底文案 */
async function failureMessage(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string }
  } | null
  const message = payload?.error?.message
  return typeof message === 'string' && message ? message : '下载失败'
}

// 指向 /api/admin。响应是 zip 二进制，不走 { error, data } 信封，所以不经 utils/api
async function download(url: string) {
  let response: Response
  try {
    response = await authFetch(`/api/admin/${url}`)
  } catch {
    toast.error('下载失败')
    return
  }
  if (!response.ok) {
    // 以前这里什么都不接：题目还没传测试点时后端回 404，页面上一点反应都没有
    toast.error(await failureMessage(response))
    return
  }
  const link = document.createElement('a')
  link.href = window.URL.createObjectURL(await response.blob())
  link.download = (response.headers.get('content-disposition') || '').split('filename=')[1] ?? ''
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export default download

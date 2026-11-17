import { authFetch } from 'utils/auth'

/** 下载素材：接口要带登录态，所以不能直接 <a href>，取回来再存 */
export async function downloadFile(url: string, name: string) {
  const res = await authFetch(url)
  if (!res.ok) return false
  const href = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  URL.revokeObjectURL(href)
  return true
}

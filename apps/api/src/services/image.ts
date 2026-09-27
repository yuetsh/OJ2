/**
 * 按文件头认图片格式，不信文件名。头像和题面插图原来只看扩展名：改个后缀什么都能
 * 落盘，再由 /public/* 按扩展名配 content-type 发出去。
 *
 * 返回值就是落盘该用的扩展名 —— 以内容为准，一张改名成 .png 的 JPEG 会存成 .jpg，
 * 浏览器拿到的 content-type 才对得上。
 */
const SIGNATURES: [extension: string, bytes: number[]][] = [
  [".png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  [".jpg", [0xff, 0xd8, 0xff]],
  [".gif", [0x47, 0x49, 0x46, 0x38]], // GIF8（GIF87a / GIF89a）
  [".bmp", [0x42, 0x4d]], // BM
]

export async function sniffImageExtension(file: Blob) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  for (const [extension, bytes] of SIGNATURES) {
    if (bytes.every((byte, index) => head[index] === byte)) return extension
  }
  return null
}

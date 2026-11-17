import { LABELING_IMAGE_MAX_SIDE } from '@oj2/contract'

/**
 * 上传前在浏览器里把图缩到长边 1280、存成 JPEG（设计文档第 8 节）：学生多在手机上看，
 * 一节十几张，手机拍的原图一张就好几 MB。本来就小的图也重新编码一遍，统一成 JPEG。
 * Chrome 105 有 createImageBitmap 和 canvas.toBlob，够用。
 */
export async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, LABELING_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')!
  // 透明的 PNG 直接转 JPEG 会变黑底，先铺一层白
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('转换失败'))), 'image/jpeg', 0.85))
}

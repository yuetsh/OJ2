import confetti from "canvas-confetti"
import { getCurrentScope, onScopeDispose } from "vue"

// 表情图标取自 @iconify 的 streamline-emojis 图标集，与项目内 <Icon icon="streamline-emojis:..."> 用法保持一致
const EMOJI_SVGS = [
  // 星星眼
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 48 48"><path fill="#45413c" d="M8 45.5a16 1.5 0 1 0 32 0a16 1.5 0 1 0-32 0" opacity=".15"/><path fill="#ffe500" d="M4 21.5a20 20 0 1 0 40 0a20 20 0 1 0-40 0"/><path fill="#ebcb00" d="M24 1.5a20 20 0 1 0 20 20a20 20 0 0 0-20-20m0 37a18.25 18.25 0 1 1 18.25-18.25A18.25 18.25 0 0 1 24 38.5"/><path fill="#fff48c" d="M18 5.5a6 1.5 0 1 0 12 0a6 1.5 0 1 0-12 0"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M4 21.5a20 20 0 1 0 40 0a20 20 0 1 0-40 0"/><path fill="#ffaa54" d="M38.5 26.5c0 .83-1.12 1.5-2.5 1.5s-2.5-.67-2.5-1.5S34.62 25 36 25s2.5.67 2.5 1.5m-29 0c0 .83 1.12 1.5 2.5 1.5s2.5-.67 2.5-1.5S13.38 25 12 25s-2.5.67-2.5 1.5"/><path fill="#ebcb00" d="m32.13 21.79l-3 1.59a1 1 0 0 1-1.45-1.05l.55-3.33a1 1 0 0 0-.29-.89l-2.45-2.38a1 1 0 0 1 .56-1.73l3.38-.49a1 1 0 0 0 .75-.55l1.52-3.09a1 1 0 0 1 1.79 0L35 12.94a1 1 0 0 0 .75.55l3.38.49a1 1 0 0 1 .56 1.71l-2.45 2.38A1 1 0 0 0 37 19l.58 3.37a1 1 0 0 1-1.45 1.05l-3-1.59a1 1 0 0 0-1-.04"/><path fill="#fffacf" d="m33.69 19.35l-3 1.59a1 1 0 0 1-1.45-1.05l.57-3.37a1 1 0 0 0-.28-.89l-2.45-2.38a1 1 0 0 1 .55-1.71l3.37-.49a1 1 0 0 0 .75-.55l1.51-3.07a1 1 0 0 1 1.8 0l1.51 3.07a1 1 0 0 0 .75.55l3.39.49a1 1 0 0 1 .55 1.71l-2.45 2.38a1 1 0 0 0-.29.89l.58 3.37a1 1 0 0 1-1.45 1.05l-3-1.59a1 1 0 0 0-.96 0"/><path fill="#fff48c" d="m38.81 18.2l-3.06-1.61a1.38 1.38 0 0 0-1.31 0l-4.25 2.23a1.35 1.35 0 0 1-.82.16l-.16.91a1 1 0 0 0 1.46 1.05l3-1.59a1 1 0 0 1 .93 0l3 1.59a1 1 0 0 0 1.45-1.05Z"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="m33.69 19.35l-3 1.59a1 1 0 0 1-1.45-1.05l.57-3.37a1 1 0 0 0-.28-.89l-2.45-2.38a1 1 0 0 1 .55-1.71l3.37-.49a1 1 0 0 0 .75-.55l1.51-3.07a1 1 0 0 1 1.8 0l1.51 3.07a1 1 0 0 0 .75.55l3.39.49a1 1 0 0 1 .55 1.71l-2.45 2.38a1 1 0 0 0-.29.89l.58 3.37a1 1 0 0 1-1.45 1.05l-3-1.59a1 1 0 0 0-.96 0"/><path fill="#ebcb00" d="m15.87 21.79l3 1.59a1 1 0 0 0 1.45-1.05L19.77 19a1 1 0 0 1 .29-.89l2.45-2.38A1 1 0 0 0 22 14l-3.38-.49a1 1 0 0 1-.75-.55L16.3 9.87a1 1 0 0 0-1.79 0L13 12.94a1 1 0 0 1-.75.55L8.86 14a1 1 0 0 0-.56 1.71l2.45 2.38A1 1 0 0 1 11 19l-.58 3.37a1 1 0 0 0 1.45 1.05l3-1.59a1 1 0 0 1 1-.04"/><path fill="#fffacf" d="m14.31 19.35l3 1.59a1 1 0 0 0 1.45-1.05l-.57-3.37a1 1 0 0 1 .28-.89l2.45-2.38a1 1 0 0 0-.55-1.71L17 11.05a1 1 0 0 1-.75-.55l-1.51-3.07a1 1 0 0 0-1.8 0l-1.51 3.07a1 1 0 0 1-.75.55l-3.39.49a1 1 0 0 0-.55 1.71l2.45 2.38a1 1 0 0 1 .29.89l-.58 3.37a1 1 0 0 0 1.45 1.05l3-1.59a1 1 0 0 1 .96 0"/><path fill="#fff48c" d="m9.19 18.2l3.06-1.61a1.38 1.38 0 0 1 1.31 0l4.25 2.23a1.35 1.35 0 0 0 .82.16l.16.91a1 1 0 0 1-1.46 1.05l-3-1.59a1 1 0 0 0-.93 0l-3 1.59a1 1 0 0 1-1.5-1.05Z"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="m14.31 19.35l3 1.59a1 1 0 0 0 1.45-1.05l-.57-3.37a1 1 0 0 1 .28-.89l2.45-2.38a1 1 0 0 0-.55-1.71L17 11.05a1 1 0 0 1-.75-.55l-1.51-3.07a1 1 0 0 0-1.8 0l-1.51 3.07a1 1 0 0 1-.75.55l-3.39.49a1 1 0 0 0-.55 1.71l2.45 2.38a1 1 0 0 1 .29.89l-.58 3.37a1 1 0 0 0 1.45 1.05l3-1.59a1 1 0 0 1 .96 0"/><path fill="#fff" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M24 38.5a10.9 10.9 0 0 0 11-9.17a1 1 0 0 0-.31-.84a1.12 1.12 0 0 0-.91-.27a61.6 61.6 0 0 1-19.54 0a1.12 1.12 0 0 0-.91.27a1 1 0 0 0-.31.84A10.9 10.9 0 0 0 24 38.5"/><path fill="#fff" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M34 32.5A30.2 30.2 0 0 1 24 34a30.2 30.2 0 0 1-10-1.5"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M24 29v9.5m-6.5-9.84c0 .6-.05 5.75 1.06 8.49m11.94-8.49c0 .6.05 5.75-1.06 8.49"/></svg>',
  // 点赞
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 48 48"><path fill="#45413c" d="M13 45.5a11 1.5 0 1 0 22 0a11 1.5 0 1 0-22 0" opacity=".15"/><path fill="#ffe500" d="M37.17 30.42h.18a2.54 2.54 0 1 0 0-5.08h-2.54a2.55 2.55 0 0 0 0-5.09h-6.12c.58-1.44 1.32-3.71 2-5.87a4.18 4.18 0 0 0-2.77-5.2a1.08 1.08 0 0 0-1.36.72c-.86 2.94-1.5 6.65-6 10a18.2 18.2 0 0 0-4 4.34a4 4 0 0 1-3.2 1.7H9.79a1 1 0 0 0-1 1v11.12a1 1 0 0 0 1 1h2.49c3.28.08 4.7 1.31 8.79 1.31h13.47a2.25 2.25 0 0 0 0-4.5h2.63a2.73 2.73 0 0 0 0-5.45"/><path fill="#fff48c" d="M14.34 28.63a3.93 3.93 0 0 0 3.19-1.7a18 18 0 0 1 4-4.34c4.5-3.32 5.15-7 6-10a1.08 1.08 0 0 1 1.35-.72a4.1 4.1 0 0 1 1.91 1.23a4.19 4.19 0 0 0-2.95-4a1.08 1.08 0 0 0-1.36.72c-.86 2.94-1.5 6.65-6 10a18.2 18.2 0 0 0-4 4.34a4 4 0 0 1-3.2 1.7H9.79a1 1 0 0 0-1 1v1.72Z"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="m28.37 26.07l-.06.12a11.41 11.41 0 0 1-8.68 6.22h0"/><path fill="#ffe500" d="M25.39 35.87h11.4v4.5h-11.4Z"/><path fill="#ffe500" d="M24.71 30.42h15.18v5.45H24.71Z"/><path fill="#ffe500" d="M24.71 25.34h15.18v5.09H24.71Zm.68-5.09h11.96v5.09H25.39Z"/><path fill="#fff48c" d="M27.93 22.34h6.88a2.56 2.56 0 0 1 2.32 1.5a2.6 2.6 0 0 0 .22-1.05a2.54 2.54 0 0 0-2.54-2.54h-6.88a2.54 2.54 0 0 0-2.54 2.54a2.6 2.6 0 0 0 .22 1.05a2.56 2.56 0 0 1 2.32-1.5"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M25.39 35.87h11.4v4.5h-11.4Z"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M24.71 30.42h15.18v5.45H24.71Z"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M24.71 25.34h15.18v5.09H24.71Zm.68-5.09h11.96v5.09H25.39Z"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M37.17 30.42h.18a2.54 2.54 0 1 0 0-5.08h-2.54a2.55 2.55 0 0 0 0-5.09h-6.12c.58-1.44 1.32-3.71 2-5.87a4.18 4.18 0 0 0-2.77-5.2a1.08 1.08 0 0 0-1.36.72c-.86 2.94-1.5 6.65-6 10a18.2 18.2 0 0 0-4 4.34a4 4 0 0 1-3.2 1.7H9.79a1 1 0 0 0-1 1v11.12a1 1 0 0 0 1 1h2.49c3.28.08 4.7 1.31 8.79 1.31h13.47a2.25 2.25 0 0 0 0-4.5h2.63a2.73 2.73 0 0 0 0-5.45"/></svg>',
  // 火箭
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 48 48"><path fill="#ff6242" d="m14.05 26.58l5.67-7a19.55 19.55 0 0 0-8.5-.24c-3.12.77-3.61 6.66-3.66 9.45a.87.87 0 0 0 1.31.77Z"/><path fill="#ff866e" d="M11.24 22a18.2 18.2 0 0 1 6.62-.13l1.86-2.28a19.55 19.55 0 0 0-8.5-.24c-3.12.76-3.61 6.65-3.66 9.44a.85.85 0 0 0 .14.48c.3-2.94 1.09-6.66 3.54-7.27"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="m14.05 26.58l5.67-7a19.55 19.55 0 0 0-8.5-.24c-3.12.77-3.61 6.66-3.66 9.45a.87.87 0 0 0 1.31.77Z"/><path fill="#ff6242" d="m20.86 33.4l7-5.67a19.5 19.5 0 0 1 .24 8.49c-.73 3.12-6.58 3.61-9.41 3.66a.87.87 0 0 1-.77-1.31Z"/><path fill="#ff866e" d="M25.41 36.21a18 18 0 0 0 .13-6.63l2.28-1.85a19.5 19.5 0 0 1 .24 8.49c-.73 3.12-6.58 3.61-9.41 3.66a.87.87 0 0 1-.48-.14c2.94-.26 6.66-1.09 7.24-3.53"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="m20.86 33.4l7-5.67a19.5 19.5 0 0 1 .24 8.49c-.73 3.12-6.58 3.61-9.41 3.66a.87.87 0 0 1-.77-1.31Z"/><path fill="#e8f4fa" d="M39.48 21.56c5.42-5.7 3.71-12.73 2.86-15.2a2 2 0 0 0-.48-.78a2.1 2.1 0 0 0-.77-.48c-2.47-.85-9.51-2.56-15.21 2.9C18.84 14.66 14 26.5 14 26.5l7 7s11.78-4.9 18.48-11.94"/><path fill="#fff" d="M28.05 11.87c5.53-5.27 12.31-3.8 15-2.94a17 17 0 0 0-.66-2.57a2 2 0 0 0-1.3-1.26c-2.47-.85-9.51-2.56-15.21 2.9C18.84 14.66 14 26.5 14 26.5l2.69 2.69c1.43-3.19 5.68-11.92 11.36-17.32"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M39.48 21.56c5.42-5.7 3.71-12.73 2.86-15.2a2 2 0 0 0-.48-.78a2.1 2.1 0 0 0-.77-.48c-2.47-.85-9.51-2.56-15.21 2.9C18.84 14.66 14 26.5 14 26.5l7 7s11.78-4.9 18.48-11.94"/><path fill="#45413c" d="M18.22 44.21a10 1.5 0 1 0 20 0a10 1.5 0 1 0-20 0" opacity=".15"/><path fill="#ff6242" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M22.7 25.65a.68.68 0 0 0-.92-.93a22.1 22.1 0 0 0-5.31 3.8a17.8 17.8 0 0 0-3.87 5.86a.34.34 0 0 0 .44.45A17.8 17.8 0 0 0 18.9 31a21.9 21.9 0 0 0 3.8-5.35"/><path fill="#c0dceb" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M28.24 13.72a5.49 5.49 0 1 0 10.98 0a5.49 5.49 0 1 0-10.98 0"/><path fill="#00b8f0" d="M29.96 13.69a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0-7.6 0"/><path fill="#4acfff" d="M31.07 11a3.8 3.8 0 0 0 0 5.38a4 4 0 0 0 .85.62l3.55-6.69a3.77 3.77 0 0 0-4.4.69"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M29.96 13.69a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0-7.6 0"/><path fill="#ff8a14" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M11.34 41.47c-.7.7-5.16 2.21-7.42 2.94c-.42.14-1-.47-.89-.89c.73-2.25 2.24-6.71 3-7.42c.95-1 3.43-1 4.91.46s1.35 3.96.4 4.91"/><path fill="#ffe500" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M10.13 39.79c-.5.49-2.57 1-3 .56s.07-2.54.57-3a1.57 1.57 0 0 1 2.13.34a1.56 1.56 0 0 1 .3 2.1"/><path fill="#ffe500" d="m43.32 23.69l.8 1.51a.42.42 0 0 0 .32.22l1.69.2a.42.42 0 0 1 .25.71l-1.19 1.22a.39.39 0 0 0-.11.37l.33 1.67a.42.42 0 0 1-.59.46l-1.53-.76a.44.44 0 0 0-.39 0l-1.49.84a.43.43 0 0 1-.62-.43L41 28a.41.41 0 0 0-.13-.36l-1.21-1.14a.42.42 0 0 1 .21-.72l1.68-.29a.41.41 0 0 0 .31-.23l.72-1.55a.41.41 0 0 1 .74-.02"/><path fill="#fff48c" d="m40.53 27.31l1.06-.19a.4.4 0 0 0 .31-.23l.72-1.55a.42.42 0 0 1 .75 0l.79 1.51a.42.42 0 0 0 .32.22l1.07.13l.83-.85a.42.42 0 0 0-.25-.71l-1.69-.2a.42.42 0 0 1-.32-.22l-.8-1.51a.41.41 0 0 0-.74 0l-.72 1.55a.41.41 0 0 1-.31.23l-1.68.29a.42.42 0 0 0-.21.72Z"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="m43.32 23.69l.8 1.51a.42.42 0 0 0 .32.22l1.69.2a.42.42 0 0 1 .25.71l-1.19 1.22a.39.39 0 0 0-.11.37l.33 1.67a.42.42 0 0 1-.59.46l-1.53-.76a.44.44 0 0 0-.39 0l-1.49.84a.43.43 0 0 1-.62-.43L41 28a.41.41 0 0 0-.13-.36l-1.21-1.14a.42.42 0 0 1 .21-.72l1.68-.29a.41.41 0 0 0 .31-.23l.72-1.55a.41.41 0 0 1 .74-.02"/><path fill="#ffe500" d="m31.74 40.59l.26 1.35a.35.35 0 0 0 .2.24l1.27.54a.34.34 0 0 1 0 .6l-1.2.68a.32.32 0 0 0-.17.26l-.1 1.37a.34.34 0 0 1-.57.22l-1-.93a.3.3 0 0 0-.3-.08l-1.34.3a.34.34 0 0 1-.38-.47l.59-1.25a.31.31 0 0 0 0-.31l-.7-1.18a.34.34 0 0 1 .33-.51l1.36.16a.38.38 0 0 0 .3-.11l.9-1a.34.34 0 0 1 .55.12"/><path fill="#fff48c" d="m28.76 42.75l.86.1a.35.35 0 0 0 .3-.11l.9-1a.34.34 0 0 1 .59.15l.27 1.35a.31.31 0 0 0 .19.24l.8.34l.84-.47a.34.34 0 0 0 0-.6l-1.27-.54a.35.35 0 0 1-.2-.24l-.27-1.35a.34.34 0 0 0-.58-.16l-.9 1a.38.38 0 0 1-.3.11l-1.36-.16a.34.34 0 0 0-.33.51Z"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="m31.74 40.59l.26 1.35a.35.35 0 0 0 .2.24l1.27.54a.34.34 0 0 1 0 .6l-1.2.68a.32.32 0 0 0-.17.26l-.1 1.37a.34.34 0 0 1-.57.22l-1-.93a.3.3 0 0 0-.3-.08l-1.34.3a.34.34 0 0 1-.38-.47l.59-1.25a.31.31 0 0 0 0-.31l-.7-1.18a.34.34 0 0 1 .33-.51l1.36.16a.38.38 0 0 0 .3-.11l.9-1a.34.34 0 0 1 .55.12"/><path fill="#9ceb60" d="M11.86 7a3.06 3.06 0 1 1-2.59-3.44A3.06 3.06 0 0 1 11.86 7"/><path fill="#c8ffa1" d="M9.27 5.74a3.06 3.06 0 0 1 2.41 2a3 3 0 0 0 .18-.74a3.06 3.06 0 0 0-6.06-.85A3.2 3.2 0 0 0 6 7.67a3.08 3.08 0 0 1 3.27-1.93"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M11.86 7a3.06 3.06 0 1 1-2.59-3.44A3.06 3.06 0 0 1 11.86 7"/><path fill="none" stroke="#45413c" stroke-linecap="round" stroke-linejoin="round" d="M5.86 7.3C5.1 7.82 3.57 9 4 9.86s10.49-5.15 10.14-6s-2.5.12-3.26.48"/></svg>',
]

// 将 emoji SVG 转成 confetti 可用的彩色位图 Shape，缓存后供重复调用复用
let emojiShapesPromise: Promise<confetti.Shape[]> | null = null

function svgToBitmapShape(svg: string): Promise<confetti.Shape> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml" })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = async () => {
      const renderSize = 64
      const baseUnit = 10
      const canvas = document.createElement("canvas")
      canvas.width = renderSize
      canvas.height = renderSize
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(img, 0, 0, renderSize, renderSize)
      URL.revokeObjectURL(url)

      try {
        const bitmap = await createImageBitmap(canvas)
        const scale = baseUnit / renderSize
        resolve({
          type: "bitmap",
          bitmap,
          matrix: [scale, 0, 0, scale, (-renderSize * scale) / 2, (-renderSize * scale) / 2],
        } as unknown as confetti.Shape)
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = reject
    img.src = url
  })
}

function loadEmojiShapes(): Promise<confetti.Shape[]> {
  if (!emojiShapesPromise) {
    emojiShapesPromise = Promise.all(EMOJI_SVGS.map(svgToBitmapShape))
  }
  return emojiShapesPromise
}

const COLORS = {
  green: "#18a058",
  mint: "#2cc27a",
  gold: "#f0a020",
  lightGold: "#ffd36b",
  orange: "#f06a1a",
  pink: "#e8457f",
  lightPink: "#ff7aa8",
  blue: "#2080f0",
  purple: "#7d50e8",
  silver: "#8f99aa",
}
const PALETTES = [
  [COLORS.green, COLORS.gold, COLORS.blue, COLORS.pink],
  [COLORS.gold, COLORS.orange, COLORS.pink],
  [COLORS.blue, COLORS.silver, COLORS.purple],
  [COLORS.pink, COLORS.gold, COLORS.mint],
]
const RAINBOW = [COLORS.pink, COLORS.orange, COLORS.gold, COLORS.green, COLORS.blue, COLORS.purple]

/**
 * 盖在弹层上面放。点评弹窗平时等烟花放完才出来（见 celebrate 的返回值），但学生在放的时候
 * 点「下一题」，点评会被提前叫出来 —— 默认的 zIndex 100 在 Naive 弹层（2000 起）底下，
 * 剩下的半场就被遮罩挡住了。画布本身 pointer-events: none，不挡点评的点击。
 */
const Z_INDEX = 3000

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

// 对勾、爱心当粒子形状。matrix 直接给：不给的话 shapeFromPath 要扫 1000×1000 个点去量边界。
// 运行时它要的是数组（拿去 new DOMMatrix），类型声明写成了 DOMMatrix，只好转一下
let pathShapes: { check: confetti.Shape; heart: confetti.Shape } | null = null

function loadPathShapes() {
  if (!pathShapes) {
    const matrix = [0.5, 0, 0, 0.5, -5, -5] as unknown as DOMMatrix
    pathShapes = {
      check: confetti.shapeFromPath({ path: "M1 11 L4 8 L8 12 L16 3 L19 6 L8 17 Z", matrix }),
      heart: confetti.shapeFromPath({
        path: "M10 18 C2 12 0 7 3 4 C6 1 9 3 10 5 C11 3 14 1 17 4 C20 7 18 12 10 18 Z",
        matrix,
      }),
    }
  }
  return pathShapes
}

/**
 * 随机烟花效果 Composable
 * 十种彩纸风格的烟花，每次随机放一种（设计稿「做对了的庆祝」右边那块画板）
 */
export function useFireworks() {
  // 提前预加载表情包位图，避免首次触发「表情包烟花」时出现解码延迟
  loadEmojiShapes()

  // 动画期间创建的定时器，组件卸载时统一清理，避免离开页面后动画继续
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false
  // 这一场最后一次发射的 promise：canvas-confetti 同一块画布上的粒子是一场动画，
  // 后发的接进去，promise 在所有粒子都落完的时候才 resolve
  let lastShot: Promise<unknown> | null = null
  // 还没发出去的异步准备（表情包位图在解码），算「还在放」
  let preparing = 0

  function runLater(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      timers.delete(id)
      if (!disposed) fn()
    }, ms)
    timers.add(id)
  }

  /** 每 16ms 调一次 fn(进度 0..1)，放满 ms 之后调 end */
  function every(ms: number, fn: (progress: number) => void, end?: () => void) {
    const start = performance.now()
    const id = setInterval(() => {
      const progress = Math.min(1, (performance.now() - start) / ms)
      fn(progress)
      if (progress >= 1) {
        clearInterval(id)
        timers.delete(id)
        end?.()
      }
    }, 16)
    timers.add(id)
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      timers.forEach((id) => clearInterval(id))
      timers.clear()
    })
  }

  function fire(options: confetti.Options) {
    lastShot = confetti({ zIndex: Z_INDEX, ...options }) ?? lastShot
  }

  /** 定时器都走完、最后一把粒子也落完。离开页面（定时器被清掉）就当放完了 */
  function finished(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (disposed) return resolve()
        if (timers.size > 0 || preparing > 0) {
          setTimeout(check, 50)
          return
        }
        Promise.resolve(lastShot).then(() => resolve())
      }
      check()
    })
  }

  /** 没有真火箭：沿上升路线一路撒往下掉的小火星，当作尾焰。x0 → x、从屏幕底到 y */
  function rocket(x0: number, x: number, y: number, then: () => void) {
    every(
      380,
      (progress) => {
        const eased = 1 - Math.pow(1 - progress, 2.2)
        fire({
          particleCount: 3,
          angle: 270,
          spread: 40,
          startVelocity: 3,
          gravity: 0.5,
          decay: 0.9,
          ticks: 26,
          scalar: 0.65,
          flat: true,
          shapes: ["circle"],
          colors: [COLORS.gold, COLORS.lightGold],
          origin: { x: x0 + (x - x0) * eased, y: 1.02 - (1.02 - y) * eased },
        })
      },
      then,
    )
  }

  /** 炸开：一大把，60ms 后再补一小把，看起来厚一点 */
  function burst(x: number, y: number, colors: string[], size = 1) {
    const base: confetti.Options = {
      spread: 360,
      decay: 0.92,
      gravity: 0.55,
      flat: true,
      shapes: ["circle"],
      colors,
      origin: { x, y },
    }
    fire({
      ...base,
      particleCount: Math.round(70 * size),
      startVelocity: 26 * size,
      ticks: 80,
      scalar: 1,
    })
    runLater(
      () =>
        fire({
          ...base,
          particleCount: Math.round(40 * size),
          startVelocity: 18 * size,
          ticks: 70,
          scalar: 0.7,
        }),
      60,
    )
  }

  /** 升一发再炸开。x0 不给就从正下方附近升 */
  function shell(x: number, y: number, colors: string[], size = 1, x0?: number) {
    rocket(x0 ?? x + (Math.random() - 0.5) * 0.04, x, y, () => burst(x, y, colors, size))
  }

  const fireworkTypes = [
    // 效果1: 经典烟花秀 —— 左右两边轮流升起 7 发
    () => {
      for (let i = 0; i < 7; i++) {
        runLater(() => {
          const left = i % 2 === 0
          shell(
            left ? 0.08 + Math.random() * 0.3 : 0.62 + Math.random() * 0.3,
            0.14 + Math.random() * 0.26,
            pick(PALETTES),
            0.9 + Math.random() * 0.3,
          )
        }, i * 240)
      }
    },

    // 效果2: 星星雨 —— 从顶上落下一片星星
    () => {
      every(1000, () => {
        fire({
          particleCount: 2,
          angle: 270,
          spread: 20,
          startVelocity: 10,
          gravity: 0.7,
          decay: 0.97,
          ticks: 120,
          scalar: 1.1,
          shapes: ["star"],
          colors: [COLORS.gold, COLORS.gold, COLORS.pink, COLORS.blue, COLORS.silver],
          origin: { x: Math.random(), y: -0.05 },
        })
      })
    },

    // 效果3: 齐射 —— 从底部正中扇形射出 5 发，排成一道彩虹弧
    () => {
      for (let i = 0; i < 5; i++) {
        runLater(() => {
          shell(
            0.14 + 0.18 * i,
            0.38 - 0.2 * Math.sin((Math.PI * i) / 4),
            [RAINBOW[i], COLORS.silver],
            1,
            0.5,
          )
        }, i * 170)
      }
    },

    // 效果4: 彩虹喷泉 —— 两个下角往里喷，颜色按彩虹轮换
    () => {
      const start = performance.now()
      every(1300, () => {
        const color = RAINBOW[Math.floor((performance.now() - start) / 100) % RAINBOW.length]
        const base: confetti.Options = {
          particleCount: 3,
          spread: 22,
          startVelocity: 55,
          gravity: 1,
          decay: 0.92,
          ticks: 95,
          scalar: 0.8,
          flat: true,
          shapes: ["circle"],
          colors: [color],
        }
        fire({ ...base, angle: 62, origin: { x: 0, y: 1 } })
        fire({ ...base, angle: 118, origin: { x: 1, y: 1 } })
      })
    },

    // 效果5: 炮竹齐鸣 —— 正中一发大的，接着四周噼里啪啦碎响
    () => {
      rocket(0.5, 0.5, 0.34, () => {
        burst(0.5, 0.34, [COLORS.gold, COLORS.orange, COLORS.pink, COLORS.green], 1.8)
        for (let i = 0; i < 22; i++) {
          runLater(
            () => {
              fire({
                particleCount: 10,
                spread: 360,
                startVelocity: 6,
                decay: 0.9,
                gravity: 0.4,
                ticks: 30,
                scalar: 0.6,
                flat: true,
                shapes: ["circle"],
                colors: [COLORS.silver, COLORS.gold],
                origin: {
                  x: 0.5 + (Math.random() - 0.5) * 0.3,
                  y: 0.34 + (Math.random() - 0.5) * 0.4,
                },
              })
            },
            180 + i * 25,
          )
        }
      })
    },

    // 效果6: 螺旋上升 —— 两股火星绕成螺旋往上爬，到顶炸开
    () => {
      every(
        950,
        (progress) => {
          const y = 1.02 - (1.02 - 0.3) * (1 - Math.pow(1 - progress, 1.6))
          for (let arm = 0; arm < 2; arm++) {
            const phase = progress * Math.PI * 6 + arm * Math.PI
            fire({
              particleCount: 2,
              spread: 360,
              startVelocity: 2,
              decay: 0.92,
              gravity: 0.3,
              ticks: 40,
              scalar: 0.8,
              flat: true,
              shapes: ["circle"],
              colors: [arm ? COLORS.blue : COLORS.pink],
              origin: { x: 0.5 + Math.sin(phase) * 0.05 * (1 - progress * 0.6), y },
            })
          }
        },
        () => burst(0.5, 0.3, [COLORS.gold, COLORS.pink, COLORS.blue, COLORS.green], 1.6),
      )
    },

    // 效果7: 图案烟花 —— 三发分别炸出对勾、爱心、星星
    () => {
      const shapes = loadPathShapes()
      const list = [
        { x: 0.22, y: 0.36, shape: shapes.check, colors: [COLORS.green, COLORS.mint] },
        { x: 0.5, y: 0.3, shape: shapes.heart, colors: [COLORS.pink, COLORS.lightPink] },
        { x: 0.78, y: 0.36, shape: "star" as const, colors: [COLORS.gold, COLORS.orange] },
      ]
      list.forEach((item, i) => {
        runLater(() => {
          rocket(item.x, item.x, item.y, () => {
            fire({
              particleCount: 26,
              spread: 360,
              startVelocity: 24,
              decay: 0.92,
              gravity: 0.5,
              ticks: 110,
              scalar: 2.2,
              flat: true,
              shapes: [item.shape],
              colors: item.colors,
              origin: { x: item.x, y: item.y },
            })
          })
        }, i * 280)
      })
    },

    // 效果8: 风火轮 —— 屏幕中间四条火星臂越转越快，最后炸一下
    () => {
      const colors = [COLORS.pink, COLORS.gold, COLORS.green, COLORS.blue]
      every(
        1300,
        (progress) => {
          const base = progress * progress * 4 * 180
          for (let arm = 0; arm < 4; arm++) {
            fire({
              particleCount: 3,
              angle: base + arm * 90,
              spread: 4,
              startVelocity: 45,
              decay: 0.93,
              gravity: 0.4,
              ticks: 50,
              scalar: 0.9,
              flat: true,
              shapes: ["circle"],
              colors: [colors[arm]],
              origin: { x: 0.5, y: 0.42 },
            })
          }
        },
        () => burst(0.5, 0.42, [COLORS.gold, COLORS.silver]),
      )
    },

    // 效果9: 礼花瀑布 —— 顶上挂下一道金色火花帘
    () => {
      every(1200, () => {
        for (let i = 0; i < 5; i++) {
          fire({
            particleCount: 1,
            angle: 270,
            spread: 30,
            startVelocity: 3,
            decay: 0.95,
            gravity: 1.4,
            ticks: 110,
            scalar: 0.8,
            flat: true,
            shapes: ["circle"],
            colors: [COLORS.gold, COLORS.gold, COLORS.silver, COLORS.orange],
            origin: { x: 0.06 + Math.random() * 0.88, y: 0.06 },
          })
        }
      })
    },

    // 效果10: 表情包烟花 —— 一左一右炸出两团表情
    () => {
      preparing++
      loadEmojiShapes()
        .then((emojiShapes) => {
          if (disposed) return
          const options: confetti.Options = {
            shapes: emojiShapes,
            flat: true,
            scalar: 5,
            particleCount: 16,
            spread: 360,
            startVelocity: 40,
            gravity: 0.7,
            ticks: 150,
          }
          fire({ ...options, origin: { x: 0.35, y: 0.5 } })
          runLater(() => fire({ ...options, origin: { x: 0.68, y: 0.42 } }), 300)
        })
        .catch(() => {})
        .finally(() => preparing--)
    },
  ]

  /** 最多等这么久：粒子落完的回调万一没来，别让点评弹窗一直不出来 */
  const MAX_WAIT_MS = 4000

  /**
   * 触发随机烟花效果，返回的 promise 在这一场放完时 resolve（点评弹窗等它）
   */
  function celebrate(): Promise<void> {
    pick(fireworkTypes)()
    return Promise.race([
      finished(),
      new Promise<void>((resolve) => setTimeout(resolve, MAX_WAIT_MS)),
    ])
  }

  return {
    celebrate,
  }
}

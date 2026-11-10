import { NButton } from 'naive-ui'
import { h, type VNode } from 'vue'
import type { RouteLocationRaw, Router } from 'vue-router'

/**
 * 后台列表里「点名字进编辑」的链接，所有列表共用这一种：Naive 的文字按钮（主题绿、没有下划线），
 * 渲染成真的 <a>，Ctrl / Shift / 中键能在新标签页打开。`onNavigate` 在站内跳转之前调用（比如先关弹窗）。
 *
 * 按钮默认不折行、也不收缩（`white-space: nowrap` + `flex-shrink: 0`），名字一长就从格子里
 * 伸出去压到下一列上，所以这里放开：长名字在格子里折行（连一串没断点的字母数字也要能断开，库里真有这样的题名）
 */
const WRAP_STYLE = { whiteSpace: 'normal', height: 'auto', minWidth: 0, flexShrink: 1, textAlign: 'left', lineHeight: 1.5, overflowWrap: 'anywhere' } as const

export function renderEditLink(router: Router, to: RouteLocationRaw, label: string | VNode, onNavigate?: () => void) {
  return h(
    NButton,
    {
      text: true,
      type: 'primary',
      tag: 'a',
      href: router.resolve(to).href,
      style: WRAP_STYLE,
      onClick: (event: MouseEvent) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onNavigate?.()
        router.push(to)
      },
    },
    () => label,
  )
}

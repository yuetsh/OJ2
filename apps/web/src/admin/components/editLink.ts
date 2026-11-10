import { NButton } from 'naive-ui'
import { h, type VNode } from 'vue'
import type { RouteLocationRaw, Router } from 'vue-router'

/**
 * 后台列表里「点名字进编辑」的链接，所有列表共用这一种：Naive 的文字按钮（主题绿、没有下划线），
 * 渲染成真的 <a>，Ctrl / Shift / 中键能在新标签页打开。`onNavigate` 在站内跳转之前调用（比如先关弹窗）。
 */
export function renderEditLink(router: Router, to: RouteLocationRaw, label: string | VNode, onNavigate?: () => void) {
  return h(
    NButton,
    {
      text: true,
      type: 'primary',
      tag: 'a',
      href: router.resolve(to).href,
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

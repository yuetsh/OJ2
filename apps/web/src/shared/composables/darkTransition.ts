import { useDark } from "@vueuse/core"

/**
 * 圆环从哪儿开始扩散。正常点击就用指针落点；键盘触发（Enter / 空格）时浏览器给的
 * clientX/clientY 是 0，照用会让圆环从屏幕左上角冒出来——那种情况退回按钮自己的中心。
 * `event.detail` 是点击次数，键盘触发时为 0，用它区分最省事。
 */
function revealOrigin(event: MouseEvent) {
  if (event.detail > 0) return { x: event.clientX, y: event.clientY }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/**
 * 暗黑模式切换 + 圆环扩散过渡。
 *
 * 从 Header 里搬出来的：这套动画细节和「顶栏该放什么」没有关系，
 * 哪个页面想再放一个主题开关都能直接用。
 */
export function useDarkTransition() {
  const isDark = useDark()

  function toggleDark(event: MouseEvent) {
    if (!document.startViewTransition) {
      // 机房那批 Chrome 低于 94，没有 View Transitions，直接切、不做动画。
      isDark.value = !isDark.value
      return
    }
    const { x, y } = revealOrigin(event)
    // 半径要取到**最远**那个角的距离。用 hypot(x, y) 只覆盖到左上角，
    // 点在偏左上时右下角会有一块旧画面等圆环扩过去，看着像是没刷新。
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    )
    document
      .startViewTransition(() => {
        isDark.value = !isDark.value
      })
      .ready.then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 400,
            easing: "ease-in-out",
            pseudoElement: "::view-transition-new(root)",
          },
        )
      })
      .catch(() => {})
  }

  return { isDark, toggleDark }
}

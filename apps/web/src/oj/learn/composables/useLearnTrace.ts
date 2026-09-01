import { reportLearnProgress } from "oj/api"

/** 计时心跳。攒够 FLUSH_SECONDS 才上报一次，别让每个学生每秒钟打一次接口 */
const TICK_MS = 15_000
const FLUSH_SECONDS = 60

/**
 * 挂机保护：连续这么久没有任何鼠标/键盘/滚轮动作就停止计时。
 *
 * 机房的电脑经常开着页面就走了，不设这道闸的话「停留时长」会变成「电脑开机时长」，
 * 老师看到的数字全是假的。10 分钟是折中：真在读长课文的学生不会连滚轮都不碰这么久，
 * 而挂机的最多也只多算 10 分钟。
 */
const IDLE_MS = 10 * 60 * 1000

/**
 * 自学留痕的客户端计时。
 *
 * 只在「页面可见 + 人没挂机」时累加秒数，攒够一分钟或离开这一课时上报。
 * 换课、组件卸载、页面隐藏（切标签页/关窗口/手机切后台）都会先把攒着的秒数冲出去 ——
 * 手机上 `beforeunload` 常常不触发，`visibilitychange` 才是可靠的那个。
 *
 * @param tutorialId 当前这一课，0 表示还没加载好
 * @param enabled 是否留痕。未登录时为 false：教程本身保持免登录可读，只是不记
 */
export function useLearnTrace(
  tutorialId: Ref<number>,
  enabled: Ref<boolean>,
) {
  const visibility = useDocumentVisibility()
  const { idle } = useIdle(IDLE_MS)

  // 攒着还没上报的秒数，以及它属于哪一课 —— 换课时先把上一课的冲掉，
  // 不能记在当前 tutorialId 名下，否则时长会被算到下一课头上
  let pending = 0
  let pendingId = 0

  function flush() {
    if (!enabled.value || pending <= 0 || pendingId <= 0) return
    const seconds = pending
    const id = pendingId
    pending = 0
    reportLearnProgress(id, { seconds, opened: false })
  }

  const timer = window.setInterval(() => {
    if (!enabled.value || tutorialId.value <= 0) return
    if (visibility.value !== "visible" || idle.value) return
    pendingId = tutorialId.value
    pending += TICK_MS / 1000
    if (pending >= FLUSH_SECONDS) flush()
  }, TICK_MS)

  // enabled 也要盯着：学生常常是打开教程之后才在弹窗里登录的，那一下 tutorialId
  // 没变，只看 tutorialId 的话这一课就永远不算「打开过」，得等他翻到下一课才开始留痕
  watch([tutorialId, enabled], ([id, on], [previousId, previousOn]) => {
    if (previousId && previousId !== id) flush()
    if (!on || id <= 0) return
    if (id === previousId && on === previousOn) return
    pendingId = id
    reportLearnProgress(id, { seconds: 0, opened: true })
  })

  watch(visibility, (value) => {
    if (value === "hidden") flush()
  })

  onBeforeUnmount(() => {
    window.clearInterval(timer)
    flush()
  })
}

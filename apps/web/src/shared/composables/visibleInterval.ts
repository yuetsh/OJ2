import { watch } from "vue"
import { useDocumentVisibility, useIntervalFn } from "@vueuse/core"

/**
 * 定时刷新，但页面藏在后台时不拉，切回来立刻补一次。
 *
 * 比赛榜单 10 秒一次、比赛班级页 15 秒一次，原来在后台标签页里照样拉：考试时一个班
 * 几十个人开着题目页又开着榜单，后台那几十个请求是白付的，服务器只有两核。
 * 用法和 useIntervalFn 一样，默认不立即开始，由调用方 resume()。
 */
export function useVisibleInterval(fn: () => unknown, interval: number) {
  const visibility = useDocumentVisibility()
  const { pause, resume, isActive } = useIntervalFn(
    () => {
      if (visibility.value === "visible") fn()
    },
    interval,
    { immediate: false },
  )
  watch(visibility, (value) => {
    if (value === "visible" && isActive.value) fn()
  })
  return { pause, resume }
}

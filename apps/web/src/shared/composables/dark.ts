import { createGlobalState, useDark as useVueUseDark } from '@vueuse/core'

/**
 * 全站只有一个 `useDark()` 实例。**别再从 `@vueuse/core` 直接取 useDark** ——
 * auto-import 已经把 `useDark` 指到这里（apps/web/vite.config.ts 的 priority）。
 *
 * VueUse 的 useDark 每个实例挂载时都要把 `<html>` 的 class 「同步」一遍，同步的写法是
 * 往 `<head>` 插一段关掉过渡的 `<style>`、`getComputedStyle()` 逼浏览器当场重算整页样式、
 * 再删掉。亮色模式下它那句「没什么要改就跳过」永远不成立（要摘的 `dark` 本来就不在，它也算
 * 一次改动），所以**每个实例挂载一次就是一次整页样式重算**。
 *
 * 提交列表每行的结果胶囊（StatusPill → useTone）都调它：一页 30 行就是 30 次，翻页、
 * 切筛选再来 30 次，右栏换一条又是三四次。2026-11 实测（生产构建、CPU 降速 6 倍）首屏
 * 光这一处就占了 1.3 秒。全站共用一个之后只在第一次挂载时同步，后面的调用都是读同一个 ref。
 */
export const useDark = createGlobalState(() =>
  useVueUseDark({
    // 剩下的那一次（一进页面它还要同步两遍）也省掉：<html> 上的 class 已经对了就不动。
    // 只有真要切换时才走它原来那套（关过渡 + 重算），切暗色不会有颜色慢慢渐变的过渡
    onChanged(dark, defaultHandler, mode) {
      if (document.documentElement.classList.contains('dark') === dark) return
      defaultHandler(mode)
    },
  }),
)

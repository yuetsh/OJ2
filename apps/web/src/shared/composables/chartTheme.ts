import { useDark } from "@vueuse/core"
import { Chart as ChartJS } from "chart.js"

/**
 * chart.js 的默认配色是写死的浅色（文字 #666、网格线 rgba(0,0,0,0.1)），深色主题下
 * 坐标轴刻度和图例几乎看不见。这里挂一次全局默认值，跟着 isDark 走。
 *
 * 只改默认值还不够：options 不是 computed 的图表在主题切换后不会重绘，
 * 所以另外给出 chartKey —— 图表绑到 :key 上，切换时整个重新挂载。
 */
export function useChartTheme() {
  const isDark = useDark()

  const textColor = computed(() =>
    isDark.value ? "rgba(255, 255, 255, 0.75)" : "#606266",
  )
  const gridColor = computed(() =>
    isDark.value ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)",
  )
  const chartKey = computed(() => (isDark.value ? "dark" : "light"))

  watchEffect(() => {
    ChartJS.defaults.color = textColor.value
    // 网格线只能从 scale 这边改，**不要**去动 ChartJS.defaults.borderColor：
    // Colors 插件的 containsDefaultColorsDefenitions() 一看到根上的 borderColor
    // 不等于出厂值就整个罢工，靠它自动配色的图（DurationChart）会退成近黑的柱子和图例
    // 网格线走 defaults.set("scale", ...)，所有轴类型都继承这一层。
    // **不要**去动 ChartJS.defaults.borderColor：Colors 插件的
    // containsDefaultColorsDefenitions() 一看到根上的 borderColor 不等于出厂值
    // 就整个罢工，靠它自动配色的图（DurationChart）会退成近黑的柱子和图例。
    // 也不要直接写 defaults.scales.linear.border —— 那要求对应的 scale 已经注册，
    // 只注册了 radialLinear 的雷达图会在 setup 里抛错。
    ChartJS.defaults.set("scale", {
      grid: { color: gridColor.value },
      border: { color: gridColor.value },
    })
  })

  return { isDark, textColor, gridColor, chartKey }
}

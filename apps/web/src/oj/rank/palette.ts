import { useDark } from "@vueuse/core"

/**
 * 排名页的几种颜色（设计稿「排名重设计」G1）。用户说「颜色可以保留」：你绿、你要追的蓝、
 * 在追你的橙、本年级 / 全服里你们班的人浅绿，其余灰；前三名金银铜。
 * 暗色下灰条和浅绿换深一档，不然在暗底上发白。
 */
export function useRankPalette() {
  const isDark = useDark()
  return computed(() => ({
    me: "#18a058",
    chase: "#2f6fd0",
    threat: "#c76a12",
    mate: isDark.value ? "#2f6b47" : "#a8dcbd",
    bar: isDark.value ? "#4a525c" : "#c9d3dc",
    medal: [
      {
        color: isDark.value ? "#e2b33b" : "#9a6700",
        background: isDark.value ? "rgba(240,180,40,0.22)" : "#fbf1d9",
      },
      {
        color: isDark.value ? "#a7b1bd" : "#5f6b7a",
        background: isDark.value ? "rgba(120,135,155,0.22)" : "#eef1f4",
      },
      {
        color: isDark.value ? "#c58b62" : "#8c5a3c",
        background: isDark.value ? "rgba(170,110,70,0.22)" : "#f6ece5",
      },
    ],
  }))
}

export type RankPalette = ReturnType<typeof useRankPalette>["value"]

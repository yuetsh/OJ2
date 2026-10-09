import { useDark } from "@vueuse/core"

/**
 * 排名页的几种颜色（设计稿「排名重设计」G1）。用户说「颜色可以保留」：你绿、前一名蓝、
 * 后一名橙、本年级 / 全服里你们班的人浅绿，其余灰；前三名金银铜。
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
    /** 手机上条是整行底色，要淡到字压在上面看得清 */
    soft: {
      me: isDark.value ? "rgba(24,160,88,0.32)" : "#cdebd9",
      chase: isDark.value ? "rgba(47,111,208,0.32)" : "#d6e3f7",
      threat: isDark.value ? "rgba(199,106,18,0.32)" : "#f7e0cb",
      mate: isDark.value ? "rgba(24,160,88,0.16)" : "#e2f3e9",
      bar: isDark.value ? "rgba(255,255,255,0.08)" : "#eef1f4",
    },
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

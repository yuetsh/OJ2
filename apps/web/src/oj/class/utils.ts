import type { ClassPk, ClassPkCell } from "@oj2/contract"
import { classLabel } from "oj/submission/utils"

/**
 * 每个班一种颜色，按选班的顺序给。蓝 / 橙打头：两个班对决时最常见，这两个色盲也分得开；
 * 后面几个亮度错开，对照格的深浅才看得出来。
 */
const COLORS = [
  "#2f6fd0",
  "#e0702f",
  "#18a058",
  "#8e5bd0",
  "#b8901a",
  "#d0457a",
  "#0f8f9f",
  "#5f6b7a",
]

export function pkColor(index: number) {
  return COLORS[index % COLORS.length]!
}

/** 颜色加透明度：对照格按做对比例取深浅，比分卡两头的底色也用它（暗色下一样能用） */
export function tint(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 同一个年级的几个班只说「3班」，跨年级说全名 */
export function shortLabels(pk: ClassPk) {
  const grades = new Set(pk.classes.map((item) => item.className.slice(0, 2)))
  return pk.classes.map((item) =>
    grades.size === 1 ? `${item.className.slice(2)}班` : classLabel(item.className),
  )
}

/**
 * 你们班再有几个人做对，这道就能和 `target` 打平。比的是显示出来的整数百分比
 * （后端 `percent` 就是这么比输赢的），所以按同样的取整往上加。
 */
export function needToTie(cell: ClassPkCell, members: number, target: number) {
  let more = 0
  while (
    Math.round(((cell.solved + more) / members) * 100) < target &&
    cell.solved + more < members
  )
    more++
  return more
}

/** 一档同分人最多、且至少 5 个人，才说「N 个人停在 x 道」 */
export function plateau(values: number[]) {
  const counts = new Map<number, number>()
  for (const value of values) if (value > 0) counts.set(value, (counts.get(value) ?? 0) + 1)
  const [top] = [...counts].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1] || b[0] - a[0])
  return top ? { solved: top[0], count: top[1] } : null
}

import { useThemeVars } from "naive-ui"
import { useDark } from "@vueuse/core"

export type Tone = "success" | "error" | "warning" | "info" | "default"

function rgba(hex: string, alpha: number) {
  const value = hex.replace("#", "")
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value.slice(0, 6)
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * 提交列表里各种小胶囊的配色：浅底 + 深一档的字（设计稿「提交列表重设计 · 定稿」）。
 * 从主题色里取，暗色下字换成主题色本身（深色字放在暗底上看不清）。
 * 不用 color-mix：Chrome 105 没有（111 才有），机房有一部分还是 105。
 */
export function useTone() {
  const theme = useThemeVars()
  const isDark = useDark()

  return function tone(kind: Tone) {
    const t = theme.value
    const base = {
      success: t.successColor,
      error: t.errorColor,
      warning: t.warningColor,
      info: t.infoColor,
      default: t.textColor3,
    }[kind]
    const pressed = {
      success: t.successColorPressed,
      error: t.errorColorPressed,
      warning: t.warningColorPressed,
      info: t.infoColorPressed,
      default: t.textColor2,
    }[kind]
    return {
      color: isDark.value ? base : pressed,
      background: kind === "default" ? t.actionColor : rgba(base, isDark.value ? 0.16 : 0.12),
      solid: base,
    }
  }
}

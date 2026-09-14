/**
 * 站内唯一的日历时区。后端按它判「哪一天 / 几点 / 哪一年」，前端按它显示时间。
 *
 * 两边都按**固定偏移**算、不查 tzdata：中国大陆 1991 年起没有夏令时，东八区恒为 UTC+8，
 * 这样进程 TZ、浏览器时区、镜像里有没有 tzdata 都不影响结果（`Intl` 的 `longOffset`
 * 要 Chrome 95+，机房老 Chrome 用不了）。换时区时两个常量一起改。
 */
export const TIME_ZONE = "Asia/Shanghai"
export const TIME_ZONE_OFFSET_MINUTES = 8 * 60

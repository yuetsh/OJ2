/**
 * 挑战的颜色：紫。课堂条是绿、题单条是蓝、比赛条是黄，挑战不能和它们撞（设计稿「做对后再挑战」）。
 * Naive 的主题里没有紫，暗色下换浅一档，深紫放在暗底上看不清
 */
export function useChallengeTone() {
  const isDark = useDark()
  return computed(() =>
    isDark.value
      ? {
          solid: '#b49cf5',
          onSolid: '#17112b',
          text: '#c9b8ff',
          soft: 'rgba(180, 156, 245, 0.14)',
          border: 'rgba(180, 156, 245, 0.35)',
        }
      : {
          solid: '#5b34c4',
          onSolid: '#ffffff',
          text: '#2c1a66',
          soft: '#f4f0fe',
          border: '#ddd3f6',
        },
  )
}

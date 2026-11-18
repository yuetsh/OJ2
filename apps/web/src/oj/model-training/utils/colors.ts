/**
 * 标签的色块颜色，按标签在这一节里的顺序取。两个标签时是绿 / 红（好评 / 差评这类最常见），
 * 更多的往后接蓝、橙、紫、青。明暗主题都看得清。
 */
const SWATCHES = ['#18a058', '#d9534f', '#2f6fd6', '#f0a020', '#8e44ad', '#16a2b8']

export function labelSwatch(labels: string[], label: string) {
  const i = labels.indexOf(label)
  return SWATCHES[i < 0 ? 0 : i % SWATCHES.length]!
}

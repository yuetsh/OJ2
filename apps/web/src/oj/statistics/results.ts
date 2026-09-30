import { useThemeVars } from "naive-ui"
import { JUDGE_STATUS } from "utils/constants"
import type { SUBMISSION_RESULT } from "utils/types"
import { useTone, type Tone } from "oj/submission/composables/tone"

export function resultName(result: number) {
  return JUDGE_STATUS[result as SUBMISSION_RESULT]?.name ?? "其他"
}

/**
 * 结果条的颜色：答案正确绿、运行时错误橙、答案错误红、编译失败和判题中灰。
 * 数字行那根结果条和「错得最多的题」的小条共用（原来在今日统计里）
 */
export function useResultColor() {
  const theme = useThemeVars()
  const tone = useTone()
  return function resultColor(result: number) {
    if (result === -2) return theme.value.textColor3
    // 等待评分 / 判题中：还没有结果，不该和运行时错误一样是橙色
    if (result === 6 || result === 7) return theme.value.borderColor
    const kind: Tone = JUDGE_STATUS[result as SUBMISSION_RESULT]?.type ?? "default"
    if (kind !== "success" && kind !== "error" && kind !== "warning") return theme.value.borderColor
    return tone(kind).color
  }
}

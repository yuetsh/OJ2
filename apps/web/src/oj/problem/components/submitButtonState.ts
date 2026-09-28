export interface SubmitButtonStateInput {
  isAuthed: boolean
  hasCode: boolean
  isFormatting: boolean
  isSubmitting: boolean
  isJudging: boolean
  isCooldown: boolean
}

export interface SubmitButtonState {
  disabled: boolean
  label: string
  icon: string
}

export function getSubmitButtonState({
  isAuthed,
  hasCode,
  isFormatting,
  isSubmitting,
  isJudging,
  isCooldown,
}: SubmitButtonStateInput): SubmitButtonState {
  const disabled = !isAuthed || !hasCode || isFormatting || isSubmitting || isJudging || isCooldown

  // 设计稿里就叫「提交」：它旁边是「运行例子」，一个试跑、一个交，不用再说「代码」
  let label = "提交"
  if (!isAuthed) {
    label = "请先登录"
  } else if (isFormatting) {
    label = "格式化中"
  } else if (isSubmitting) {
    label = "正在提交"
  } else if (isJudging) {
    label = "正在评分"
  } else if (isCooldown) {
    label = "正在冷却"
  }

  // 平时不带图标，只在忙的时候转圈
  const icon = isFormatting || isSubmitting || isJudging ? "eos-icons:loading" : ""

  return { disabled, label, icon }
}

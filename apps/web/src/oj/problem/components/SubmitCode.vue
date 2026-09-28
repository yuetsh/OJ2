<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useCodeStore } from "oj/store/code"
import { useSubmissionStore } from "oj/store/submission"
import { getSubmitButtonState } from "./submitButtonState"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import { SubmissionStatus } from "utils/constants"

/**
 * 提交按钮。只把点击交给 store：提交的状态在 submission store，结果显示在左栏的
 * 「结果」页签（ResultPane），判完之后该发生的事在页面这一层的 SubmissionEffects ——
 * 这个组件在编辑器的工具栏里，编辑器卸载时它也跟着卸载，所以什么都不能只存在这里。
 */

/** 手机底部那条操作栏里用大号、占满半宽 */
const props = defineProps<{ size?: "small" | "medium" | "large"; block?: boolean }>()

const userStore = useUserStore()
const codeStore = useCodeStore()
const submissionStore = useSubmissionStore()
const route = useRoute()

const { isDesktop } = useBreakpoints()

const buttonState = computed(() =>
  getSubmitButtonState({
    isAuthed: userStore.isAuthed,
    hasCode: codeStore.code.value.trim() !== "",
    isFormatting: submissionStore.isFormatting,
    isSubmitting: submissionStore.isSubmittingRequest || submissionStore.submitting,
    isJudging: submissionStore.judging || submissionStore.pending,
    isCooldown: submissionStore.isCooldown,
  }),
)

/**
 * 这道题刚交对了：「提交」降成描边按钮，让结果页签里的「下一题」是唯一的主按钮
 * （设计文档 5.4）。改了代码想再交一次照样能交
 */
const justAccepted = computed(
  () => submissionStore.submission?.result === SubmissionStatus.accepted,
)

function submit() {
  if (buttonState.value.disabled) return
  submissionStore.submit({
    contestId: (route.params.contestID as string) ?? "",
    problemSetId: (route.params.problemSetId as string) ?? "",
  })
}
</script>

<template>
  <n-button
    :size="props.size ?? (isDesktop ? 'medium' : 'small')"
    :block="props.block"
    :type="justAccepted ? 'default' : 'primary'"
    :disabled="buttonState.disabled"
    @click="submit"
  >
    <template #icon>
      <n-icon>
        <Icon :icon="buttonState.icon" />
      </n-icon>
    </template>
    {{ buttonState.label }}
  </n-button>
</template>

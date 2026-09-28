<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useCodeStore } from "oj/store/code"
import { useSubmissionStore } from "oj/store/submission"
import { getSubmitButtonState } from "./submitButtonState"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"

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
    type="primary"
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

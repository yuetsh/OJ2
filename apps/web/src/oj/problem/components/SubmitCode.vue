<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { storeToRefs } from "pinia"
import { useCodeStore } from "oj/store/code"
import { useSubmissionStore } from "oj/store/submission"
import { getSubmitButtonState } from "./submitButtonState"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"

/**
 * 提交按钮 + 结果面板。只管显示和把点击交给 store：提交的状态在 submission store，
 * 判完之后该发生的事（烟花、点评、回题单）在页面这一层的 SubmissionEffects ——
 * 这个组件在编辑器的工具栏里，编辑器卸载时它也跟着卸载，所以什么都不能只存在这里。
 */

// 结果面板第一次弹出（也就是第一次提交）时才加载：它带着 DataTable，而判题要等
// 好几秒，这点下载时间藏得住。进页面就加载的话，只看题不提交的人也要付这笔
const SubmissionResult = defineAsyncComponent(() => import("./SubmissionResult.vue"))
const PythonErrorExplain = defineAsyncComponent(() => import("./PythonErrorExplain.vue"))

const userStore = useUserStore()
const codeStore = useCodeStore()
const submissionStore = useSubmissionStore()
const { submission, showResult, syntaxErrorInfo } = storeToRefs(submissionStore)
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
  <!-- 提交按钮 + 结果弹窗。
       display-directive 默认是 "if"：面板一收起来整个 SubmissionResult 就被卸载。
       AI 提示的内容现在在 store 里，卸了也不丢，但重新挂载要重渲染 Markdown、
       重新拉一次「这节课的下一题」，留着更省事。 -->
  <n-popover
    trigger="manual"
    display-directive="show"
    placement="bottom-end"
    scrollable
    :show-arrow="false"
    style="max-height: 600px"
    :show="showResult"
    @clickoutside="showResult = false"
  >
    <template #trigger>
      <n-button
        :size="isDesktop ? 'medium' : 'small'"
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

    <n-flex v-if="syntaxErrorInfo" vertical style="max-width: 560px">
      <n-alert type="warning" title="代码有语法错误，还没有提交" />
      <PythonErrorExplain :err-info="syntaxErrorInfo" />
    </n-flex>
    <SubmissionResult v-show="!syntaxErrorInfo" :submission="submission" />
  </n-popover>

  <!-- 结果面板点一下别处就收起来，而 showResult 只在提交时被置 true ——
       原来唯一的重开方式是「再提交一次」，AI 提示读到一半去看眼题面就回不来了。
       只在这次会话提交过之后才出现，没提交时工具栏保持原样。 -->
  <n-button
    v-if="(submission || syntaxErrorInfo) && !showResult"
    :size="isDesktop ? 'medium' : 'small'"
    @click="showResult = true"
  >
    上次结果
  </n-button>
</template>

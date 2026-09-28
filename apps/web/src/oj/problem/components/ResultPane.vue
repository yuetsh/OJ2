<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useSubmissionStore } from "oj/store/submission"

/**
 * 左栏「结果」页签的内容：提交前语法检查没过的说明、这一次提交的判题结果，或者空状态。
 *
 * 原来是提交按钮下面的一个浮层（n-popover），点一下外面就收起、最高 600px、盖住编辑器，
 * 学生没法一边看「正确输出 / 你的输出」一边改代码。放进左栏页签之后编辑器整列都在，
 * 改代码时结果就摆在旁边（见 docs/specs/2026-09-28-problem-page-redesign-design.md）。
 */

// 第一次切到「结果」时才加载：它带着 DataTable 和 Markdown 渲染，只看题不提交的人不用付
const SubmissionResult = defineAsyncComponent(() => import("./SubmissionResult.vue"))
const PythonErrorExplain = defineAsyncComponent(() => import("./PythonErrorExplain.vue"))

const { submission, syntaxErrorInfo } = storeToRefs(useSubmissionStore())
</script>

<template>
  <div class="result-pane">
    <n-flex v-if="syntaxErrorInfo" vertical>
      <n-alert type="warning" title="代码有语法错误，还没有提交" />
      <PythonErrorExplain :err-info="syntaxErrorInfo" />
    </n-flex>
    <SubmissionResult v-else-if="submission" :submission="submission" />
    <n-empty
      v-else
      class="empty"
      description="还没有提交过。写完代码按「提交代码」，结果会出现在这里"
    />
  </div>
</template>

<style scoped>
.result-pane {
  padding: 4px 0 16px;
}

.empty {
  margin-top: 48px;
}
</style>

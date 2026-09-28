<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"

/**
 * 左栏「结果」页签：三段 —— 提交结果 / 运行例子 / 自己输入。
 *
 * 原来提交结果是提交按钮下面的一个浮层（n-popover），点一下外面就收起、最高 600px、
 * 盖住编辑器；运行例子是题面里每个例子旁的「测试」按钮，只给通过 / 不通过、2 秒后复位；
 * 自己输入是顶栏「自测」模式里单独的一个编辑器。现在三样都在这一个页签里，
 * 编辑器整列都在，改代码时结果就摆在旁边（见 docs/specs/2026-09-28-problem-page-redesign-design.md）。
 */

// 第一次切到「结果」时才加载：它带着 DataTable 和 Markdown 渲染，只看题不提交的人不用付
const SubmissionResult = defineAsyncComponent(() => import("./SubmissionResult.vue"))
const PythonErrorExplain = defineAsyncComponent(() => import("./PythonErrorExplain.vue"))
const SampleRunResult = defineAsyncComponent(() => import("./SampleRunResult.vue"))
const CustomRun = defineAsyncComponent(() => import("./CustomRun.vue"))

const submissionStore = useSubmissionStore()
const { submission, syntaxErrorInfo, resultSegment } = storeToRefs(submissionStore)
const { problem } = storeToRefs(useProblemStore())

// 试跑走 Judge0，它跑不了 SQL；流程图也没得跑。这两种只留「提交结果」
const canTrial = computed(() => {
  const languages = problem.value?.languages ?? []
  return !languages.includes("SQL")
})
</script>

<template>
  <div class="result-pane">
    <n-radio-group v-if="canTrial" v-model:value="resultSegment" size="small" class="segments">
      <n-radio-button value="submit">提交结果</n-radio-button>
      <n-radio-button value="samples">运行例子</n-radio-button>
      <n-radio-button value="custom">自己输入</n-radio-button>
    </n-radio-group>

    <!-- 提交结果用 v-show：切去看运行例子时不卸载，挂着的错误说明在编辑器里标着红 -->
    <div v-show="resultSegment === 'submit' || !canTrial">
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
    <template v-if="canTrial">
      <SampleRunResult v-if="resultSegment === 'samples'" />
      <CustomRun v-else-if="resultSegment === 'custom'" />
    </template>
  </div>
</template>

<style scoped>
.result-pane {
  padding: 4px 0 16px;
}

.segments {
  margin-bottom: 14px;
}

.empty {
  margin-top: 48px;
}
</style>

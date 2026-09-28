<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"
import { useCodeStore } from "oj/store/code"
import { useTeacherCollab } from "../composables/teacherCollab"
import { useThemeVars } from "naive-ui"
import { parseTime } from "utils/functions"
import ResultHeader from "./ResultHeader.vue"

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
const FlowchartResult = defineAsyncComponent(() => import("./FlowchartResult.vue"))
const PeerLatest = defineAsyncComponent(() => import("./PeerLatest.vue"))

const submissionStore = useSubmissionStore()
const { submission, syntaxErrorInfo, resultSegment, formattedBeforeSubmit } =
  storeToRefs(submissionStore)
const { problem } = storeToRefs(useProblemStore())
const codeStore = useCodeStore()

/** 协作中的老师自己还没交过：先摆学生最近一次交的 */
const teacherCollab = useTeacherCollab()

const theme = useThemeVars()
const { samplesRunAt } = submissionStore.trial

type Segment = "submit" | "samples" | "custom"
const segments = computed<{ value: Segment; label: string; time: string }[]>(() => [
  {
    value: "submit",
    // 语法没过就没交上去：那一段不叫「提交结果」
    label: syntaxErrorInfo.value ? "交之前检查" : "提交结果",
    time:
      !syntaxErrorInfo.value && submission.value?.createTime
        ? parseTime(submission.value.createTime, "HH:mm")
        : "",
  },
  {
    value: "samples",
    label: "运行例子",
    time: samplesRunAt.value ? parseTime(samplesRunAt.value, "HH:mm") : "",
  },
  { value: "custom", label: "自己输入", time: "" },
])

/** 正在画流程图：结果就是 AI 的点评，没有例子可跑 */
const drawing = computed(() => codeStore.code.language === "Flowchart")

// 试跑走 Judge0，它跑不了 SQL；流程图也没得跑。这两种只留「提交结果」
const canTrial = computed(() => {
  const languages = problem.value?.languages ?? []
  return !languages.includes("SQL")
})
</script>

<template>
  <FlowchartResult v-if="drawing" />
  <div v-show="!drawing" class="result-pane">
    <!-- 设计稿：三个胶囊，选中的深色实心，带上那次结果的时间 -->
    <div v-if="canTrial" class="segments" role="tablist" aria-label="结果">
      <button
        v-for="segment in segments"
        :key="segment.value"
        type="button"
        role="tab"
        class="segment"
        :class="{ active: resultSegment === segment.value }"
        :aria-selected="resultSegment === segment.value"
        @click="resultSegment = segment.value"
      >
        {{ segment.label }}<template v-if="segment.time"> · {{ segment.time }}</template>
      </button>
    </div>

    <!-- 提交结果用 v-show：切去看运行例子时不卸载，挂着的错误说明在编辑器里标着红 -->
    <div v-show="resultSegment === 'submit' || !canTrial">
      <template v-if="syntaxErrorInfo">
        <ResultHeader kind="warning" title="代码有语法错误，还没有交上去" />
        <PythonErrorExplain :err-info="syntaxErrorInfo" />
      </template>
      <template v-else-if="submission">
        <p v-if="formattedBeforeSubmit" class="formatted">
          提交之前自动整理了代码格式（缩进、空格），编辑器里的代码也跟着变了，按 Ctrl+Z 能撤回
        </p>
        <SubmissionResult :submission="submission" />
      </template>
      <PeerLatest v-else-if="teacherCollab" />
      <n-empty
        v-else
        class="empty"
        description="还没有提交过。写完代码按「提交」，结果会出现在这里"
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
  padding-bottom: 16px;
}

.segments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.segment {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 15px;
  background-color: rgba(128, 128, 128, 0.12);
  color: v-bind("theme.textColor2");
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.segment.active {
  background-color: v-bind("theme.textColor1");
  color: v-bind("theme.cardColor");
}

.formatted {
  margin: 0 0 10px;
  font-size: 13px;
  opacity: 0.7;
}

.empty {
  margin-top: 48px;
}
</style>

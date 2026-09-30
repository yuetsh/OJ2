<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"
import { useCodeStore } from "oj/store/code"
import { useTeacherCollab } from "../composables/teacherCollab"
import { useProblemPageContext } from "../composables/problemPageContext"
import { useBreakpoints } from "shared/composables/breakpoints"
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
const CompileErrorExplain = defineAsyncComponent(() => import("./CompileErrorExplain.vue"))
const SampleRunResult = defineAsyncComponent(() => import("./SampleRunResult.vue"))
const CustomRun = defineAsyncComponent(() => import("./CustomRun.vue"))
const FlowchartResult = defineAsyncComponent(() => import("./FlowchartResult.vue"))
const PeerLatest = defineAsyncComponent(() => import("./PeerLatest.vue"))

const submissionStore = useSubmissionStore()
const { submission, syntaxErrorInfo, resultSegment, formattedBeforeSubmit } =
  storeToRefs(submissionStore)
const { problem } = storeToRefs(useProblemStore())
const codeStore = useCodeStore()
const ctx = useProblemPageContext()
const { isDesktop } = useBreakpoints()

/** 协作中的老师自己还没交过：先摆学生最近一次交的 */
const teacherCollab = useTeacherCollab()

const theme = useThemeVars()
const { samplesRunAt } = submissionStore.trial

/**
 * 手机上流程图题只能看点评、不能画（设计文档 5.6）。画不了，语言也就落不到 Flowchart 上，
 * 下面的 drawing 永远是假 —— 原来学生在电脑上画过、AI 评过的，手机上一条都看不到。
 * 这时多给一段「流程图点评」，只读。
 */
const flowchartReadable = computed(
  () => !isDesktop.value && !!problem.value?.allowFlowchart && ctx.value.entry !== "contest",
)
/** 在看「流程图点评」那一段。只在这一页记着：点运行例子、提交时照常切回对应的分段 */
const viewingFlowchart = ref(false)
watch(
  () => [submissionStore.resultSeq, problem.value?.id, flowchartReadable.value],
  () => {
    viewingFlowchart.value = false
  },
)

type Segment = "submit" | "samples" | "custom" | "flowchart"
const codeSegments = computed<{ value: Segment; label: string; time: string }[]>(() => [
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

// 试跑走判题机，SQL 题不走那里；流程图也没得跑。这两种只留「提交结果」
const canTrial = computed(() => {
  const languages = problem.value?.languages ?? []
  return !languages.includes("SQL")
})

const segments = computed(() => {
  const list = canTrial.value ? codeSegments.value : codeSegments.value.slice(0, 1)
  return flowchartReadable.value
    ? [...list, { value: "flowchart" as const, label: "流程图点评", time: "" }]
    : list
})
/** 只有一段（SQL 题、又不是手机上的流程图题）就不摆分段了 */
const showSegments = computed(() => segments.value.length > 1)

function isActive(segment: Segment) {
  if (viewingFlowchart.value) return segment === "flowchart"
  return resultSegment.value === segment
}
function pick(segment: Segment) {
  if (segment === "flowchart") {
    viewingFlowchart.value = true
    return
  }
  viewingFlowchart.value = false
  resultSegment.value = segment
}
</script>

<template>
  <FlowchartResult v-if="drawing" />
  <div v-show="!drawing" class="result-pane">
    <!-- 设计稿：三个胶囊，选中的深色实心，带上那次结果的时间 -->
    <div v-if="showSegments" class="segments" role="tablist" aria-label="结果">
      <button
        v-for="segment in segments"
        :key="segment.value"
        type="button"
        role="tab"
        class="segment"
        :class="{ active: isActive(segment.value) }"
        :aria-selected="isActive(segment.value)"
        @click="pick(segment.value)"
      >
        {{ segment.label }}<template v-if="segment.time"> · {{ segment.time }}</template>
      </button>
      <span v-if="!viewingFlowchart && resultSegment === 'custom'" class="segment-note"
        >自己编数据试试，这里不判对错</span
      >
    </div>

    <FlowchartResult v-if="viewingFlowchart && flowchartReadable" view-only />
    <!-- 提交结果用 v-show：切去看运行例子时不卸载，挂着的错误说明在编辑器里标着红 -->
    <div v-show="!viewingFlowchart && (resultSegment === 'submit' || !canTrial)">
      <template v-if="syntaxErrorInfo">
        <ResultHeader kind="warning" title="代码有语法错误，还没有交上去" />
        <CompileErrorExplain :err-info="syntaxErrorInfo" />
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
    <template v-if="canTrial && !viewingFlowchart">
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

.segment-note {
  margin-left: auto;
  align-self: center;
  font-size: 13px;
  color: v-bind("theme.textColor3");
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

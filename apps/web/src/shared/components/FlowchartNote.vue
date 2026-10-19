<script setup lang="ts">
import type { FlowchartCaseReport } from "@oj2/contract"
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import FlowchartCases from "shared/components/FlowchartCases.vue"
import { useTone } from "shared/composables/tone"
import { caseHeadline } from "utils/flowchart"

/**
 * 流程图「走例子」评完以后给人看的那一块（设计稿 FlowNoteFail / FlowNotePass / FlowNotePane）：
 * 学生不关心过没过几组数据，关心的是哪里画错了、怎么改 —— 点评做主体，逐组数据收成一行，
 * 点开才看。题目页的结果区和提交列表右栏共用，老师看到的和学生一样。
 *
 * 没走对：AI 对着答案写的「哪里错了 / 可以这样改」（ai_feedback / ai_suggestions）；AI 没写出来
 * （超时、被过滤、2026-10-19 之前的提交）就拿程序找到的第一处现象顶上「哪里错了」。
 * 全对：只有写法建议时才有「还可以更好」。
 */
const props = defineProps<{
  report: FlowchartCaseReport
  feedback: string | null
  suggestions: string | null
  /** 提交列表右栏窄：字小一号 */
  compact?: boolean
}>()
/** 点开的是哪一组（题目页拿它在画布上亮路径） */
const selected = defineModel<number | null>("selected", { default: null })
/** 逐组数据展开没有 */
const open = defineModel<boolean>("open", { default: false })

const theme = useThemeVars()
const tone = useTone()

const passed = computed(() => props.report.passed === props.report.total)
const wrong = computed(() => {
  if (passed.value) return ""
  return props.feedback?.trim() || props.report.cases.find((row) => !row.ok)?.why || ""
})
const fix = computed(() => (passed.value ? "" : (props.suggestions?.trim() ?? "")))
const better = computed(() => (passed.value ? (props.suggestions?.trim() ?? "") : ""))

/** 收起时连点开的那一组一起收掉（画布回到只标要改的框）。先算好再写：外面接着 v-model 时，
 * 写完马上读 open.value 读到的还是旧值 */
function toggle() {
  const next = !open.value
  open.value = next
  if (!next) selected.value = null
}
</script>

<template>
  <div class="flowchart-note" :class="{ compact }">
    <div v-if="wrong || fix || better" class="card">
      <div v-if="wrong">
        <div class="label" :style="{ color: tone('error').color }">
          <Icon icon="ph:warning-circle-bold" :width="compact ? 15 : 16" />哪里错了
        </div>
        <p>{{ wrong }}</p>
      </div>
      <div v-if="fix">
        <div class="label" :style="{ color: tone('success').color }">
          <Icon icon="ph:pencil-simple-line-bold" :width="compact ? 15 : 16" />可以这样改
        </div>
        <p>{{ fix }}</p>
      </div>
      <div v-if="better">
        <div class="label" :style="{ color: tone('success').color }">
          <Icon icon="ph:lightbulb-bold" :width="compact ? 15 : 16" />还可以更好
        </div>
        <p>{{ better }}</p>
      </div>
    </div>

    <button type="button" class="toggle" :aria-expanded="open" @click="toggle">
      看每组数据 · {{ caseHeadline(report) }}
      <Icon icon="ph:caret-down-bold" :width="13" class="caret" :class="{ up: open }" />
    </button>
    <FlowchartCases v-if="open" v-model:selected="selected" :report="report" />
  </div>
</template>

<style scoped>
.flowchart-note {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 18px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.08);
}

.compact .card {
  gap: 12px;
  padding: 12px 14px;
}

.label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 700;
}

.compact .label {
  font-size: 14px;
}

.card p {
  margin: 6px 0 0;
  font-size: 16px;
  line-height: 1.75;
  color: v-bind("theme.textColor1");
}

.compact .card p {
  margin-top: 4px;
  font-size: 15px;
  line-height: 1.7;
}

.toggle {
  align-self: flex-start;
  height: 30px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.toggle:hover {
  color: v-bind("theme.primaryColor");
}

.caret {
  transition: transform 0.15s;
}

.caret.up {
  transform: rotate(180deg);
}
</style>

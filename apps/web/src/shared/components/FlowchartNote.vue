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
  /** 上一次走对了几组（详情接口的 previousCases） */
  previous?: { passed: number; total: number } | null
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
/**
 * 「比上次多对了 n 组」：只在这次没画对时说（画对了标题已经够了），一样多不说；
 * 两次的组数不一样（老师中途改了例子）就没法比，也不说
 */
const compare = computed(() => {
  const previous = props.previous
  if (passed.value || !previous || previous.total !== props.report.total) return null
  const diff = props.report.passed - previous.passed
  if (diff > 0)
    return { up: true, text: `比上次多对了 ${diff} 组${props.compact ? "" : "，接着改"}` }
  if (diff < 0)
    return {
      up: false,
      text: `比上次少对了 ${-diff} 组${props.compact ? "" : "，看看刚才改了哪里"}`,
    }
  return null
})

function toggle() {
  const next = !open.value
  open.value = next
  if (!next) selected.value = null
}
</script>

<template>
  <div class="flowchart-note" :class="{ compact }">
    <!-- 完成度：一组一段，走对几组亮几段（不写「组」，学生不关心是几组数据） -->
    <div class="progress">
      <div
        class="segments"
        role="img"
        :aria-label="`完成度：${report.total} 段亮了 ${report.passed} 段`"
      >
        <!-- 从左往右亮，是条进度，不按哪一组对哪一组错排 -->
        <span
          v-for="index in report.total"
          :key="index"
          :class="{ lit: index <= report.passed }"
        ></span>
      </div>
      <span
        v-if="compare"
        class="compare"
        :style="{ color: tone(compare.up ? 'success' : 'warning').color }"
      >
        {{ compare.text }}
      </span>
    </div>
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

.progress {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
}

.segments {
  display: flex;
  gap: 4px;
}

.segments span {
  width: 36px;
  height: 8px;
  border-radius: 4px;
  background: v-bind("theme.dividerColor");
}

.segments span.lit {
  background: v-bind("theme.successColor");
}

.compact .segments {
  gap: 3px;
}

.compact .segments span {
  width: 22px;
  height: 7px;
}

.compare {
  font-size: 14px;
}

.compact .compare {
  font-size: 13px;
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
  padding: 10px 12px;
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
  font-size: 14px;
  line-height: 1.65;
}

.toggle {
  align-self: flex-start;
  height: 30px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.primaryColor");
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.toggle:hover {
  text-decoration: underline;
}

.caret {
  transition: transform 0.15s;
}

.caret.up {
  transform: rotate(180deg);
}
</style>

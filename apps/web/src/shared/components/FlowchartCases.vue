<script setup lang="ts">
import type { FlowchartCaseReport } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'

/**
 * 流程图「走例子」的逐组结果（设计稿 FlowResFail / FlowResPass）：每组一行，✓ / ✗、名字、输入；
 * 点一组展开「你的图输出 / 应该输出」。题目页里点一组还会在画布上亮出它走过的路
 * （selected 交给外面处理）；提交列表里只是展开看。
 *
 * 全部走对时收成一排小标签，地方让给「照着它写代码」。
 */
const { report } = defineProps<{ report: FlowchartCaseReport }>()
const selected = defineModel<number | null>('selected', { default: null })

const theme = useThemeVars()

const allPassed = computed(() => report.passed === report.total)

function oneLine(text: string) {
  return text.replace(/\n/g, ' ')
}

/** 你的图多出来、或者和应该输出对不上的那几行标红 */
function outputLines(output: string, expected: string) {
  const want = new Set(expected.split('\n').map((line) => line.trim()))
  return (output ? output.split('\n') : []).map((line) => ({
    text: line,
    off: !want.has(line.trim()),
  }))
}

function toggle(index: number) {
  selected.value = selected.value === index ? null : index
}
</script>

<template>
  <div v-if="allPassed" class="chips">
    <button
      v-for="(row, index) in report.cases"
      :key="row.name"
      type="button"
      class="chip"
      :class="{ active: selected === index }"
      :title="`输入：${oneLine(row.input)}`"
      @click="toggle(index)"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      {{ row.name }}
    </button>
  </div>

  <div v-else class="cases">
    <div v-for="(row, index) in report.cases" :key="row.name" class="case" :class="{ open: selected === index }">
      <button type="button" class="case-row" :aria-expanded="selected === index" @click="toggle(index)">
        <span class="mark" :class="row.ok ? 'ok' : 'bad'" :aria-label="row.ok ? '走对了' : '没走对'">
          <svg
            v-if="row.ok"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </span>
        <span class="name">{{ row.name }}</span>
        <span class="input">{{ oneLine(row.input) }}</span>
        <span v-if="!row.ok && selected !== index" class="why">{{ row.why }}</span>
      </button>
      <div v-if="selected === index" class="detail">
        <div class="outputs">
          <div class="output">
            <span class="label">你的图输出</span>
            <div class="box" :class="{ wrong: !row.ok }">
              <div v-for="(line, i) in outputLines(row.output, row.expected)" :key="i" class="line" :class="{ off: !row.ok && line.off }">
                {{ line.text || ' ' }}
              </div>
              <div v-if="!row.output" class="line empty">（什么也没输出）</div>
            </div>
          </div>
          <div class="output">
            <span class="label">应该输出</span>
            <div class="box">
              <div v-for="(line, i) in row.expected.split('\n')" :key="i" class="line">
                {{ line || ' ' }}
              </div>
            </div>
          </div>
        </div>
        <p v-if="row.why" class="why-full">{{ row.why }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 13px;
  background: rgba(24, 160, 88, 0.12);
  color: v-bind('theme.successColorPressed');
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.chip.active {
  border-color: v-bind('theme.successColor');
}

.cases {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.case {
  border: 1px solid transparent;
  border-radius: 6px;
}

.case.open {
  border-color: v-bind('theme.dividerColor');
}

.case-row {
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: v-bind('theme.textColor1');
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
}

.case-row:hover,
.case.open .case-row {
  background: rgba(128, 128, 128, 0.08);
}

.mark {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mark.ok {
  background: rgba(24, 160, 88, 0.14);
  color: v-bind('theme.successColorPressed');
}

.mark.bad {
  background: rgba(208, 48, 80, 0.12);
  color: v-bind('theme.errorColor');
}

.name {
  flex: none;
  width: 52px;
  color: v-bind('theme.textColor2');
}

.input {
  flex: none;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--oj-code-font, Consolas, Monaco, monospace);
}

.why {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: v-bind('theme.textColor2');
}

.detail {
  padding: 8px 10px 10px;
}

.outputs {
  display: flex;
  gap: 10px;
}

.output {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 12px;
  color: v-bind('theme.textColor3');
}

.box {
  padding: 6px 4px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.08);
  font-family: var(--oj-code-font, Consolas, Monaco, monospace);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.box.wrong {
  background: rgba(208, 48, 80, 0.06);
}

.line {
  padding: 0 6px;
  border-radius: 2px;
}

.line.off {
  background: rgba(208, 48, 80, 0.16);
}

.line.empty {
  color: v-bind('theme.textColor3');
}

.why-full {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.7;
}
</style>

<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { caseStatus, type AnswerSource, type CaseRow } from "./caseRows"

/**
 * 测试数据一组一行：输入 | 输出 | 当例子（设计稿「编程题出题页」B）。
 * 有标准答案时输出是跑出来的、只读；没有时（老题）输出手写。
 */
const rows = defineModel<CaseRow[]>("rows", { required: true })
const props = defineProps<{
  source: AnswerSource | null
  /** 只有例子这一列表的时候（测试数据太大、单独写例子）不显示「当例子」 */
  examplesOnly?: boolean
}>()

const theme = useThemeVars()

/** 输出最多先露这么多行，长了点开看全 */
const CLIP_LINES = 6
const expanded = ref(new Set<number>())

function lines(text: string) {
  return text.split("\n")
}

function clipped(row: CaseRow) {
  const all = lines(row.output)
  if (expanded.value.has(row.key) || all.length <= CLIP_LINES + 1)
    return { text: row.output, rest: 0 }
  return { text: all.slice(0, CLIP_LINES).join("\n"), rest: all.length - CLIP_LINES }
}

function toggle(key: number) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function remove(index: number) {
  rows.value.splice(index, 1)
}

const status = (row: CaseRow) => caseStatus(row, props.source)
</script>

<template>
  <div class="table" :class="{ examplesOnly }">
    <div class="row head">
      <span></span>
      <span>输入</span>
      <span>{{ source ? "输出（答案跑出来的）" : "输出（手写）" }}</span>
      <span v-if="!examplesOnly">当例子</span>
      <span></span>
      <span></span>
    </div>
    <div
      v-for="(row, index) in rows"
      :key="row.key"
      class="row"
      :class="{ bad: status(row) === 'error', changed: status(row) === 'changed' }"
    >
      <b class="no">{{ index + 1 }}</b>
      <n-input
        v-model:value="row.input"
        type="textarea"
        class="mono"
        size="small"
        :autosize="{ minRows: 1, maxRows: 8 }"
        placeholder="（没有输入）"
        :aria-label="`第 ${index + 1} 组输入`"
      />
      <n-input
        v-if="!source"
        v-model:value="row.output"
        type="textarea"
        class="mono"
        size="small"
        :autosize="{ minRows: 1, maxRows: 8 }"
        :aria-label="`第 ${index + 1} 组输出`"
      />
      <div v-else class="outCell">
        <div v-if="status(row) === 'error'" class="cell errorCell">{{ row.error }}</div>
        <template v-else>
          <pre class="cell" :class="{ stale: status(row) === 'running' }">{{
            clipped(row).text || (status(row) === "running" ? "在跑……" : "（没有输出）")
          }}</pre>
          <button v-if="clipped(row).rest" type="button" class="more" @click="toggle(row.key)">
            ⋯ 还有 {{ clipped(row).rest }} 行
          </button>
          <button
            v-else-if="expanded.has(row.key)"
            type="button"
            class="more"
            @click="toggle(row.key)"
          >
            收起
          </button>
          <div v-if="status(row) === 'changed'" class="was">
            变了 · 原来存的是
            <del>{{
              lines(row.saved ?? "")
                .slice(0, 3)
                .join(" ⏎ ") || "（空）"
            }}</del>
          </div>
        </template>
      </div>
      <n-checkbox
        v-if="!examplesOnly"
        v-model:checked="row.example"
        class="example"
        :aria-label="`第 ${index + 1} 组当例子`"
      />
      <span class="mark" :class="status(row)">
        <template v-if="status(row) === 'ok'">✓</template>
        <template v-else-if="status(row) === 'error'">✗</template>
        <template v-else-if="status(row) === 'changed'">●</template>
      </span>
      <n-button
        quaternary
        size="tiny"
        class="remove"
        :aria-label="`删掉第 ${index + 1} 组`"
        @click="remove(index)"
      >
        删掉
      </n-button>
    </div>
  </div>
</template>

<style scoped>
.table {
  display: flex;
  flex-direction: column;
}

.row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr) 44px 16px 40px;
  gap: 8px;
  align-items: start;
  padding: 7px 4px;
  border-top: 1px solid v-bind("theme.dividerColor");
  font-size: 12px;
  border-radius: 4px;
}

.examplesOnly .row {
  grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr) 16px 40px;
}

.row.head {
  border-top: 0;
  padding-top: 2px;
  padding-bottom: 2px;
  color: v-bind("theme.textColor3");
}

.row.changed {
  background-color: rgba(240, 160, 32, 0.08);
}

.no {
  line-height: 26px;
  text-align: right;
}

.mono :deep(textarea),
.cell {
  font-family: ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei", monospace;
  font-size: 12px;
  line-height: 1.5;
}

.outCell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.cell {
  margin: 0;
  width: 100%;
  box-sizing: border-box;
  min-height: 26px;
  padding: 3px 7px;
  border-radius: 3px;
  border: 1px solid v-bind("theme.dividerColor");
  background-color: rgba(128, 128, 128, 0.05);
  white-space: pre;
  overflow-x: auto;
}

.cell.stale {
  opacity: 0.5;
}

.errorCell {
  white-space: pre-wrap;
  word-break: break-all;
  color: v-bind("theme.errorColor");
  border-color: v-bind("theme.errorColorSuppl");
  background-color: rgba(208, 48, 80, 0.06);
}

.more {
  border: 0;
  padding: 0;
  background: none;
  font: inherit;
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.was {
  color: v-bind("theme.warningColorPressed");
}

.was del {
  color: v-bind("theme.textColor3");
}

.example {
  margin-top: 5px;
}

.mark {
  line-height: 26px;
  font-weight: 700;
}

.mark.ok {
  color: v-bind("theme.successColor");
}

.mark.error {
  color: v-bind("theme.errorColor");
}

.mark.changed {
  color: v-bind("theme.warningColor");
}

.remove {
  margin-top: 1px;
  opacity: 0;
}

.row:hover .remove,
.remove:focus-visible {
  opacity: 1;
}
</style>

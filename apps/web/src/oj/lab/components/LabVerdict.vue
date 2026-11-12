<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import { Icon } from '@iconify/vue'
import type { LabCheckKind, LabRunResult } from '@oj2/contract'
import { explainLabError } from '../utils/labError'

/**
 * 运行完的那一句结论：做对了 / 还没对（差在哪）/ 报错了（第几行、什么错）。
 * 学生页和出题页共用；`teacher` 时多给英文原文、检查脚本自己的错 —— 学生界面不出现英文。
 *
 * `codes` 是第 1…step 步的代码，报错落在前面某一步时也能拿那一步的代码去对行。
 */
const {
  result,
  step,
  codes,
  checkKind,
  teacher = false,
} = defineProps<{
  result: LabRunResult
  /** 这次跑的是第几步，从 1 数 */
  step: number
  codes: string[]
  checkKind: LabCheckKind
  teacher?: boolean
}>()

const theme = useThemeVars()

const error = computed(() => (result.error ? explainLabError(result.error, codes[result.error.step - 1] ?? '') : null))
const refError = computed(() => (result.referenceError ? explainLabError(result.referenceError) : null))

function where(e: { step: number; line: number | null }) {
  const stepPart = e.step !== step ? `第 ${e.step} 步` : ''
  const linePart = e.line ? `第 ${e.line} 行` : ''
  return stepPart || linePart ? `${stepPart}${linePart}：` : ''
}
</script>

<template>
  <div v-if="error" class="verdict bad" role="status">
    <Icon icon="ph:warning-circle-bold" class="icon" />
    <div class="body">
      <div>{{ where(error) }}{{ error.message }}</div>
      <details v-if="teacher && result.error?.traceback" class="raw">
        <summary>原文</summary>
        <pre>{{ result.error.traceback }}</pre>
      </details>
    </div>
  </div>
  <div v-else-if="refError" class="verdict bad" role="status">
    <Icon icon="ph:warning-circle-bold" class="icon" />
    <div class="body">
      <template v-if="teacher">
        <div>答案跑不通 · {{ where(refError) }}{{ refError.message }}</div>
        <details v-if="result.referenceError?.traceback" class="raw">
          <summary>原文</summary>
          <pre>{{ result.referenceError.traceback }}</pre>
        </details>
        <div v-else-if="result.referenceError?.type === 'Missing'">{{ result.referenceError.message }}</div>
      </template>
      <div v-else>这一步的答案有问题，暂时判不了，告诉老师。</div>
    </div>
  </div>
  <div v-else-if="result.check?.passed" class="verdict ok" role="status">
    <Icon icon="ph:check-circle-bold" class="icon" />
    <div class="body">
      {{ checkKind === 'none' ? '跑通了' : '做对了' }}<template v-if="teacher && result.referenceSummary">：{{ result.referenceSummary }}</template>
    </div>
  </div>
  <div v-else-if="result.check" class="verdict bad" role="status">
    <Icon icon="ph:x-circle-bold" class="icon" />
    <div class="body">
      <div v-for="(msg, i) in result.check.messages" :key="i">{{ msg }}</div>
      <div v-if="!result.check.messages.length">还没对。</div>
      <details v-if="teacher && result.check.scriptError" class="raw" open>
        <summary>检查脚本自己出错了</summary>
        <pre>{{ result.check.scriptError }}</pre>
      </details>
    </div>
  </div>
</template>

<style scoped>
.verdict {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 15px;
  line-height: 1.7;
}

.icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 4px;
}

.body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ok {
  background: rgba(24, 160, 88, 0.1);
  color: v-bind('theme.primaryColorPressed');
}

.bad {
  background: rgba(240, 160, 32, 0.14);
  color: v-bind('theme.textColor1');
}

.bad .icon {
  color: #d08000;
}

.raw {
  margin-top: 4px;
  font-size: 12px;
  color: v-bind('theme.textColor3');
}

.raw summary {
  cursor: pointer;
}

.raw pre {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: Consolas, Monaco, monospace;
}
</style>

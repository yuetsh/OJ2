<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { copyToClipboard } from 'utils/functions'
import { SubmissionStatus } from 'utils/constants'
import { useCodeStore } from 'oj/store/code'
import { useSubmissionStore } from 'oj/store/submission'

/**
 * 题面的例子：每组一行「输入 → 输出」，输出浅绿底（设计稿「题目页观感」ExCard，2026-11-04 定）。
 *
 * - 输入写的是「无」或者空的（常用题里 12% 的例子）写灰字「不用输入」，不给复制：
 *   原来摆成一格可复制的「无」，学生以为要输入一个「无」。
 * - 行首的空格画成浅灰点：菱形、三角形那几道靠行首空格对齐，数不清空格就照着排错了。
 *   只是画成点，复制出去的还是空格。
 * - 半格放不下最长那行，这道题的例子整体改成上下排（输入、↓、输出）。整宽还放不下的那一行
 *   才折行，**折下来的部分缩进两格**：原来不折、横着滚，就是怕学生分不清折行和真换行、
 *   照着多输出一个换行；缩进之后两者一眼能分开，又不用去找那根细滚动条。
 * - 「运行例子」跑过之后，序号上标 ✓ / ✗（还是会跳到「结果」页签，切回来就看得到）。
 *   代码改过就不再标：标的是上一份代码的对错，留着会让学生以为改完的还对。
 */
const { samples } = defineProps<{
  samples: { input: string; output: string }[]
}>()

const SIDES = ['input', 'output'] as const
const SIDE_LABEL = { input: '输入', output: '输出' } as const

/** 输入写「无」或者空着：这道题不用输入 */
function noInput(text: string) {
  const trimmed = text.trim()
  return trimmed === '' || trimmed === '无'
}

/** 每一行拆成「行首空格数 + 余下的字」，模板里把行首空格画成点 */
function linesOf(text: string) {
  return text.split('\n').map((line) => {
    const lead = /^ +/.exec(line)?.[0].length ?? 0
    return { lead, rest: line.slice(lead) }
  })
}

// ==================== 摆成一行还是上下排 ====================
// 下面几个尺寸 CSS 里也用（v-bind），量宽度和排版是同一套数
const FONT_SIZE = 16
const FONT = `${FONT_SIZE}px Consolas, Monaco, monospace`
const DOT_W = 26
const ARROW_W = 22
const GAP = 6
/** 格子里除了字以外占掉的：左右内边距、复制按钮、按钮前的间距、边框 */
const PANE_CHROME = 10 + 4 + 26 + 4 + 2

let measureCtx: CanvasRenderingContext2D | null = null
/** 例子里最长那一行排出来有多宽（px）。等宽字体里中文、表情照样比英文宽，所以按字体真量 */
const widest = computed(() => {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 0
  measureCtx.font = FONT
  let max = 0
  for (const sample of samples) {
    for (const side of SIDES) {
      if (side === 'input' && noInput(sample.input)) continue
      for (const line of sample[side].split('\n')) {
        const width = measureCtx.measureText(line.replace(/\t/g, '        ')).width
        if (width > max) max = width
      }
    }
  }
  return max
})

const list = useTemplateRef<HTMLElement>('list')
const { width: listWidth } = useElementSize(list)
const halfText = computed(() => (listWidth.value - DOT_W - ARROW_W - GAP * 3) / 2 - PANE_CHROME)
const stacked = computed(() => listWidth.value > 0 && widest.value > halfText.value)

// ==================== 复制 ====================
const message = useMessage()
const copiedKey = ref('')
const { start: resetCopied } = useTimeoutFn(() => (copiedKey.value = ''), 1000, { immediate: false })
async function copy(key: string, text: string) {
  if (await copyToClipboard(text)) {
    copiedKey.value = key
    resetCopied()
  } else {
    message.error('复制失败')
  }
}

// ==================== 运行例子的 ✓ / ✗ ====================
const submissionStore = useSubmissionStore()
const codeStore = useCodeStore()
const marks = computed<Record<number, 'ok' | 'bad'>>(() => {
  const trial = submissionStore.trial
  const ran = trial.samplesCode.value
  if (trial.samplesRunning.value || !ran) return {}
  if (ran.value !== codeStore.code.value || ran.language !== codeStore.code.language) return {}
  const out: Record<number, 'ok' | 'bad'> = {}
  for (const run of trial.sampleRuns.value) {
    out[run.index] = run.result === SubmissionStatus.accepted ? 'ok' : 'bad'
  }
  return out
})
function markLabel(index: number) {
  const mark = marks.value[index]
  if (mark === 'ok') return `例子 ${index + 1}，运行结果对了`
  if (mark === 'bad') return `例子 ${index + 1}，运行结果不对`
  return `例子 ${index + 1}`
}

const css = {
  font: FONT,
  dotW: `${DOT_W}px`,
  arrowW: `${ARROW_W}px`,
  gap: `${GAP}px`,
}
</script>

<template>
  <div ref="list" class="sample-list" :class="{ stacked }" role="list" aria-label="例子">
    <div v-if="!stacked" class="cols" aria-hidden="true">
      <span />
      <span>输入</span>
      <span />
      <span>输出</span>
    </div>
    <div v-for="(sample, index) of samples" :key="index" class="pair" role="listitem">
      <span class="dot" :class="marks[index]" :aria-label="markLabel(index)">
        <Icon v-if="marks[index] === 'ok'" icon="ph:check-bold" :width="13" />
        <Icon v-else-if="marks[index] === 'bad'" icon="ph:x-bold" :width="12" />
        <template v-else>{{ index + 1 }}</template>
      </span>
      <div class="sides">
        <template v-for="side in SIDES" :key="side">
          <span v-if="side === 'output'" class="arrow" aria-hidden="true">
            <Icon :icon="stacked ? 'ph:arrow-down' : 'ph:arrow-right'" :width="16" />
          </span>
          <div v-if="side === 'input' && noInput(sample.input)" class="pane in none">不用输入</div>
          <div v-else class="pane" :class="side === 'input' ? 'in' : 'out'">
            <pre class="text" :aria-label="`例子 ${index + 1} 的${SIDE_LABEL[side]}`"><span
              v-for="(line, i) of linesOf(sample[side])"
              :key="i"
              class="line"
              ><span v-if="line.lead" class="lead">{{ '·'.repeat(line.lead) }}</span>{{ line.rest }}</span
            ></pre>
            <button type="button" class="copy" :aria-label="`复制例子 ${index + 1} 的${SIDE_LABEL[side]}`" @click="copy(`${index}-${side}`, sample[side])">
              <Icon :icon="copiedKey === `${index}-${side}` ? 'ph:check' : 'ph:copy'" :width="15" />
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sample-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  --pane-in-bg: rgba(128, 128, 128, 0.07);
  --pane-in-border: rgba(128, 128, 128, 0.14);
  --pane-out-bg: rgba(24, 160, 88, 0.08);
  --pane-out-border: rgba(24, 160, 88, 0.26);
  --lead: rgba(24, 160, 88, 0.45);
  --muted: rgba(128, 128, 128, 0.75);
}

:global(html.dark) .sample-list {
  --pane-out-bg: rgba(99, 226, 183, 0.08);
  --pane-out-border: rgba(99, 226, 183, 0.26);
  --lead: rgba(99, 226, 183, 0.45);
}

.sample-list.stacked {
  gap: 12px;
}

.cols,
.pair {
  display: grid;
  grid-template-columns: v-bind('css.dotW') minmax(0, 1fr);
  gap: 0 v-bind('css.gap');
}

.cols {
  grid-template-columns: v-bind('css.dotW') minmax(0, 1fr) v-bind('css.arrowW') minmax(0, 1fr);
  margin-bottom: -4px;
  font-size: 12px;
  line-height: 20px;
  color: var(--muted);
}

/* 一行：输入 → 输出；上下排：输入、↓、输出 */
.sides {
  display: grid;
  grid-template-columns: minmax(0, 1fr) v-bind('css.arrowW') minmax(0, 1fr);
  gap: 0 v-bind('css.gap');
  align-items: stretch;
  min-width: 0;
}

.stacked .sides {
  grid-template-columns: minmax(0, 1fr);
}

.dot {
  width: 22px;
  height: 22px;
  margin-top: 7px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background-color: rgba(128, 128, 128, 0.14);
  color: var(--muted);
}

.dot.ok {
  background-color: #18a058;
  color: #fff;
}

.dot.bad {
  background-color: #d03050;
  color: #fff;
}

.arrow {
  display: flex;
  justify-content: center;
  padding-top: 10px;
  color: var(--muted);
}

.stacked .arrow {
  justify-content: flex-start;
  padding: 2px 0 2px 14px;
}

.pane {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 5px 4px 5px 10px;
  border-radius: 6px;
}

.pane.in {
  background-color: var(--pane-in-bg);
  border: 1px solid var(--pane-in-border);
}

.pane.out {
  background-color: var(--pane-out-bg);
  border: 1px solid var(--pane-out-border);
}

.pane.none {
  align-self: start;
  background-color: transparent;
  border-style: dashed;
  padding-right: 10px;
  font-size: 14px;
  line-height: 24px;
  color: var(--muted);
}

.text {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font: v-bind('css.font');
  line-height: 24px;
}

/* 一行一块：整宽还放不下才折，折下来的缩进两格，和真换行分得开 */
.line {
  display: block;
  min-height: 24px;
  padding-left: 2ch;
  text-indent: -2ch;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.lead {
  color: var(--lead);
}

.copy {
  flex: none;
  width: 26px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.copy:hover {
  background-color: rgba(128, 128, 128, 0.14);
}
</style>

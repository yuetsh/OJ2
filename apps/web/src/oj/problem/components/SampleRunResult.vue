<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import { useSubmissionStore } from 'oj/store/submission'
import { SubmissionStatus } from 'utils/constants'
import TrialErrorNote from './TrialErrorNote.vue'
import WrongAnswerExplain from './WrongAnswerExplain.vue'
import ResultHeader from './ResultHeader.vue'

/**
 * 「结果」页签里「运行例子」那一段：每个例子对没对上，点一个看细节。
 * 没对上的说明复用判完之后那一套（WrongAnswerExplain）；比赛里只摆输出、不给提示句。
 */

const { sampleRuns, samplesRunning, samplesCode } = useSubmissionStore().trial
const theme = useThemeVars()
const route = useRoute()
const inContest = computed(() => !!route.params.contestID)

const failedCount = computed(() => sampleRuns.value.filter((run) => run.result !== SubmissionStatus.accepted).length)

/**
 * 一个例子都没跑起来：编译 / 语法没过，或者试跑服务本身没跑成（排队满了、判题机连不上）。
 * 这时不能说「N 个例子没对上」—— 程序一行都没跑，每个例子也都是同一个原因，芯片不摆
 */
const header = computed(() => {
  const runs = sampleRuns.value
  const first = runs[0]
  if (first && runs.every((run) => run.result === SubmissionStatus.compile_error)) {
    return {
      kind: 'warning' as const,
      title: samplesCode.value?.language === 'Python' ? '试跑：代码有语法错误，一个例子都没跑' : '试跑：编译没通过，一个例子都没跑',
      chips: false,
    }
  }
  if (first?.note && runs.every((run) => run.note === first.note)) {
    // 输出太多是程序自己的问题（多半死循环），其余带 note 的都是没跑成
    const ran = first.result === SubmissionStatus.runtime_error
    return {
      kind: ran ? ('error' as const) : ('warning' as const),
      title: ran ? '试跑：程序一直在输出，停不下来' : '试跑没跑成',
      chips: false,
    }
  }
  return {
    kind: failedCount.value ? ('error' as const) : ('success' as const),
    title: failedCount.value ? `试跑：${failedCount.value} 个例子没对上` : '试跑：例子都对上了',
    chips: true,
  }
})

/** 看的是哪一个例子：默认第一个没对上的 */
const selected = ref(0)
watch(sampleRuns, (runs) => {
  const firstFailed = runs.findIndex((run) => run.result !== SubmissionStatus.accepted)
  selected.value = firstFailed >= 0 ? firstFailed : 0
})
const current = computed(() => sampleRuns.value[selected.value] ?? null)
</script>

<template>
  <n-flex v-if="samplesRunning" align="center" class="state">
    <n-spin size="small" />
    <span>正在用例子试跑……</span>
  </n-flex>

  <n-empty v-else-if="!sampleRuns.length" class="state" description="还没运行过。点工具栏的「运行例子」，用题目里的例子试跑一遍，不算提交" />

  <n-flex v-else vertical :size="12">
    <!-- 设计稿「运行例子：例子 2 没对上（不算提交）」：标题、「不算提交」、各例子的芯片在一行 -->
    <ResultHeader :kind="header.kind" :title="header.title" sub="（不算提交）">
      <template v-if="header.chips" #extra>
        <div class="runs">
          <button
            v-for="run in sampleRuns"
            :key="run.index"
            type="button"
            class="run"
            :class="[run.result === SubmissionStatus.accepted ? 'ok' : 'bad', { active: selected === run.index }]"
            :aria-pressed="selected === run.index"
            @click="selected = run.index"
          >
            <svg
              v-if="run.result === SubmissionStatus.accepted"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12l5 5 9-10" />
            </svg>
            <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            例子 {{ run.index + 1 }}
          </button>
        </div>
      </template>
    </ResultHeader>

    <template v-if="current">
      <!-- 对上了：输入、正确输出、你的输出竖着摆出来就行，你的输出也是绿的 -->
      <div v-if="current.result === SubmissionStatus.accepted" class="passed-card">
        <span class="label">输入</span>
        <pre class="pane in">{{ current.input }}</pre>
        <span class="label">正确输出</span>
        <pre class="pane ok">{{ current.expected }}</pre>
        <span class="label">你的输出</span>
        <pre class="pane ok">{{ current.output }}</pre>
      </div>
      <!-- 跑完了、输出对不上：和判完之后同一套说明 -->
      <WrongAnswerExplain
        v-else-if="current.result === SubmissionStatus.wrong_answer"
        :check="{
          passed: false,
          index: current.index,
          input: current.input,
          expected: current.expected,
          output: current.output,
          result: SubmissionStatus.wrong_answer,
        }"
        :code="samplesCode?.value ?? ''"
        :language="samplesCode?.language ?? ''"
        :plain="inContest"
        section="stack"
      />
      <!-- 没跑完：编译不过、运行出错、超时 -->
      <TrialErrorNote
        v-else
        :result="current.result"
        :output="current.output"
        :language="samplesCode?.language ?? ''"
        :note="current.note"
        :runtime-error="current.runtimeError"
        :code="samplesCode?.value ?? ''"
        :plain="inContest"
      />
    </template>

    <p class="note">例子都对上了再按「提交」。例子对了也可能在别的测试点上错，提交才算数。</p>
  </n-flex>
</template>

<style scoped>
.state {
  margin-top: 32px;
  justify-content: center;
}

.runs {
  display: flex;
  gap: 6px;
  margin-left: 4px;
}

.run {
  height: 28px;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.run.ok {
  border: 1px solid rgba(24, 160, 88, 0.35);
  background-color: rgba(24, 160, 88, 0.1);
  color: v-bind('theme.successColorPressed');
}

.run.bad {
  border: 1px solid rgba(208, 48, 80, 0.4);
  background-color: rgba(208, 48, 80, 0.07);
  color: v-bind('theme.errorColorPressed');
}

/* 选中的那个涂实心：设计稿「运行例子」 */
.run.ok.active {
  border-color: v-bind('theme.successColor');
  background-color: v-bind('theme.successColor');
  color: #fff;
}

.run.bad.active {
  border-color: v-bind('theme.errorColor');
  background-color: v-bind('theme.errorColor');
  color: #fff;
}

/* 对上了：和答错时同一张两列的网格（标签 | 格子），只是你的输出也是绿的 */
.passed-card {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 6px 8px;
  align-items: start;
}

.label {
  font-size: 13px;
  line-height: 36px;
  white-space: nowrap;
  color: v-bind('theme.textColor3');
}

.pane {
  min-width: 0;
  margin: 0;
  padding: 5px 10px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: Consolas, Monaco, monospace;
  font-size: 16px;
  line-height: 24px;
}

.pane.in {
  background-color: rgba(128, 128, 128, 0.07);
  border: 1px solid rgba(128, 128, 128, 0.14);
}

.pane.ok {
  background-color: rgba(24, 160, 88, 0.08);
  border: 1px solid rgba(24, 160, 88, 0.26);
}

.note {
  margin: 16px 0 0;
  font-size: 13px;
  color: v-bind('theme.textColor3');
}
</style>

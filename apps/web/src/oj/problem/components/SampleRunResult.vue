<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { useSubmissionStore } from "oj/store/submission"
import { SubmissionStatus } from "utils/constants"
import TrialErrorNote from "./TrialErrorNote.vue"
import WrongAnswerExplain from "./WrongAnswerExplain.vue"
import ResultHeader from "./ResultHeader.vue"

/**
 * 「结果」页签里「运行例子」那一段：每个例子对没对上，点一个看细节。
 * 没对上的说明复用判完之后那一套（WrongAnswerExplain）；比赛里只摆输出、不给提示句。
 */

const { sampleRuns, samplesRunning, samplesCode } = useSubmissionStore().trial
const theme = useThemeVars()
const route = useRoute()
const inContest = computed(() => !!route.params.contestID)

const failedCount = computed(
  () => sampleRuns.value.filter((run) => run.result !== SubmissionStatus.accepted).length,
)

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

  <n-empty
    v-else-if="!sampleRuns.length"
    class="state"
    description="还没运行过。点工具栏的「运行例子」，用题目里的例子试跑一遍，不算提交"
  />

  <n-flex v-else vertical :size="12">
    <!-- 设计稿「运行例子：例子 2 没对上（不算提交）」：标题、「不算提交」、各例子的芯片在一行 -->
    <ResultHeader
      :kind="failedCount ? 'error' : 'success'"
      :title="failedCount ? `试跑：${failedCount} 个例子没对上` : '试跑：例子都对上了'"
      sub="（不算提交）"
    >
      <template #extra>
        <div class="runs">
          <button
            v-for="run in sampleRuns"
            :key="run.index"
            type="button"
            class="run"
            :class="[
              run.result === SubmissionStatus.accepted ? 'ok' : 'bad',
              { active: selected === run.index },
            ]"
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
            <svg
              v-else
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            例子 {{ run.index + 1 }}
          </button>
        </div>
      </template>
    </ResultHeader>

    <template v-if="current">
      <!-- 对上了：三栏摆出来就行 -->
      <div v-if="current.result === SubmissionStatus.accepted" class="passed-card">
        <div class="blocks">
          <div class="block">
            <div class="label">输入</div>
            <pre>{{ current.input }}</pre>
          </div>
          <div class="block">
            <div class="label">正确输出</div>
            <pre>{{ current.expected }}</pre>
          </div>
          <div class="block">
            <div class="label">你的输出</div>
            <pre>{{ current.output }}</pre>
          </div>
        </div>
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
      />
      <!-- 没跑完：编译不过、运行出错、超时 -->
      <TrialErrorNote
        v-else
        :result="current.result"
        :output="current.output"
        :language="samplesCode?.language ?? ''"
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
  height: 26px;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.run.ok {
  border: 1px solid rgba(24, 160, 88, 0.35);
  background-color: rgba(24, 160, 88, 0.1);
  color: v-bind("theme.successColorPressed");
}

.run.bad {
  border: 1px solid rgba(208, 48, 80, 0.4);
  background-color: rgba(208, 48, 80, 0.07);
  color: v-bind("theme.errorColorPressed");
}

.run.active {
  font-weight: 600;
  border-width: 1.5px;
}

.run.ok.active {
  border-color: v-bind("theme.successColor");
}

.run.bad.active {
  border-color: v-bind("theme.errorColor");
}

.passed-card {
  padding: 12px 14px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.06);
  border: 1px solid v-bind("theme.dividerColor");
}

.blocks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.block {
  min-width: 0;
  padding: 6px 10px 8px;
  border-radius: 5px;
  background-color: v-bind("theme.cardColor");
  border: 1px solid v-bind("theme.dividerColor");
}

.label {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 4px;
}

.block pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: Monaco, Consolas, monospace;
  font-size: 14px;
}

.note {
  margin: 12px 0 0;
  font-size: 13px;
  color: v-bind("theme.textColor3");
}
</style>

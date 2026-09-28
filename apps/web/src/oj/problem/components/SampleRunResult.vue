<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { useSubmissionStore } from "oj/store/submission"
import { SubmissionStatus } from "utils/constants"
import { parseTime } from "utils/functions"
import TrialErrorNote from "./TrialErrorNote.vue"
import WrongAnswerExplain from "./WrongAnswerExplain.vue"

/**
 * 「结果」页签里「运行例子」那一段：每个例子对没对上，点一个看细节。
 * 没对上的说明复用判完之后那一套（WrongAnswerExplain）；比赛里只摆输出、不给提示句。
 */

const { sampleRuns, samplesRunning, samplesRunAt, samplesCode } = useSubmissionStore().trial
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
    <n-flex align="center" :size="10">
      <n-icon :size="22" :color="failedCount ? theme.errorColor : theme.successColor">
        <Icon :icon="failedCount ? 'ph:x-circle-fill' : 'ph:check-circle-fill'" />
      </n-icon>
      <span class="title" :style="{ color: failedCount ? theme.errorColor : theme.successColor }">
        {{ failedCount ? `试跑：${failedCount} 个例子没对上` : "试跑：例子都对上了" }}
      </span>
      <n-text depth="3"
        >（不算提交{{ samplesRunAt ? ` · ${parseTime(samplesRunAt, "HH:mm")}` : "" }}）</n-text
      >
    </n-flex>

    <n-flex :size="6">
      <n-button
        v-for="run in sampleRuns"
        :key="run.index"
        size="small"
        round
        :type="run.result === SubmissionStatus.accepted ? 'success' : 'error'"
        :secondary="selected !== run.index"
        @click="selected = run.index"
      >
        <template #icon>
          <Icon :icon="run.result === SubmissionStatus.accepted ? 'ph:check-bold' : 'ph:x-bold'" />
        </template>
        例子 {{ run.index + 1 }}
      </n-button>
    </n-flex>

    <template v-if="current">
      <!-- 对上了：三栏摆出来就行 -->
      <n-card v-if="current.result === SubmissionStatus.accepted" embedded size="small">
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
      </n-card>
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

    <n-text depth="3" class="note">
      例子都对上了再按「提交代码」。例子对了也可能在别的测试点上错，提交才算数。
    </n-text>
  </n-flex>
</template>

<style scoped>
.state {
  margin-top: 32px;
  justify-content: center;
}

.title {
  font-size: 17px;
  font-weight: 700;
}

.blocks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.block {
  min-width: 0;
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
  font-size: 13px;
}
</style>

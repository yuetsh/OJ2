<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"
import { SubmissionStatus } from "utils/constants"
import TrialErrorNote from "./TrialErrorNote.vue"

/**
 * 「结果」页签里「自己输入」那一段：自己编一组输入跑一下，看看输出。不判对错、不算提交。
 * 顶替原来顶栏「自测」模式那个单独的编辑器（EditorForTest）。
 */

const submissionStore = useSubmissionStore()
const { customInput, customOutput, customResult, customRunning } = submissionStore.trial
const { problem } = storeToRefs(useProblemStore())
const codeStore = useCodeStore()

function fillSample(input: string) {
  customInput.value = input
}
</script>

<template>
  <n-flex vertical :size="10">
    <n-flex align="center" justify="space-between">
      <span class="label">输入</span>
      <n-text depth="3" class="hint">自己编数据试试，这里不判对错、不算提交</n-text>
    </n-flex>
    <n-input
      v-model:value="customInput"
      type="textarea"
      :autosize="{ minRows: 4, maxRows: 10 }"
      placeholder="在这里写输入，和题目里的「输入」格式一样"
      class="mono"
    />
    <n-flex align="center" :size="8">
      <n-button
        type="primary"
        secondary
        :loading="customRunning"
        :disabled="!codeStore.code.value.trim()"
        @click="submissionStore.runCustom()"
      >
        用这组数据运行
      </n-button>
      <n-button
        v-for="(sample, index) in problem?.samples ?? []"
        :key="index"
        quaternary
        size="small"
        @click="fillSample(sample.input)"
      >
        填入例子 {{ index + 1 }}
      </n-button>
    </n-flex>

    <template v-if="customResult !== null">
      <span class="label">输出</span>
      <TrialErrorNote
        v-if="customResult !== SubmissionStatus.accepted"
        :result="customResult"
        :output="customOutput"
        :language="codeStore.code.language"
      />
      <pre v-else-if="customOutput" class="output">{{ customOutput }}</pre>
      <n-text v-else depth="3">（什么都没有输出）</n-text>
    </template>
  </n-flex>
</template>

<style scoped>
.label {
  font-weight: 600;
}

.hint {
  font-size: 13px;
}

.mono :deep(textarea) {
  font-family: Monaco, Consolas, monospace;
}

.output {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: Monaco, Consolas, monospace;
  font-size: 14px;
}
</style>

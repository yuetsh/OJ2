<script setup lang="ts">
import { Icon } from '@iconify/vue'
import SectionHead from './SectionHead.vue'
import { useThemeVars } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { useCodeStore } from 'oj/store/code'
import { useProblemStore } from 'oj/store/problem'
import { useSubmissionStore } from 'oj/store/submission'
import { SubmissionStatus } from 'utils/constants'
import TrialErrorNote from './TrialErrorNote.vue'

/**
 * 「结果」页签里「自己输入」那一段：自己编一组输入跑一下，看看输出。不判对错、不算提交。
 * 顶替原来顶栏「自测」模式那个单独的编辑器（EditorForTest）。
 */

const submissionStore = useSubmissionStore()
const { customInput, customOutput, customResult, customNote, customRuntimeError, customCode, customRunning } = submissionStore.trial
const { problem } = storeToRefs(useProblemStore())
const codeStore = useCodeStore()
const theme = useThemeVars()
const route = useRoute()
// 比赛里出错只给按结果码的那一句，不说第几行、为什么（和「运行例子」一样）
const inContest = computed(() => !!route.params.contestID)

function fillSample(input: string) {
  customInput.value = input
}
</script>

<template>
  <!-- 设计稿「自己输入：顶替原来的『自测』模式」；「这里不判对错」在分段那一行右边（ResultPane） -->
  <div class="custom">
    <SectionHead icon="input">输入</SectionHead>
    <n-input
      v-model:value="customInput"
      type="textarea"
      :autosize="{ minRows: 4, maxRows: 10 }"
      placeholder="在这里写输入，和题目里的「输入」格式一样"
      class="mono"
    />
    <div class="actions">
      <n-button type="primary" secondary :loading="customRunning" :disabled="!codeStore.code.value.trim()" @click="submissionStore.runCustom()">
        <template #icon><Icon icon="ph:play-fill" /></template>
        用这组数据运行
      </n-button>
      <n-button v-for="(sample, index) in problem?.samples ?? []" :key="index" text type="primary" class="fill" @click="fillSample(sample.input)">
        填入例子 {{ index + 1 }}
      </n-button>
    </div>

    <SectionHead icon="output" class="output-head">输出</SectionHead>
    <TrialErrorNote
      v-if="customResult !== null && customResult !== SubmissionStatus.accepted"
      :result="customResult"
      :output="customOutput"
      :language="codeStore.code.language"
      :note="customNote"
      :runtime-error="customRuntimeError"
      :code="customCode"
      :plain="inContest"
    />
    <pre v-else class="output" :class="{ empty: !customOutput }">{{ customResult === null ? '' : customOutput || '（什么都没有输出）' }}</pre>
  </div>
</template>

<style scoped>
.custom {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.output-head {
  margin-top: 14px;
}

.mono :deep(textarea) {
  font-family: Consolas, Monaco, monospace;
  font-size: 16px;
  line-height: 24px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 6px;
}

.fill {
  font-size: 14px;
}

.output {
  margin: 0;
  min-height: 60px;
  box-sizing: border-box;
  padding: 10px 10px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: Consolas, Monaco, monospace;
  font-size: 16px;
  line-height: 24px;
  border: 1px solid rgba(128, 128, 128, 0.14);
}

.output.empty {
  color: v-bind('theme.textColor3');
}
</style>

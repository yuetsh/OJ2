<script setup lang="ts">
import { useThemeVars } from "naive-ui"
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
const {
  customInput,
  customOutput,
  customResult,
  customNote,
  customRuntimeError,
  customCode,
  customRunning,
} = submissionStore.trial
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
    <span class="label">输入</span>
    <n-input
      v-model:value="customInput"
      type="textarea"
      :autosize="{ minRows: 4, maxRows: 10 }"
      placeholder="在这里写输入，和题目里的「输入」格式一样"
      class="mono"
    />
    <div class="actions">
      <n-button
        type="primary"
        ghost
        :loading="customRunning"
        :disabled="!codeStore.code.value.trim()"
        @click="submissionStore.runCustom()"
      >
        用这组数据运行
      </n-button>
      <n-button
        v-for="(sample, index) in problem?.samples ?? []"
        :key="index"
        text
        class="fill"
        @click="fillSample(sample.input)"
      >
        填入例子 {{ index + 1 }}
      </n-button>
    </div>

    <span class="label">输出</span>
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
    <pre v-else class="output" :class="{ empty: !customOutput }">{{
      customResult === null ? "" : customOutput || "（什么都没有输出）"
    }}</pre>
  </div>
</template>

<style scoped>
.custom {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 13px;
  font-weight: 600;
}

.mono :deep(textarea) {
  font-family: Consolas, Monaco, monospace;
}

.actions {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 6px;
}

.fill {
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.output {
  margin: 0;
  min-height: 88px;
  box-sizing: border-box;
  padding: 10px 10px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: Consolas, Monaco, monospace;
  font-size: 14px;
}

.output.empty {
  color: v-bind("theme.textColor3");
}
</style>

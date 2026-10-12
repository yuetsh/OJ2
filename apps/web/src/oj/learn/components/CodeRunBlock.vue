<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { StatisticInfo, TrialRunResponse } from "@oj2/contract"
import { errorMessage } from "utils/api"
import { SubmissionStatus } from "utils/constants"
import { trialRun } from "utils/judge"
import { explainCCompileError } from "oj/problem/utils/cError"
import { explainPythonCompileError } from "oj/problem/utils/pythonError"
import { explainRuntimeError } from "oj/problem/utils/runtimeError"
import { useAuthModalStore } from "shared/store/authModal"
import { useUserStore } from "shared/store/user"

const CodeEditor = defineAsyncComponent(() => import("shared/components/CodeEditor.vue"))

/**
 * 正文里的一段代码：就地改、就地运行（设计稿「代码块就地运行」那块画板）。
 *
 * 运行走题目页同一台判题机（POST /trial-runs，带 tutorialId），不算提交。
 * 报错用题目页那套中文解释（pythonError / cError / runtimeError），原文收在下面。
 * 代码里读输入（input() / scanf）才出输入框。
 */
const props = defineProps<{
  code: string
  lang: "python" | "c"
  tutorialId: number
}>()

const userStore = useUserStore()
const authModal = useAuthModalStore()
const message = useMessage()
const { copy } = useClipboard({ legacy: true })

const value = ref(props.code)
const input = ref("")
const running = ref(false)

type Outcome =
  | { kind: "output"; text: string }
  | { kind: "error"; title: string; message: string; raw: string; needInput?: boolean }
  | { kind: "busy"; message: string }
const outcome = ref<Outcome | null>(null)

// 换课时组件实例可能被复用（v-for 的 key 是段落序号），跟着原文重置
watch(
  () => props.code,
  (code) => {
    value.value = code
    input.value = ""
    outcome.value = null
  },
)

const edited = computed(() => value.value !== props.code)
const needsInput = computed(() =>
  props.lang === "python"
    ? /\binput\s*\(/.test(value.value)
    : /\b(scanf|getchar|gets|fgets|cin)\b/.test(value.value),
)
const language = computed(() => (props.lang === "c" ? "C" : "Python"))
const lineCount = computed(() => value.value.split("\n").length)

const TOO_MUCH_OUTPUT =
  "程序输出太多了，一直停不下来：多半是循环没有结束的条件（条件一直成立、循环变量忘了改），在不停地打印。"

/** 判题机的临时目录名对学生没有意义，只留文件名 */
function cleanRaw(text: string) {
  return text.replace(/\/judger\/run\/[^/"]+\//g, "").trim()
}

function compileOutcome(raw: string): Outcome {
  const ex =
    props.lang === "python"
      ? explainPythonCompileError(raw, value.value)
      : explainCCompileError(raw, value.value, "C")
  return {
    kind: "error",
    title: ex?.line ? `第 ${ex.line} 行出错` : "代码有错，没能运行",
    message: ex?.message ?? "",
    raw: cleanRaw(raw),
  }
}

function runtimeOutcome(
  result: SubmissionStatus,
  output: string,
  info: NonNullable<StatisticInfo["runtime_error"]> | undefined,
): Outcome {
  // 读输入读到头了：题目页那句「input() 用的次数超过了输入的行数」是说程序写错了，
  // 教程里多半是下面的输入框还空着，要说的是「先填输入」
  if (result === SubmissionStatus.runtime_error && info?.type === "EOFError") {
    return input.value.trim()
      ? {
          kind: "error",
          title: "输入不够",
          message:
            "程序每执行一次 input() 就读一行。输入框里的行数比它要读的少，按一行一个再多填几行。",
          raw: cleanRaw(output),
          needInput: true,
        }
      : {
          kind: "error",
          title: "还没填输入",
          message: "程序运行到 input() 在等你输入内容。先在上面的「输入」框里填好，再点运行。",
          raw: cleanRaw(output),
          needInput: true,
        }
  }
  if (result === SubmissionStatus.runtime_error) {
    return {
      kind: "error",
      title: info?.line ? `运行到第 ${info.line} 行出错了` : "运行到一半出错了",
      message: info ? explainRuntimeError(info, value.value) : "",
      raw: cleanRaw(output),
    }
  }
  if (
    result === SubmissionStatus.cpu_time_limit_exceeded ||
    result === SubmissionStatus.real_time_limit_exceeded
  ) {
    return {
      kind: "error",
      title: "运行超时了",
      message: needsInput.value
        ? "程序一直没停下来：看看是不是在等输入（上面的输入框填够了吗），或者循环停不下来。"
        : "程序一直没停下来：多半是循环没有结束的条件。",
      raw: cleanRaw(output),
    }
  }
  if (result === SubmissionStatus.memory_limit_exceeded) {
    return { kind: "error", title: "内存用太多了", message: "", raw: cleanRaw(output) }
  }
  return { kind: "busy", message: "运行没成功，过一会儿再点一次。" }
}

function toOutcome(response: TrialRunResponse): Outcome {
  if (response.status === "compile-error") return compileOutcome(response.message)
  if (response.status === "too-much-output") {
    return { kind: "error", title: "输出太多了", message: TOO_MUCH_OUTPUT, raw: "" }
  }
  const [item] = response.cases
  if (!item) return { kind: "busy", message: "运行没成功，过一会儿再点一次。" }
  const result = item.result as SubmissionStatus
  if (result === SubmissionStatus.accepted || result === SubmissionStatus.wrong_answer) {
    return { kind: "output", text: item.output.trimEnd() }
  }
  return runtimeOutcome(result, item.output, item.runtimeError)
}

async function run() {
  if (!userStore.isAuthed) {
    authModal.openLoginModal()
    return
  }
  if (running.value || !value.value.trim()) return
  running.value = true
  try {
    const response = await trialRun({
      tutorialId: props.tutorialId,
      language: language.value,
      code: value.value,
      cases: [{ input: input.value }],
    })
    outcome.value = toOutcome(response)
  } catch (error) {
    // 后端的文案是给学生看的（「上一次还没跑完」「试运行的人太多了」）
    outcome.value = {
      kind: "busy",
      message: errorMessage(error, "运行的服务暂时连不上，过一会儿再试。"),
    }
  } finally {
    running.value = false
  }
}

function restore() {
  value.value = props.code
  outcome.value = null
}

async function copyCode() {
  await copy(value.value)
  message.success("已复制")
}
</script>

<template>
  <div class="block">
    <div class="bar">
      <span class="lang">{{ language }}</span>
      <span class="grow" />
      <template v-if="edited">
        <span class="edited">改过</span>
        <button type="button" class="tool" @click="restore">
          <Icon icon="ph:arrow-counter-clockwise" :width="14" />还原
        </button>
      </template>
      <button type="button" class="run" :class="{ busy: running }" :disabled="running" @click="run">
        <template v-if="running">运行中…</template>
        <template v-else><Icon icon="ph:play-fill" :width="12" />运行</template>
      </button>
      <button type="button" class="tool" aria-label="复制" @click="copyCode">
        <Icon icon="ph:copy" :width="14" />
      </button>
    </div>
    <div class="editor" :style="{ minHeight: `${lineCount * 22 + 16}px` }">
      <CodeEditor v-model:value="value" :language="language" :font-size="14" height="auto" />
    </div>
    <div
      v-if="needsInput"
      class="pane input"
      :class="{ ask: outcome?.kind === 'error' && outcome.needInput }"
    >
      <div class="label">输入</div>
      <n-input
        v-model:value="input"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 6 }"
        placeholder="程序要读的内容写在这里，一行一个"
        class="mono"
      />
    </div>
    <div v-if="outcome?.kind === 'output'" class="pane">
      <div class="label">输出</div>
      <pre class="out" :class="{ empty: !outcome.text }">{{
        outcome.text || "（什么都没有输出）"
      }}</pre>
    </div>
    <div v-else-if="outcome?.kind === 'error'" class="pane error">
      <div class="label strong">{{ outcome.title }}</div>
      <div v-if="outcome.message" class="explain">{{ outcome.message }}</div>
      <pre v-if="outcome.raw" class="raw">{{ outcome.raw }}</pre>
    </div>
    <div v-else-if="outcome?.kind === 'busy'" class="pane">
      <div class="busy-text">{{ outcome.message }}</div>
    </div>
  </div>
</template>

<style scoped>
.block {
  margin: 0 0 16px;
  border: 1px solid var(--learn-line);
  border-radius: 6px;
  overflow: hidden;
  background: var(--learn-soft);
}
.bar {
  height: 36px;
  box-sizing: border-box;
  padding: 0 6px 0 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--learn-line);
  font-size: 12px;
}
.lang {
  opacity: 0.55;
}
.grow {
  flex: 1;
}
.edited {
  color: var(--learn-orange-text);
}
.tool {
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  font: inherit;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.tool:hover {
  opacity: 1;
  background: var(--learn-soft);
}
.run {
  height: 26px;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 4px;
  border: 1px solid var(--learn-green);
  background: transparent;
  color: var(--learn-green-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
.run:hover {
  background: var(--learn-green-bg);
}
.run.busy {
  border-color: var(--learn-line);
  color: inherit;
  opacity: 0.6;
  font-weight: 400;
  cursor: default;
}
.editor :deep(.cm-editor) {
  background: transparent;
}
.editor :deep(.cm-gutters) {
  background: transparent;
  border-right: 0;
}
.editor :deep(.cm-scroller) {
  font-family: var(--learn-code-font);
  line-height: 22px;
  padding: 8px 0;
}
.pane {
  border-top: 1px solid var(--learn-line);
  padding: 10px 14px 12px;
  background: var(--learn-pane);
}
.label {
  font-size: 12px;
  opacity: 0.6;
  margin-bottom: 4px;
}
.label.strong {
  opacity: 1;
  font-weight: 600;
  color: var(--learn-red-text);
}
.out,
.raw {
  margin: 0;
  font-family: var(--learn-code-font);
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-all;
}
.out.empty {
  opacity: 0.5;
}
.explain {
  font-size: 14px;
  line-height: 1.7;
  margin-bottom: 6px;
}
.raw {
  font-size: 12px;
  line-height: 18px;
  opacity: 0.55;
}
.busy-text {
  font-size: 14px;
  color: var(--learn-orange-text);
}
.ask :deep(.n-input) {
  --n-border: 1px solid var(--learn-orange) !important;
}
.ask .label {
  color: var(--learn-orange-text);
  opacity: 1;
  font-weight: 600;
}
.mono :deep(textarea) {
  font-family: var(--learn-code-font);
}
</style>

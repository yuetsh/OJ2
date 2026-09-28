<script setup lang="ts">
import { useCodeStore } from "oj/store/code"
import { findChinesePunctuation } from "oj/problem/utils/chinesePunctuation"
import {
  applyFixes,
  clearErrorMark,
  currentCode,
  showErrorMark,
  showPunctuationMarks,
} from "oj/problem/utils/errorMark"
import { explainPythonCompileError } from "oj/problem/utils/pythonError"

/**
 * Python 语法错误的中文说明卡片。两处用它：提交前的语法检查（SubmitCode，报错来自
 * 服务端的 CPython）和判题回来的编译错误（SubmissionResult，来自判题机）。两边是
 * 同一个大版本的 CPython，报错原文一样，所以共用一张翻译表。
 *
 * 挂上就在编辑器里标出位置，卸掉就清掉。
 */
const props = defineProps<{
  /** CPython 的报错原文（判题机的 `err_info` 或 `/code/format` 的 syntax-error） */
  errInfo: string
}>()

const codeStore = useCodeStore()

const explanation = computed(() => explainPythonCompileError(props.errInfo))

/** 判题机的临时目录名（`/judger/run/<32 位随机串>/`）对学生没有意义，只剩文件名 */
const rawError = computed(() => props.errInfo.replace(/\/judger\/run\/[^/"]+\//g, ""))

/** 出错那一行拆成三段，中间那段是 `^` 标的地方 */
const sourceParts = computed(() => {
  const ex = explanation.value
  if (!ex?.sourceLine) return null
  const { sourceLine: text, caret } = ex
  if (!caret) return { before: text, marked: "", after: "" }
  return {
    before: text.slice(0, caret.from),
    marked: text.slice(caret.from, caret.to),
    after: text.slice(caret.to),
  }
})

// 数的是编辑器里**现在**的代码：学生可能已经自己改掉几处了
const punctuationFixCount = computed(() =>
  explanation.value?.punctuation ? findChinesePunctuation(codeStore.code.value).length : 0,
)
const fixedCount = ref<number | null>(null)

function fixPunctuation() {
  const code = currentCode()
  if (code === null) return
  const fixes = findChinesePunctuation(code)
  if (applyFixes(fixes)) fixedCount.value = fixes.length
}

watch(
  explanation,
  (ex) => {
    fixedCount.value = null
    if (ex?.line) showErrorMark(ex.line, ex.sourceLine, ex.caret)
    else clearErrorMark()
    // 中文标点一处不漏地标出来，和按钮上的「N 处」对得上
    const code = ex?.punctuation ? currentCode() : null
    if (code !== null) showPunctuationMarks(findChinesePunctuation(code))
  },
  { immediate: true },
)

onUnmounted(clearErrorMark)
</script>

<template>
  <n-card embedded class="explain-card">
    <n-flex vertical :size="12">
      <template v-if="explanation">
        <div class="explain">
          <b v-if="explanation.line">第 {{ explanation.line }} 行：</b>{{ explanation.message }}
        </div>
        <pre v-if="sourceParts" class="explain-code">{{ sourceParts.before
          }}<mark>{{ sourceParts.marked }}</mark>{{ sourceParts.after }}</pre>
        <n-flex v-if="explanation.punctuation" align="center">
          <n-button v-if="punctuationFixCount" type="primary" size="small" @click="fixPunctuation">
            把中文标点都换成英文（{{ punctuationFixCount }} 处）
          </n-button>
          <n-text v-else-if="fixedCount" type="success">
            换好了 {{ fixedCount }} 处，再提交一次试试。
          </n-text>
        </n-flex>
        <n-collapse>
          <n-collapse-item title="原始报错（英文）" name="raw">
            <div class="raw">{{ rawError }}</div>
          </n-collapse-item>
        </n-collapse>
      </template>
      <!-- 翻译表没覆盖到的句式（生产数据里约 0.3%）：照旧给原文 -->
      <template v-else>
        <div class="explain">请仔细检查，看看代码的格式是不是写错了！</div>
        <div class="raw">{{ rawError }}</div>
      </template>
    </n-flex>
  </n-card>
</template>

<style scoped>
/* 结果弹窗不限宽，长句子不折行会把弹窗撑出屏幕 */
.explain-card {
  max-width: 560px;
}

.explain {
  font-size: 16px;
  line-height: 1.7;
}

.explain-code {
  margin: 0;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 15px;
  white-space: pre-wrap;
  word-break: break-all;
  background-color: rgba(128, 128, 128, 0.1);
}

.explain-code mark {
  color: inherit;
  background-color: rgba(208, 48, 80, 0.25);
  text-decoration: underline wavy #d03050;
  text-underline-offset: 3px;
}

.raw {
  white-space: pre;
  overflow-x: auto;
  line-height: 1.5;
}
</style>

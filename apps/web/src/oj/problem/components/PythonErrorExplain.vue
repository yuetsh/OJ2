<script setup lang="ts">
import { useThemeVars } from "naive-ui"
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
const theme = useThemeVars()

const explanation = computed(() => explainPythonCompileError(props.errInfo))

/** 判题机的临时目录名（`/judger/run/<32 位随机串>/`）对学生没有意义，只剩文件名 */
const rawError = computed(() => props.errInfo.replace(/\/judger\/run\/[^/"]+\//g, ""))

/**
 * 报错只点名第一处。别的行也有中文标点的话，一句话带过（设计稿「语法没过」：
 * 「第 4 行也有一个中文冒号，编辑器里都标出来了」）。原来这里还摆一段出错那行的代码摘录，
 * 编辑器里已经标着红，设计稿里去掉了
 */
const otherPunctuationLines = computed(() => {
  const ex = explanation.value
  if (!ex?.punctuation) return []
  const code = codeStore.code.value
  const lines = new Set<number>()
  for (const fix of findChinesePunctuation(code)) {
    lines.add(code.slice(0, fix.from).split("\n").length)
  }
  lines.delete(ex.line ?? -1)
  return [...lines].sort((a, b) => a - b)
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
  <div class="explain-card">
    <template v-if="explanation">
      <p class="explain">
        <b v-if="explanation.line">第 {{ explanation.line }} 行：</b>{{ explanation.message }}
      </p>
      <p v-if="otherPunctuationLines.length" class="explain other">
        第 {{ otherPunctuationLines.join("、") }} 行也有中文标点，编辑器里都标出来了。
      </p>
      <div v-if="explanation.punctuation">
        <n-button v-if="punctuationFixCount" type="primary" @click="fixPunctuation">
          把中文标点都换成英文（{{ punctuationFixCount }} 处）
        </n-button>
        <n-text v-else-if="fixedCount" type="success">
          换好了 {{ fixedCount }} 处，再提交一次试试。
        </n-text>
      </div>
      <n-collapse>
        <n-collapse-item title="原始报错（英文）" name="raw">
          <div class="raw">{{ rawError }}</div>
        </n-collapse-item>
      </n-collapse>
    </template>
    <!-- 翻译表没覆盖到的句式（生产数据里约 0.3%）：照旧给原文 -->
    <template v-else>
      <p class="explain">请仔细检查，看看代码的格式是不是写错了！</p>
      <div class="raw">{{ rawError }}</div>
    </template>
  </div>
</template>

<style scoped>
/* 和答错的说明同一种浅灰卡片（设计稿「语法没过」） */
.explain-card {
  padding: 12px 14px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.06);
  border: 1px solid v-bind("theme.dividerColor");
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.explain {
  margin: 0;
  line-height: 1.7;
}

.explain.other {
  font-size: 14px;
  color: v-bind("theme.textColor2");
}

.raw {
  white-space: pre;
  overflow-x: auto;
  line-height: 1.5;
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
}
</style>

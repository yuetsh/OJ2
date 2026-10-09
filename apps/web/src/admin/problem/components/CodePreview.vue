<script setup lang="ts">
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { useThemeVars } from "naive-ui"
import { useMermaid } from "shared/composables/useMermaid"
import { DIFFICULTY, SOURCES } from "utils/constants"
import { getTagColor } from "utils/functions"
import type { AstRules, BlankProblem, LANGUAGE } from "utils/types"
import type { AstCheckState, FlowchartMode, PreviewTab } from "./editorTypes"
import type { TemplateParts } from "./codeTemplate"

const CodeEditor = defineAsyncComponent(() => import("shared/components/CodeEditor.vue"))

/**
 * 编程题出题页的右栏：学生打开这道题看到的样子（设计稿「编程题出题页」B）。
 * 题面的排法照 oj/problem/components/ProblemContent.vue，但不复用它 —— 那个组件读的是
 * 题目页的 store 和入口上下文，出题页这里只有一份还没存的表单。
 */
const props = defineProps<{
  displayId: string
  title: string
  difficulty: BlankProblem["difficulty"]
  description: string
  inputDescription: string
  outputDescription: string
  hint: string
  examples: { input: string; output: string }[]
  /** 例子来自哪几组，比如「测试数据第 1–4 组」 */
  examplesNote: string
  /** 测试数据太大不展开、例子单独写的时候 */
  bigData?: boolean
  languages: LANGUAGE[]
  templates: Partial<Record<LANGUAGE, TemplateParts>>
  astRules: AstRules | null
  astChecks: AstCheckState
  flowchartMode: FlowchartMode
  mermaidCode: string
  flowchartHint: string
}>()

const tab = defineModel<PreviewTab>("tab", { required: true })
const emit = defineEmits<{ renderState: [ok: boolean] }>()

const theme = useThemeVars()
const isDark = useDark()

const isBlankHtml = (html: string) => !html.trim() || html === "<p><br></p>"

// ---------------------------------------------------------------- 语法要求

const KIND_TAG_TYPE = { require: "success", forbid: "error", count: "info" } as const

function requirementsOf(lang: string) {
  const rules = props.astRules?.[lang] ?? []
  const state = props.astChecks[lang]
  return rules.map((rule, i) => ({
    text:
      rule.message ||
      (state && !("error" in state) ? state.rules[i]?.description : "") ||
      "（规则还没写完）",
    kind: rule.engine.startsWith("must_not")
      ? ("forbid" as const)
      : rule.engine.startsWith("count")
        ? ("count" as const)
        : ("require" as const),
  }))
}

const requirementLanguages = computed(() =>
  props.languages.filter((lang) => (props.astRules?.[lang]?.length ?? 0) > 0),
)

// ---------------------------------------------------------------- 编辑器

const editorLanguage = ref<LANGUAGE>(props.languages[0] ?? "Python")
watch(
  () => props.languages,
  (langs) => {
    if (langs.length && !langs.includes(editorLanguage.value)) editorLanguage.value = langs[0]!
  },
)

const editorParts = computed(() => props.templates[editorLanguage.value])
const editorCode = computed(() => {
  const own = editorParts.value?.template
  return own?.trim() ? own : SOURCES[editorLanguage.value]
})

// ---------------------------------------------------------------- 流程图

const container = useTemplateRef<HTMLElement>("chart")
const { renderFlowchart, renderError, renderSuccess } = useMermaid()

async function render() {
  await renderFlowchart(container.value, props.mermaidCode)
  emit("renderState", renderSuccess.value)
}

// 改了先报「没验证」，防抖之后的渲染跑完再报结果（和 MermaidEditor 同一个理由）
watch(
  () => props.mermaidCode,
  () => emit("renderState", false),
)
watchDebounced(() => props.mermaidCode, render, { debounce: 300, maxWait: 1000 })
onMounted(() => nextTick(render))
</script>

<template>
  <aside class="preview" aria-label="学生看到的样子">
    <div class="previewHead">
      <b>学生看到的样子</b>
      <div class="grow"></div>
      <n-radio-group v-model:value="tab" size="small">
        <n-radio-button value="statement">题面</n-radio-button>
        <n-radio-button value="editor">编辑器</n-radio-button>
        <n-radio-button value="flowchart" :class="{ dim: flowchartMode === 'none' }">
          流程图
        </n-radio-button>
      </n-radio-group>
    </div>

    <!-- 题面 -->
    <div v-show="tab === 'statement'" class="page">
      <div class="titleRow">
        <span v-if="displayId" class="pid">{{ displayId }}</span>
        <h2>{{ title || "（题目还没起名）" }}</h2>
      </div>
      <div class="meta">
        <n-tag size="small" :bordered="false" :type="getTagColor(difficulty)">
          {{ DIFFICULTY[difficulty] }}
        </n-tag>
      </div>

      <div v-if="requirementLanguages.length" class="requirements">
        <span class="requirementsHead">语法要求</span>
        <template v-for="lang in requirementLanguages" :key="lang">
          <span v-if="requirementLanguages.length > 1 || languages.length > 1" class="langLabel">
            {{ lang }}
          </span>
          <n-tag
            v-for="(rule, i) in requirementsOf(lang)"
            :key="`${lang}-${i}`"
            :type="KIND_TAG_TYPE[rule.kind]"
            size="small"
            :bordered="false"
          >
            {{ rule.text }}
          </n-tag>
        </template>
        <span class="muted">提交时会逐条检查</span>
      </div>

      <h3 class="title">描述</h3>
      <MdPreview
        v-if="!isBlankHtml(description)"
        preview-theme="vuepress"
        :model-value="description"
        :theme="isDark ? 'dark' : 'light'"
      />
      <p v-else class="placeholder">（还没写描述）</p>

      <div class="io">
        <section>
          <h3 class="title">输入</h3>
          <MdPreview
            preview-theme="vuepress"
            :model-value="inputDescription"
            :theme="isDark ? 'dark' : 'light'"
          />
        </section>
        <section>
          <h3 class="title">输出</h3>
          <MdPreview
            preview-theme="vuepress"
            :model-value="outputDescription"
            :theme="isDark ? 'dark' : 'light'"
          />
        </section>
      </div>

      <button v-if="flowchartMode === 'show'" type="button" class="fold" @click="tab = 'flowchart'">
        <span>›</span><b>老师给的参考流程图</b>
        <span class="muted">学生点开才看到 · 在「流程图」里看</span>
      </button>

      <div class="exampleHead">
        <h3 class="title">例子</h3>
        <div class="grow"></div>
        <span class="muted">{{ examplesNote }}</span>
      </div>
      <div v-if="examples.length" class="sampleTable" role="table" aria-label="例子">
        <span role="columnheader"></span>
        <span role="columnheader" class="sampleLabel">输入</span>
        <span role="columnheader" class="sampleLabel">输出</span>
        <template v-for="(sample, index) of examples" :key="index">
          <span class="sampleNo" role="rowheader">例子 {{ index + 1 }}</span>
          <pre class="sampleCell" role="cell">{{ sample.input }}</pre>
          <pre class="sampleCell" role="cell">{{ sample.output }}</pre>
        </template>
      </div>
      <p v-else class="placeholder">
        {{ bigData ? "在左边加一个例子" : "在左边的测试数据里勾几组「当例子」" }}
      </p>

      <template v-if="!isBlankHtml(hint)">
        <h3 class="title">提示</h3>
        <MdPreview
          preview-theme="vuepress"
          :model-value="hint"
          :theme="isDark ? 'dark' : 'light'"
        />
      </template>
    </div>

    <!-- 编辑器 -->
    <div v-show="tab === 'editor'" class="page">
      <div class="editorHead">
        <n-radio-group v-model:value="editorLanguage" size="small">
          <n-radio-button v-for="lang in languages" :key="lang" :value="lang">
            {{ lang }}
          </n-radio-button>
        </n-radio-group>
      </div>
      <div v-if="(astRules?.[editorLanguage]?.length ?? 0) > 0" class="requirements">
        <span class="requirementsHead">语法要求</span>
        <n-tag
          v-for="(rule, i) in requirementsOf(editorLanguage)"
          :key="i"
          :type="KIND_TAG_TYPE[rule.kind]"
          size="small"
          :bordered="false"
        >
          {{ rule.text }}
        </n-tag>
      </div>
      <p class="muted small">
        {{
          editorParts?.template.trim()
            ? "学生打开编辑器时里面已经有这些："
            : SOURCES[editorLanguage]
              ? `没写 ${editorLanguage} 的预制代码，学生打开是全站默认的：`
              : `没写 ${editorLanguage} 的预制代码，学生打开是空白的`
        }}
      </p>
      <CodeEditor
        v-if="editorCode"
        :value="editorCode"
        :language="editorLanguage"
        :font-size="14"
        height="320px"
        readonly
      />
      <p v-if="editorParts?.prepend.trim() || editorParts?.append.trim()" class="muted small">
        提交时，学生的代码{{
          editorParts?.prepend.trim() && editorParts?.append.trim()
            ? "前后"
            : editorParts?.prepend.trim()
              ? "前面"
              : "后面"
        }}还会拼上你藏起来的代码。
      </p>
    </div>

    <!-- 流程图：一直挂着，改了图的代码随时知道画不画得出来 -->
    <div v-show="tab === 'flowchart'" class="page">
      <p v-if="flowchartMode === 'none'" class="placeholder">这道题不用流程图</p>
      <p v-else-if="flowchartMode === 'draw'" class="muted small">
        学生自己画，这张图<b>学生看不到</b>，只拿来给学生画的图打分。
        <template v-if="flowchartHint.trim()">学生看到的提示：{{ flowchartHint }}</template>
      </p>
      <p v-else class="muted small">学生在题面里点开「老师给的参考流程图」看到的是：</p>
      <p v-if="flowchartMode !== 'none' && !mermaidCode.trim()" class="placeholder">
        还没写图的代码
      </p>
      <div v-if="renderError && flowchartMode !== 'none'" class="chartError">
        画不出来：{{ renderError }}
      </div>
      <div v-show="flowchartMode !== 'none'" ref="chart" class="chart"></div>
    </div>
  </aside>
</template>

<style scoped>
.preview {
  position: sticky;
  top: 12px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.previewHead {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 14px;
}

.grow {
  flex: 1 1 auto;
}

.dim {
  opacity: 0.6;
}

.page {
  max-height: calc(100vh - 150px);
  overflow: auto;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  padding: 18px 22px;
  background: v-bind("theme.cardColor");
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.titleRow {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.titleRow h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.3;
}

.pid {
  color: v-bind("theme.textColor3");
}

/* 和题目页的小节标题一个样子（oj/problem/components/ProblemContent.vue） */
.title {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  margin: 6px 0 0;
  padding-left: 9px;
  border-left: 3px solid v-bind("theme.primaryColor");
}

.page :deep(.md-editor) {
  background: transparent;
}

.page :deep(.md-editor-preview-wrapper) {
  padding: 0;
}

.io {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.requirements {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid rgba(24, 160, 88, 0.3);
  background-color: rgba(24, 160, 88, 0.06);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  font-size: 13px;
}

.requirementsHead,
.langLabel {
  font-weight: 600;
}

.muted {
  color: v-bind("theme.textColor3");
  font-size: 12px;
}

.small {
  margin: 0;
  font-size: 13px;
}

.placeholder {
  margin: 0;
  color: v-bind("theme.textColor3");
}

.fold {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.exampleHead {
  display: flex;
  align-items: center;
}

.sampleTable {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px 8px;
}

.sampleLabel,
.sampleNo {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.sampleNo {
  display: flex;
  align-items: center;
}

.sampleCell {
  margin: 0;
  min-width: 0;
  padding: 4px 10px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
  font-family: ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei", monospace;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre;
  overflow-x: auto;
}

.editorHead {
  display: flex;
}

.chart {
  display: flex;
  justify-content: center;
}

.chartError {
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 13px;
  color: v-bind("theme.errorColor");
  background-color: rgba(208, 48, 80, 0.08);
  word-break: break-all;
}
</style>

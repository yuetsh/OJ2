<script setup lang="ts">
import { bracketMatching } from "@codemirror/language"
import {
  autocompletion,
  closeBrackets,
  completeAnyWord,
} from "@codemirror/autocomplete"
import type { EditorView } from "@codemirror/view"
import { Codemirror } from "vue-codemirror"
import type { LANGUAGE } from "utils/types"
import { oneDark } from "../themes/oneDark"
import { smoothy } from "../themes/smoothy"
import { styleTheme } from "shared/extensions/baseTheme"
import { enhanceCompletion } from "shared/extensions/autocompletion"
import { languageExtension } from "shared/extensions/language"
import { useCollabDoc } from "../composables/collabDoc"
import { useCollabStore } from "shared/store/collab"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { getProblem } from "oj/api"
import type { Problem } from "utils/types"
import SQLDataTable from "oj/problem/components/SQLDataTable.vue"

const isDark = useDark()
const collabStore = useCollabStore()
const { start, stop, getInitialExtension } = useCollabDoc()

// shallowRef，理由见 SyncCodeEditor.vue：EditorView 是类实例，ref() 的深度
// UnwrapRef 会把它拆成一个丢了原型方法的假类型，vue-tsc 报莫名其妙的类型错。
const editorView = shallowRef<EditorView | null>(null)

// 教师端只在自己发起接单时开。学生端的协作在 SyncCodeEditor 里
const show = computed({
  get: () => collabStore.isTeacher && collabStore.room !== null,
  set: (value: boolean) => {
    if (!value) collabStore.leave()
  },
})

/**
 * 语言跟着学生走：room_open 带过来，学生协作期间切语言会再来一条 room_language。
 * 取不到时按 C —— 和这里原来写死 cpp() 的表现一致。
 */
const language = computed<LANGUAGE>(() => collabStore.room?.language ?? "C")

const extensions = computed(() => [
  styleTheme,
  languageExtension(language.value),
  bracketMatching(),
  closeBrackets(),
  isDark.value ? oneDark : smoothy,
  // 学生端有的补全这里必须也有：老师是在替学生写代码，缺了下拉菜单只能盲敲。
  // 数组一变 vue-codemirror 会整体 reconfigure，但 collabDoc 那个 compartment
  // 的内容会被 CM6 沿用（@codemirror/state 的 flatten 里 `compartments.get() ||
  // ext.inner`），所以切语言、切主题都不会把 yCollab 弄掉
  autocompletion({
    override: [enhanceCompletion(language.value), completeAnyWord],
  }),
  getInitialExtension(),
])

/**
 * 题面直接放在弹框左侧。原来只有一个「打开题面」链接，老师得在两个标签页之间
 * 来回切着对照学生的代码。
 *
 * 不复用 ProblemContent：它读写全局的 problemStore，老师接单时可能正开着另一道题
 * 的详情页，一写就把那边的题面换掉了；它的「测试」按钮跑的也是 codeStore 里老师
 * 自己的代码。这里只要只读的题面。
 *
 * 求助入口在比赛里是关掉的（Form.vue 的 showHelpButton），problemId 一定是公开
 * 题目的展示 ID，按非比赛的接口取就行。
 */
const problem = ref<Problem | null>(null)
const problemLoading = ref(false)

watch(
  () => collabStore.room?.problemId,
  async (problemId) => {
    if (!problemId) {
      problem.value = null
      problemLoading.value = false
      return
    }
    if (problem.value?._id === problemId) return
    problem.value = null
    problemLoading.value = true
    try {
      const res = await getProblem(problemId, "")
      // 请求在路上时老师结束协作、又接了另一道题的单，旧响应不能盖掉新题面
      if (collabStore.room?.problemId === problemId) problem.value = res
    } catch {
      // 取不到就留空，右上角的「打开题面」还能兜底
    } finally {
      if (collabStore.room?.problemId === problemId)
        problemLoading.value = false
    }
  },
  { immediate: true },
)

const sqlDisplay = computed(() => problem.value?.sqlDisplay ?? null)
const sqlExpectedQuery = computed(() => {
  const exp = sqlDisplay.value?.expected
  return exp && "columns" in exp ? exp : null
})

const bind = (view: EditorView) => {
  if (!collabStore.isTeacher || !collabStore.room) return
  // ★ 教师端 seedContent 必须是 null —— 内容全部来自学生端
  start({ editorView: view, seedContent: null })
}

/**
 * 起点是「编辑器就绪」，不是「房间打开」。
 *
 * n-modal 默认 display-directive="if"，每次打开都会重挂一个全新的 CodeMirror。
 * 原来在 watch 里 `await nextTick()` 之后去取 editorView：赶上 teleport + 离场
 * 过渡没走完，取到的是上一轮那个已经 destroy 的 view，start() 静默绑到死编辑器上，
 * 老师对着空白框干等，服务端那边房间却是活的。
 */
const handleEditorReady = (payload: { view: EditorView }) => {
  editorView.value = payload.view
  bind(payload.view)
}

watch(
  () => collabStore.room,
  (room) => {
    // 常规路径下开房时编辑器还没挂，这里是 null，由 @ready 接手；
    // 万一哪天 display-directive 改成 show（编辑器常驻），这条分支才起作用
    if (room && collabStore.isTeacher) {
      if (editorView.value) bind(editorView.value)
    } else {
      stop()
      // 编辑器随模态框一起卸载了，留着这个引用下轮就会绑到一个死 view 上
      editorView.value = null
    }
  },
)

onUnmounted(() => {
  stop()
  editorView.value = null
})
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :style="{ width: '94vw', maxWidth: '1600px' }"
    :title="`正在帮 ${collabStore.room?.peerName ?? ''} · ${collabStore.room?.problemId ?? ''} · ${language}`"
  >
    <template #header-extra>
      <n-button
        text
        tag="a"
        target="_blank"
        :href="`/problem/${collabStore.room?.problemId}`"
      >
        打开题面
      </n-button>
    </template>

    <n-split
      direction="horizontal"
      :default-size="0.4"
      :min="0.2"
      :max="0.7"
      style="height: 70vh"
    >
      <template #1>
        <n-scrollbar style="height: 100%">
          <div class="statement">
            <n-spin v-if="problemLoading" size="small" />
            <n-empty v-else-if="!problem" description="题面加载失败" />
            <template v-else>
              <h3 class="problemTitle">{{ problem.title }}</h3>
              <MdPreview
                preview-theme="vuepress"
                :model-value="problem.description"
                :theme="isDark ? 'dark' : 'light'"
              />

              <template v-if="!sqlDisplay">
                <template v-if="problem.inputDescription">
                  <p class="section">输入</p>
                  <MdPreview
                    preview-theme="vuepress"
                    :model-value="problem.inputDescription"
                    :theme="isDark ? 'dark' : 'light'"
                  />
                </template>
                <template v-if="problem.outputDescription">
                  <p class="section">输出</p>
                  <MdPreview
                    preview-theme="vuepress"
                    :model-value="problem.outputDescription"
                    :theme="isDark ? 'dark' : 'light'"
                  />
                </template>
                <template
                  v-for="(sample, index) of problem.samples"
                  :key="index"
                >
                  <p class="section">例子 {{ index + 1 }}</p>
                  <n-descriptions bordered :column="2" size="small">
                    <n-descriptions-item label="输入">
                      <div class="testcase">{{ sample.input }}</div>
                    </n-descriptions-item>
                    <n-descriptions-item label="输出">
                      <div class="testcase">{{ sample.output }}</div>
                    </n-descriptions-item>
                  </n-descriptions>
                </template>
              </template>

              <template v-else>
                <p class="section">数据表</p>
                <div v-for="t in sqlDisplay.tables" :key="t.name">
                  <p class="sqlTableName">{{ t.name }}</p>
                  <SQLDataTable
                    :columns="t.columns"
                    :rows="t.rows"
                    :total-rows="t.total_rows"
                    :truncated="t.truncated"
                  />
                </div>
                <template v-if="sqlExpectedQuery">
                  <p class="section">期望结果</p>
                  <SQLDataTable
                    :columns="sqlExpectedQuery.columns"
                    :rows="sqlExpectedQuery.rows"
                    :total-rows="sqlExpectedQuery.total_rows"
                    :truncated="sqlExpectedQuery.truncated"
                  />
                </template>
              </template>

              <template v-if="problem.hint">
                <p class="section">提示</p>
                <MdPreview
                  preview-theme="vuepress"
                  :model-value="problem.hint"
                  :theme="isDark ? 'dark' : 'light'"
                />
              </template>
            </template>
          </div>
        </n-scrollbar>
      </template>
      <template #2>
        <!--
          不绑 v-model：这个编辑器的内容完全由 Yjs 文档接管。
          原来绑了一个跨会话不清的 code ref —— 模态框重挂时 CodeMirror 拿它当初始
          文档，而 yCollab 只观察 ytext、从不反过来用 ytext 覆盖编辑器，于是上一个
          学生的代码留在文档里，新学生的内容作为 delta 插到位置 0，两边的偏移从此
          对不上，教师和学生显示的是两份不同的文档。
        -->
        <Codemirror
          indentWithTab
          :extensions="extensions"
          :tab-size="4"
          style="height: 100%; font-size: 18px"
          @ready="handleEditorReady"
        />
      </template>
    </n-split>

    <template #footer>
      <n-flex justify="end">
        <n-button type="primary" @click="collabStore.leave()">
          结束协作
        </n-button>
      </n-flex>
    </template>
  </n-modal>
</template>

<style scoped>
.statement {
  padding-right: 16px;
}

.problemTitle {
  margin: 0 0 8px;
}

.section {
  font-size: 16px;
  font-weight: 600;
  margin: 12px 0 6px;
}

.testcase {
  font-size: 14px;
  white-space: pre;
  font-family: Monaco, Consolas, monospace;
}

.sqlTableName {
  font-weight: 600;
  margin: 8px 0 4px;
  font-family: Monaco, Consolas, monospace;
}
</style>

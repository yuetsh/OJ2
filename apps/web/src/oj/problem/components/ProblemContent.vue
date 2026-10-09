<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { DIFFICULTY } from "utils/constants"
import { copyToClipboard, getTagColor } from "utils/functions"
import { useSubmissionStore } from "oj/store/submission"
import { useDark } from "@vueuse/core"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import SQLDataTable from "./SQLDataTable.vue"
import SimilarProblems from "./SimilarProblems.vue"
import { isFlowchartPass, useFlowchartStore } from "oj/store/flowchart"
import { useMyFlowchartStore } from "shared/store/myFlowchart"
import { useUserStore } from "shared/store/user"
import { useProblemPageContext } from "../composables/problemPageContext"

const ProblemFlowchart = defineAsyncComponent(() => import("./ProblemFlowchart.vue"))
const MyFlowchart = defineAsyncComponent(() => import("./MyFlowchart.vue"))

const isDark = useDark()
const theme = useThemeVars()
const problemStore = useProblemStore()
const { problem } = storeToRefs(problemStore)
const ctx = useProblemPageContext()

// SQL 题：隐藏输入/输出/例子，改为渲染数据表与期望结果
const isSQL = computed(() => !!problem.value?.sqlConfig)
const sqlDisplay = computed(() => problem.value?.sqlDisplay ?? null)
const sqlExpectedQuery = computed(() => {
  const exp = sqlDisplay.value?.expected
  return exp && "columns" in exp ? exp : null
})
const sqlChangedTables = computed(() => {
  const exp = sqlDisplay.value?.expected
  return exp && "changed_tables" in exp ? exp.changed_tables : []
})

// 相似题推荐：做对了、或者错了 3 次以上才给（比赛、题单里不给，见 problemPageContext）
const showSimilar = computed(
  () => ctx.value.similar && (problem.value?.myStatus === 0 || problemStore.failCount >= 3),
)

/**
 * 标题下的状态标签。原来是题面最上面两条整宽的提示（「本题已经被你解决啦」「尝试过但还没有
 * 通过」），占掉一屏里最值钱的那几行。题单里不给（入口差异表）。
 */
const myStatus = computed(() => {
  if (!ctx.value.statusTag || !userStore.isAuthed) return null
  const status = problem.value?.myStatus
  // 设计稿：没交过也写一个「还没交过」，状态这一格始终在
  if (status === undefined || status === null) return "none"
  return status === 0 ? "solved" : "tried"
})

// 不写「限时 1 秒 / 内存 256MB」：中职学生看了只会犯迷糊，超时、超内存判出来时结果页签里自有说明

// ==================== 流程图小节 ====================
// 同一个位置二选一：老师给的参考图（showFlowchart，默认折叠），或者学生自己画到 A/S 的
// 那张（allowFlowchart）。两个开关在后台是互斥的（admin/problem/detail.vue）；后端在
// allowFlowchart 为真时会把 mermaidCode 置成 null，不能把标准答案下发给正要自己画图的学生。
const canShowReferenceFlowchart = computed(
  () => !!problem.value?.showFlowchart && !!problem.value?.mermaidCode,
)
const myFlowchartStore = useMyFlowchartStore()
const flowchartStore = useFlowchartStore()
const userStore = useUserStore()
const myFlowchartZoom = ref(false)
/** 参考流程图默认折叠；自己画的那张默认展开、可以收起（设计稿「流程图 A 级之后」） */
const referenceOpen = ref(false)
const myFlowchartOpen = ref(true)
watch(
  () => problem.value?._id,
  () => {
    referenceOpen.value = false
    myFlowchartOpen.value = true
  },
)

/** 流程图画到 A / S 了：标题下给个「流程图 A 级」 */
const flowchartGrade = computed(() => {
  const passed = flowchartStore.scores.filter((row) => isFlowchartPass(row.grade))
  if (!passed.length) return ""
  return passed.some((row) => row.grade === "S") ? "S" : "A"
})

// 例子旁的「复制」：点完变成「已复制」一秒
const message = useMessage()
const copiedKey = ref("")
const { start: resetCopied } = useTimeoutFn(() => (copiedKey.value = ""), 1000, {
  immediate: false,
})
async function copySample(key: string, text: string) {
  if (await copyToClipboard(text)) {
    copiedKey.value = key
    resetCopied()
  } else {
    message.error("复制失败")
  }
}

// 这道题能画流程图，就去查画到 A/S 没有 —— 原来要先切到「流程图」这门「语言」才查。
// 不看 canDraw：手机上画不了，但以前在电脑上画好的那张照样该摆出来
watch(
  () =>
    [
      problem.value?.id,
      !!problem.value?.allowFlowchart && ctx.value.entry !== "contest",
      userStore.isAuthed,
    ] as const,
  ([id, drawable, authed]) => {
    if (id && drawable && authed) flowchartStore.ensureLoaded()
  },
  { immediate: true },
)

// 例子只是摆出来。原来每个例子旁有个「测试」按钮（结果只给通过 / 不通过、2 秒后复位），
// 现在试跑统一走工具栏的「运行例子」和结果页签的「自己输入」
const samples = computed(() => problem.value?.samples ?? [])
const submissionStore = useSubmissionStore()

// 文案和配色分类都由后端生成 —— 原来这里有一份 NODE_TARGET_LABELS +
// ruleDescription + ruleTagType，和判题机那份几乎一模一样，见契约
// astRequirementSchema。规则原文（engine / target）不下发给学生。
const KIND_TAG_TYPE = {
  require: "success",
  forbid: "error",
  count: "info",
} as const

const astRequirements = computed(() => Object.entries(problem.value?.astRequirements ?? {}))
</script>

<template>
  <div v-if="problem">
    <header class="problem-head">
      <div class="title-row">
        <span class="pid">{{ problem._id }}</span>
        <h1 class="problem-title">{{ problem.title }}</h1>
      </div>
      <div class="meta">
        <n-tag
          v-if="problem.difficulty"
          size="small"
          :bordered="false"
          :type="getTagColor(problem.difficulty)"
        >
          {{ DIFFICULTY[problem.difficulty] }}
        </n-tag>
        <n-tag v-if="myStatus === 'solved'" size="small" type="success" :bordered="false">
          已解决
        </n-tag>
        <!-- 流程图画到 A / S 就算做完了（决定 4）：别在「流程图 A 级」旁边再写「还没交过」
             「做过，还没对」—— 那两个说的是代码 -->
        <template v-else-if="!flowchartGrade">
          <n-tag v-if="myStatus === 'tried'" size="small" type="warning" :bordered="false">
            做过，还没对
          </n-tag>
          <n-tag v-else-if="myStatus === 'none'" size="small" :bordered="false">还没交过</n-tag>
        </template>
        <n-tag v-if="flowchartGrade" size="small" type="success" :bordered="false">
          流程图 {{ flowchartGrade }} 级
        </n-tag>
      </div>
    </header>

    <!-- 语法要求（AST 规则）放在最前面：它是硬性的判定条件，写到一半才看见就晚了 -->
    <div v-if="astRequirements.length > 0" class="requirements">
      <span class="requirements-head">语法要求</span>
      <template v-for="[lang, rules] in astRequirements" :key="lang">
        <span v-if="astRequirements.length > 1" class="lang-label">{{ lang }}</span>
        <n-tag
          v-for="(rule, i) in rules"
          :key="`${lang}-${i}`"
          :type="KIND_TAG_TYPE[rule.kind]"
          size="small"
          :bordered="false"
        >
          {{ rule.description }}
        </n-tag>
      </template>
      <span class="requirements-note">提交时会逐条检查</span>
    </div>

    <section class="block">
      <h3 class="title">描述</h3>
      <MdPreview
        preview-theme="vuepress"
        :model-value="problem.description"
        :theme="isDark ? 'dark' : 'light'"
      />
    </section>

    <!-- 输入、输出一般都只有一两句，左右摆开省半屏 -->
    <div v-if="!isSQL" class="io">
      <section class="block">
        <h3 class="title">输入</h3>
        <MdPreview
          preview-theme="vuepress"
          :model-value="problem.inputDescription"
          :theme="isDark ? 'dark' : 'light'"
        />
      </section>
      <section class="block">
        <h3 class="title">输出</h3>
        <MdPreview
          preview-theme="vuepress"
          :model-value="problem.outputDescription"
          :theme="isDark ? 'dark' : 'light'"
        />
      </section>
    </div>

    <!-- 老师给的参考流程图：一行可以点开的条，默认折叠 -->
    <section v-if="canShowReferenceFlowchart" class="block">
      <button
        type="button"
        class="fold"
        :aria-expanded="referenceOpen"
        @click="referenceOpen = !referenceOpen"
      >
        <svg
          class="fold-caret"
          :class="{ open: referenceOpen }"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span class="fold-title">老师给的参考流程图</span>
        <span class="fold-note">{{ referenceOpen ? "收起" : "点开看" }}</span>
      </button>
      <div v-if="referenceOpen" class="fold-body">
        <ProblemFlowchart />
      </div>
    </section>

    <!-- 自己画到 A/S 的那张：默认展开一小块，可以放大、可以收起 -->
    <section v-else-if="myFlowchartStore.showing" class="block">
      <div class="block-head">
        <h3 class="title">你画的流程图</h3>
        <n-button text type="primary" size="small" @click="myFlowchartZoom = true">
          放大看
        </n-button>
        <n-button text size="small" @click="myFlowchartOpen = !myFlowchartOpen">
          {{ myFlowchartOpen ? "收起" : "展开" }}
        </n-button>
      </div>
      <div
        v-if="myFlowchartOpen"
        class="my-flowchart"
        role="button"
        aria-label="放大看你画的流程图"
        @click="myFlowchartZoom = true"
      >
        <MyFlowchart compact />
      </div>
      <n-modal
        v-model:show="myFlowchartZoom"
        preset="card"
        title="你画的流程图"
        :style="{ maxWidth: '900px' }"
      >
        <MyFlowchart />
      </n-modal>
    </section>

    <template v-if="!isSQL">
      <!--
        例子是一张表：例子 N | 输入 | 输出。原来每个例子各占一个小标题加两个框，三个例子
        就占掉大半屏；Python 的例子大多一两行，摆成表一眼能对上「这个输入 → 这个输出」
      -->
      <section v-if="samples.length" class="block">
        <div class="block-head">
          <h3 class="title">例子</h3>
          <n-button
            text
            type="primary"
            size="small"
            class="block-link"
            @click="submissionStore.revealResult('custom')"
          >
            自己输入数据试试 ›
          </n-button>
        </div>
        <div class="sample-table" role="table" aria-label="例子">
          <span role="columnheader"></span>
          <span role="columnheader" class="sample-label">输入</span>
          <span role="columnheader" class="sample-label">输出</span>
          <template v-for="(sample, index) of samples" :key="index">
            <span class="sample-no" role="rowheader">例子 {{ index + 1 }}</span>
            <div
              v-for="side in ['input', 'output'] as const"
              :key="side"
              class="sample-cell"
              role="cell"
            >
              <pre class="testcase">{{ sample[side] }}</pre>
              <button
                type="button"
                class="sample-copy"
                :aria-label="`复制例子 ${index + 1} 的${side === 'input' ? '输入' : '输出'}`"
                @click="copySample(`${index}-${side}`, sample[side])"
              >
                {{ copiedKey === `${index}-${side}` ? "已复制" : "复制" }}
              </button>
            </div>
          </template>
        </div>
      </section>
    </template>

    <template v-if="isSQL && sqlDisplay">
      <h3 class="title sql-title">数据表</h3>
      <div v-for="t in sqlDisplay.tables" :key="t.name">
        <p class="sqlTableName">{{ t.name }}</p>
        <SQLDataTable
          :columns="t.columns"
          :rows="t.rows"
          :total-rows="t.total_rows"
          :truncated="t.truncated"
        />
      </div>

      <h3 class="title sql-title">期望结果</h3>
      <template v-if="sqlExpectedQuery">
        <SQLDataTable
          :columns="sqlExpectedQuery.columns"
          :rows="sqlExpectedQuery.rows"
          :total-rows="sqlExpectedQuery.total_rows"
          :truncated="sqlExpectedQuery.truncated"
        />
        <p v-if="!problem.sqlConfig?.order_sensitive" class="sqlNote">结果顺序不限</p>
      </template>
      <div v-for="t in sqlChangedTables" :key="t.name">
        <p class="sqlTableName">
          {{ t.dropped ? `${t.name} 表已被删除` : `执行后的 ${t.name} 表` }}
        </p>
        <SQLDataTable
          v-if="!t.dropped"
          :columns="t.columns"
          :rows="t.rows"
          :total-rows="t.total_rows"
          :truncated="t.truncated"
        />
      </div>
    </template>

    <section v-if="problem.hint" class="block">
      <h3 class="title">提示</h3>
      <MdPreview
        preview-theme="preview"
        :model-value="problem.hint"
        :theme="isDark ? 'dark' : 'light'"
      />
    </section>

    <section v-if="problem.source" class="block">
      <h3 class="title">来源</h3>
      <MdPreview
        preview-theme="vuepress"
        :model-value="problem.source"
        :theme="isDark ? 'dark' : 'light'"
      />
    </section>

    <SimilarProblems v-if="showSimilar" title="相似题目推荐" />
  </div>
</template>

<style scoped>
/* 设计稿「题目页签：还没运行过」 */
.problem-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.pid {
  flex: none;
  padding: 2px 8px;
  border-radius: 3px;
  background-color: rgba(128, 128, 128, 0.12);
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.problem-title {
  margin: 0;
  font-size: 22px;
  line-height: 1.3;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.block {
  margin-top: 18px;
}

.block-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.block-head .title {
  margin: 0;
}

.block-link {
  margin-left: auto;
}

/*
 * 小节标题（描述 / 输入 / 输出 / 例子 / 提示……）。画板上是 15px 半粗，比 14px 的正文只大一号，
 * 一屏题面扫下来分不出哪是标题（用户 2026-09-29 提出）：加粗、大一号，左边一道主色竖条
 */
.title {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  margin: 0 0 6px;
  padding-left: 9px;
  border-left: 3px solid v-bind("theme.primaryColor");
}

/* md-editor 的预览自带一圈 padding、白底和段落外边距，放在小节标题下面显得很散 */
:deep(.md-editor) {
  background: transparent;
}

:deep(.md-editor-preview-wrapper) {
  padding: 0;
}

:deep(.md-editor-preview > :first-child) {
  margin-top: 0;
}

:deep(.md-editor-preview > :last-child) {
  margin-bottom: 0;
}

.io {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

/* 语法要求：一行的浅绿框，硬性的判定条件，放在最前面 */
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

.requirements-head {
  font-weight: 600;
}

.requirements-note {
  color: v-bind("theme.textColor3");
}

.lang-label {
  font-weight: 600;
}

/* 参考流程图：一行可以点开的条 */
.fold {
  width: 100%;
  height: 38px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.04);
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.fold:hover {
  border-color: v-bind("theme.borderColor");
}

.fold-caret {
  flex: none;
  transition: transform 0.15s;
}

.fold-caret.open {
  transform: rotate(90deg);
}

.fold-title {
  font-weight: 600;
}

.fold-note {
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.fold-body {
  margin-top: 8px;
}

.my-flowchart {
  cursor: zoom-in;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.06);
  padding: 8px;
}

/* 例子：例子 N | 输入 | 输出，每格右边一个「复制」 */
.sample-table {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px 8px;
  align-items: stretch;
}

.sample-label,
.sample-no {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.sample-no {
  display: flex;
  align-items: center;
}

.sample-cell {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  padding: 2px 4px 2px 10px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
}

.testcase {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 4px 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 14px;
  white-space: pre;
  overflow-x: auto;
}

.sample-copy {
  flex: none;
  height: 24px;
  margin-top: 2px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: v-bind("theme.primaryColorPressed");
  cursor: pointer;
}

.sample-copy:hover {
  background-color: rgba(24, 160, 88, 0.1);
}

.sql-title {
  margin-top: 14px;
}

.sqlTableName {
  font-weight: 600;
  margin: 8px 0 4px;
  font-family: Monaco, Consolas, monospace;
}

.sqlNote {
  font-size: 13px;
  opacity: 0.65;
  margin: 0 0 8px;
}
</style>

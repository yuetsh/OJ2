<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { DIFFICULTY } from "utils/constants"
import { getTagColor } from "utils/functions"
import { useSubmissionStore } from "oj/store/submission"
import type { ProblemRow } from "utils/types"
import Copy from "shared/components/Copy.vue"
import { useDark } from "@vueuse/core"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { getSimilarProblems } from "oj/api"
import SQLDataTable from "./SQLDataTable.vue"
import { useFlowchartStore } from "oj/store/flowchart"
import { useMyFlowchartStore } from "shared/store/myFlowchart"
import { useUserStore } from "shared/store/user"
import { useProblemPageContext } from "../composables/problemPageContext"

const ProblemFlowchart = defineAsyncComponent(() => import("./ProblemFlowchart.vue"))
const MyFlowchart = defineAsyncComponent(() => import("./MyFlowchart.vue"))

const isDark = useDark()
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

const router = useRouter()

// 相似题目推荐
const similarProblems = ref<ProblemRow[]>([])
const similarLoaded = ref(false)

async function loadSimilarProblems() {
  if (similarLoaded.value || !problem.value) return
  // 比赛、题单里不推荐（理由见 problemPageContext 那张表）
  if (!ctx.value.similar) return
  try {
    similarProblems.value = await getSimilarProblems(problem.value._id)
  } catch {
    similarProblems.value = []
  }
  similarLoaded.value = true
}

// 切换题目时重置相似推荐状态
watch(
  () => problem.value?._id,
  () => {
    similarProblems.value = []
    similarLoaded.value = false
  },
)

// AC 或失败次数 >= 3 时加载推荐
watch(
  () => [problem.value?._id, problem.value?.myStatus, problemStore.failCount],
  ([, status, failCount]) => {
    if (status === 0 || (failCount as number) >= 3) {
      loadSimilarProblems()
    }
  },
  { immediate: true },
)

/**
 * 标题下的状态标签。原来是题面最上面两条整宽的提示（「本题已经被你解决啦」「尝试过但还没有
 * 通过」），占掉一屏里最值钱的那几行。题单里不给（入口差异表）。
 */
const myStatus = computed(() => {
  const status = problem.value?.myStatus
  if (!ctx.value.statusTag || status === undefined || status === null) return null
  return status === 0 ? "solved" : "tried"
})

/** 「限时 1 秒」：学生不需要 ms / MB。1000 → 1，1500 → 1.5 */
const timeLimitText = computed(() => {
  const ms = problem.value?.timeLimit ?? 0
  return `限时 ${Number((ms / 1000).toFixed(2))} 秒`
})

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
      <n-flex align="center" :size="10" :wrap="false">
        <n-tag :bordered="false">{{ problem._id }}</n-tag>
        <h2 class="problemTitle">{{ problem.title }}</h2>
      </n-flex>
      <n-flex align="center" :size="8" class="problem-meta">
        <n-tag
          v-if="problem.difficulty"
          size="small"
          :bordered="false"
          :type="getTagColor(problem.difficulty)"
        >
          {{ DIFFICULTY[problem.difficulty] }}
        </n-tag>
        <n-tag v-if="myStatus === 'solved'" size="small" type="success" :bordered="false" round>
          ✓ 已解决
        </n-tag>
        <n-tag v-else-if="myStatus === 'tried'" size="small" type="warning" :bordered="false" round>
          ! 尝试过，还没通过
        </n-tag>
        <n-text depth="3" v-if="!isSQL">{{ timeLimitText }}</n-text>
      </n-flex>
    </header>

    <!-- 代码要求（AST 规则）放在最前面：它是硬性的判定条件，写到一半才看见就晚了 -->
    <div v-if="astRequirements.length > 0" class="requirements">
      <n-flex align="center" :size="6" class="requirements-head">
        <Icon icon="streamline-ultimate-color:check-button" :width="18"></Icon>
        <span>代码要求</span>
        <n-text depth="3" class="requirements-note">提交时会逐条检查</n-text>
      </n-flex>
      <div v-for="[lang, rules] in astRequirements" :key="lang" class="requirements-lang">
        <span v-if="astRequirements.length > 1" class="lang-label">{{ lang }}</span>
        <n-flex :size="6">
          <n-tag v-for="(rule, i) in rules" :key="i" :type="KIND_TAG_TYPE[rule.kind]" size="small">
            {{ rule.description }}
          </n-tag>
        </n-flex>
      </div>
    </div>

    <h3 class="title">
      <Icon icon="streamline-ultimate-color:checklist"></Icon>
      描述
    </h3>
    <MdPreview
      preview-theme="vuepress"
      :model-value="problem.description"
      :theme="isDark ? 'dark' : 'light'"
    />

    <template v-if="!isSQL">
      <h3 class="title">
        <Icon icon="streamline-ultimate-color:envelope-back-front"></Icon>
        输入
      </h3>
      <MdPreview
        preview-theme="vuepress"
        :model-value="problem.inputDescription"
        :theme="isDark ? 'dark' : 'light'"
      />

      <h3 class="title">
        <Icon icon="streamline-ultimate-color:mailbox-post"></Icon>
        输出
      </h3>
      <MdPreview
        preview-theme="vuepress"
        :model-value="problem.outputDescription"
        :theme="isDark ? 'dark' : 'light'"
      />
    </template>

    <n-collapse v-if="canShowReferenceFlowchart" class="flowchart-section">
      <n-collapse-item name="reference">
        <template #header>
          <span class="title collapse-title">
            <Icon icon="vscode-icons:file-type-drawio"></Icon>
            参考流程图
          </span>
        </template>
        <ProblemFlowchart />
      </n-collapse-item>
    </n-collapse>

    <section v-else-if="myFlowchartStore.showing" class="flowchart-section">
      <n-flex align="center" justify="space-between">
        <h3 class="title">
          <Icon icon="vscode-icons:file-type-drawio"></Icon>
          你画的流程图
        </h3>
        <n-button text type="primary" size="small" @click="myFlowchartZoom = true">
          放大看 ›
        </n-button>
      </n-flex>
      <div class="my-flowchart" role="button" @click="myFlowchartZoom = true">
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
      <section v-if="samples.length" class="sample">
        <n-flex align="center" justify="space-between" class="sample-head">
          <h3 class="title">
            <Icon icon="streamline-emojis:microscope"></Icon>
            例子
          </h3>
          <n-button
            text
            type="primary"
            size="small"
            @click="submissionStore.revealResult('custom')"
          >
            自己输入数据试试 ›
          </n-button>
        </n-flex>
        <div class="sample-table" role="table" aria-label="例子">
          <div class="sample-row sample-header" role="row">
            <span role="columnheader"></span>
            <span role="columnheader">输入</span>
            <span role="columnheader">输出</span>
          </div>
          <div v-for="(sample, index) of samples" :key="index" class="sample-row" role="row">
            <span class="sample-no" role="rowheader">{{ index + 1 }}</span>
            <div class="sample-cell" role="cell">
              <pre class="testcase">{{ sample.input }}</pre>
              <span class="sample-copy"><Copy :value="sample.input" /></span>
            </div>
            <div class="sample-cell" role="cell">
              <pre class="testcase">{{ sample.output }}</pre>
              <span class="sample-copy"><Copy :value="sample.output" /></span>
            </div>
          </div>
        </div>
      </section>
    </template>

    <template v-if="isSQL && sqlDisplay">
      <h3 class="title">
        <Icon icon="devicon:sqlite"></Icon>
        数据表
      </h3>
      <div v-for="t in sqlDisplay.tables" :key="t.name">
        <p class="sqlTableName">{{ t.name }}</p>
        <SQLDataTable
          :columns="t.columns"
          :rows="t.rows"
          :total-rows="t.total_rows"
          :truncated="t.truncated"
        />
      </div>

      <h3 class="title">
        <Icon icon="streamline-ultimate-color:check-button"></Icon>
        期望结果
      </h3>
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

    <div v-if="problem.hint">
      <h3 class="title">
        <Icon icon="streamline-emojis:man-tipping-hand-1"></Icon>
        提示
      </h3>
      <MdPreview
        preview-theme="preview"
        :model-value="problem.hint"
        :theme="isDark ? 'dark' : 'light'"
      />
    </div>

    <div v-if="problem.source">
      <h3 class="title">
        <Icon icon="streamline-ultimate-color:book-open-bookmark"></Icon>
        来源
      </h3>
      <MdPreview
        preview-theme="vuepress"
        :model-value="problem.source"
        :theme="isDark ? 'dark' : 'light'"
      />
    </div>

    <!-- 相似题目推荐 -->
    <div v-if="ctx.similar && similarProblems.length > 0">
      <n-divider />
      <h3 class="title">
        <Icon icon="streamline-ultimate-color:like"></Icon>
        相似题目推荐
      </h3>
      <n-list bordered>
        <n-list-item v-for="sp in similarProblems" :key="sp._id">
          <n-flex align="center" justify="space-between">
            <n-flex align="center">
              <n-tag size="small">{{ sp._id }}</n-tag>
              <n-button
                text
                type="info"
                @click="
                  router.push({
                    name: 'problem',
                    params: { problemID: sp._id },
                  })
                "
              >
                {{ sp.title }}
              </n-button>
            </n-flex>
            <!-- getSimilarProblems 已经过 toProblemRow，难度是中文，不是 Low/Mid/High -->
            <n-tag
              v-if="sp.difficulty"
              size="small"
              :type="
                sp.difficulty === '简单'
                  ? 'success'
                  : sp.difficulty === '困难'
                    ? 'error'
                    : 'warning'
              "
            >
              {{ sp.difficulty }}
            </n-tag>
          </n-flex>
        </n-list-item>
      </n-list>
    </div>
  </div>
</template>

<style scoped>
.problem-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.problemTitle {
  margin: 0;
  font-size: 22px;
  line-height: 1.3;
}

.problem-meta {
  font-size: 13px;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin: 20px 0 4px;
}

/* md-editor 的预览自带一圈 padding 和段落外边距，放在小节标题下面显得很散 */
:deep(.md-editor-preview-wrapper) {
  padding: 0;
}

:deep(.md-editor-preview > :first-child) {
  margin-top: 0;
}

:deep(.md-editor-preview > :last-child) {
  margin-bottom: 0;
}

.requirements {
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid rgba(24, 160, 88, 0.3);
  background-color: rgba(24, 160, 88, 0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.requirements-head {
  font-weight: 600;
}

.requirements-note {
  font-size: 12px;
  font-weight: normal;
}

.requirements-lang {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.lang-label {
  font-weight: 600;
  font-size: 13px;
}

.sample {
  margin-top: 20px;
}

.sample-head {
  margin-bottom: 8px;
}

.sample-head .title {
  margin: 0;
}

.sample-table {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 6px;
  overflow: hidden;
}

.sample-row {
  display: grid;
  grid-template-columns: 2.2em minmax(0, 1fr) minmax(0, 1fr);
}

.sample-row + .sample-row {
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}

.sample-header {
  font-size: 12px;
  opacity: 0.7;
  background-color: rgba(128, 128, 128, 0.06);
}

.sample-header > span {
  padding: 4px 10px;
}

.sample-no {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  background-color: rgba(128, 128, 128, 0.06);
}

.sample-cell {
  position: relative;
  min-width: 0;
  padding: 6px 30px 6px 10px;
}

.sample-cell + .sample-cell {
  border-left: 1px solid rgba(128, 128, 128, 0.2);
}

/* Copy 的根是 n-tooltip，class 挂不上去，所以外面包一层 span 来定位 */
.sample-copy {
  position: absolute;
  top: 5px;
  right: 6px;
  display: flex;
}

.testcase {
  margin: 0;
  font-size: 14px;
  white-space: pre;
  overflow-x: auto;
  font-family: Monaco, Consolas, monospace;
}

.flowchart-section {
  margin-top: 20px;
}

.collapse-title {
  margin: 0;
}

.my-flowchart {
  cursor: zoom-in;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.06);
  padding: 8px;
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

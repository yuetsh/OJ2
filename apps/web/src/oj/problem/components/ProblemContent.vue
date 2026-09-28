<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { storeToRefs } from "pinia"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { DIFFICULTY } from "utils/constants"
import { getTagColor } from "utils/functions"
import { createTestSubmission } from "utils/judge"
import type { ProblemDetail, ProblemRow, ProblemStatus } from "utils/types"
import Copy from "shared/components/Copy.vue"
import { useDark } from "@vueuse/core"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { getSimilarProblems } from "oj/api"
import SQLDataTable from "./SQLDataTable.vue"

type Sample = ProblemDetail["samples"][number] & {
  id: number
  msg: string
  status: ProblemStatus
  loading: boolean
}

const isDark = useDark()
const route = useRoute()
const codeStore = useCodeStore()
const problemStore = useProblemStore()
const { problem } = storeToRefs(problemStore)

const problemSetId = computed(() => route.params.problemSetId)

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
  // 比赛题不推荐：接口按 displayId 在**公开题库**里找，比赛题的编号默认是 1/2/3，
  // 一般白跑一趟 404，撞上同号公开题时反而会在比赛中把题库列给学生。
  if (problem.value.contestId !== null) return
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

const hasTriedButNotPassed = computed(() => {
  return (
    problem.value?.myStatus !== undefined &&
    problem.value?.myStatus !== null &&
    problem.value?.myStatus !== 0
  )
})

function freshSamples(): Sample[] {
  return (problem.value?.samples ?? []).map((sample, index) => ({
    ...sample,
    id: index,
    msg: "",
    status: "not_test",
    loading: false,
  }))
}

const samples = ref<Sample[]>(freshSamples())

// 题目页换题是同一个组件复用（顶栏题号直达、「下一题」、相似题都是只换路由参数），
// 不跟着重建的话，新题下面摆的还是上一道题的例子，「测试」也拿旧例子去比
watch(
  () => problem.value?._id,
  () => {
    samples.value = freshSamples()
  },
)

// 文案和配色分类都由后端生成 —— 原来这里有一份 NODE_TARGET_LABELS +
// ruleDescription + ruleTagType，和判题机那份几乎一模一样，见契约
// astRequirementSchema。规则原文（engine / target）不下发给学生。
const KIND_TAG_TYPE = {
  require: "success",
  forbid: "error",
  count: "info",
} as const

const astRequirements = computed(() => Object.entries(problem.value?.astRequirements ?? {}))

async function test(sample: Sample, index: number) {
  samples.value = samples.value.map((sample) => {
    if (sample.id === index) {
      sample.loading = true
    }
    return sample
  })
  const problemId = problem.value?._id
  const res = await createTestSubmission(codeStore.code, sample.input)
  // 跑的这一会儿换了题：结果是上一道题的例子的，按下标写进去就串到新题上了
  if (problem.value?._id !== problemId) return
  samples.value = samples.value.map((sample) => {
    if (sample.id === index) {
      const status = res.status === 3 && res.output.trim() === sample.output ? "passed" : "failed"
      return {
        ...sample,
        msg: res.output,
        status: status,
        loading: false,
      }
    } else {
      return sample
    }
  })

  const id = setTimeout(() => {
    clearTimeout(id)
    if (problem.value?._id !== problemId) return
    samples.value = samples.value.map((sample) => {
      if (sample.id === index) {
        return {
          ...sample,
          msg: res.output,
          status: "not_test",
          loading: false,
        }
      } else {
        return sample
      }
    })
  }, 2000)
}

function label(status: ProblemStatus, loading: boolean) {
  if (loading) return "测试中"
  return {
    not_test: "测试",
    failed: "不通过",
    passed: "通过",
  }[status]
}

function type(status: ProblemStatus) {
  return {
    not_test: "",
    failed: "error",
    passed: "success",
  }[status] as "warning" | "error" | "success"
}
</script>

<template>
  <div v-if="problem">
    <template v-if="!problemSetId">
      <!-- 已通过 -->
      <n-alert
        class="status-alert"
        v-if="problem.myStatus === 0"
        type="success"
        title="🎉 本 题 已 经 被 你 解 决 啦"
      >
      </n-alert>

      <!-- 尝试过但未通过 -->
      <n-alert
        class="status-alert"
        v-else-if="hasTriedButNotPassed"
        type="warning"
        title="💪 你已经尝试过这道题，但还没有通过"
      >
        不要放弃！仔细检查代码逻辑，或者寻求 AI 的帮助获取灵感。
      </n-alert>
    </template>

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
        <n-text depth="3" v-if="!isSQL">
          时间限制 {{ problem.timeLimit }} ms · 内存限制 {{ problem.memoryLimit }} MB
        </n-text>
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

    <template v-if="!isSQL">
      <section v-for="(sample, index) of samples" :key="index" class="sample">
        <n-flex align="center" justify="space-between" class="sample-head">
          <h3 class="title">
            <Icon icon="streamline-emojis:microscope"></Icon>
            例子 {{ index + 1 }}
          </h3>
          <n-button
            size="small"
            secondary
            :type="type(sample.status) || 'default'"
            :loading="sample.loading"
            @click="test(sample, index)"
          >
            {{ label(sample.status, sample.loading) }}
          </n-button>
        </n-flex>
        <div class="sample-grid">
          <div class="sample-box">
            <n-flex align="center" justify="space-between" class="sample-label">
              <span>输入</span>
              <Copy :value="sample.input" />
            </n-flex>
            <pre class="testcase">{{ sample.input }}</pre>
          </div>
          <div class="sample-box">
            <n-flex align="center" justify="space-between" class="sample-label">
              <span>输出</span>
              <Copy :value="sample.output" />
            </n-flex>
            <pre class="testcase">{{ sample.output }}</pre>
          </div>
        </div>
        <div v-if="sample.msg" class="sample-box sample-result">
          <div class="sample-label">运行结果</div>
          <pre class="testcase">{{ sample.msg }}</pre>
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
    <div v-if="similarProblems.length > 0">
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

.sample-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}

.sample-box {
  min-width: 0;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
  padding: 6px 10px 10px;
}

.sample-result {
  margin-top: 8px;
}

.sample-label {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 4px;
}

.testcase {
  margin: 0;
  font-size: 14px;
  white-space: pre;
  overflow-x: auto;
  font-family: Monaco, Consolas, monospace;
}

.status-alert {
  margin-bottom: 16px;
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

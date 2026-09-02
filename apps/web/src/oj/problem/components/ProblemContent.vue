<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { createTestSubmission } from "utils/judge"
import type { TranscriptSegment } from "utils/judge"
import { DIFFICULTY } from "utils/constants"
import type { Problem, ProblemStatus } from "utils/types"
import Copy from "shared/components/Copy.vue"
import { useDark } from "@vueuse/core"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { getSimilarProblems } from "oj/api"
import SQLDataTable from "./SQLDataTable.vue"

type Sample = Problem["samples"][number] & {
  id: number
  msg: string
  // 终端会话；不支持回显的语言（Java / Go / JS）拿不到，退回只显示 msg
  segments: TranscriptSegment[] | null
  status: ProblemStatus
  loading: boolean
}

/** 会话里的一段在界面上怎么显示 */
type ShownSegment = {
  text: string
  // out = 程序真正的输出，in = 喂进去的输入，prompt = 学生自己打的提示语
  kind: "out" | "in" | "prompt"
}

const theme = useThemeVars()
const style = computed(() => "color: " + theme.value.primaryColor)
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
const similarProblems = ref<any[]>([])
const similarLoaded = ref(false)

async function loadSimilarProblems() {
  if (similarLoaded.value || !problem.value) return
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

const samples = ref<Sample[]>(
  problem.value!.samples.map((sample, index) => ({
    ...sample,
    id: index,
    msg: "",
    segments: null,
    status: "not_test",
    loading: false,
  })),
)

// 文案和配色分类都由后端生成 —— 原来这里有一份 NODE_TARGET_LABELS +
// ruleDescription + ruleTagType，和判题机那份几乎一模一样，见契约
// astRequirementSchema。规则原文（engine / target）不下发给学生。
const KIND_TAG_TYPE = {
  require: "success",
  forbid: "error",
  count: "info",
} as const

const astRequirements = computed(() =>
  Object.entries(problem.value?.astRequirements ?? {}),
)

async function test(sample: Sample, index: number) {
  samples.value = samples.value.map((sample) => {
    if (sample.id === index) {
      sample.loading = true
    }
    return sample
  })
  const res = await createTestSubmission(codeStore.code, sample.input)
  samples.value = samples.value.map((sample) => {
    if (sample.id === index) {
      const status =
        res.status === 3 && res.output.trim() === sample.output
          ? "passed"
          : "failed"
      return {
        ...sample,
        msg: res.output,
        segments: res.segments,
        status: status,
        loading: false,
      }
    } else {
      return sample
    }
  })
}

// 运行结果不再自动复位后，按钮固定叫「测试」——
// 一个绿色的「通过」按钮既当状态又当「再跑一次」的入口，容易误读，
// 通过 / 不通过挪到旁边的 tag 上
const STATUS_TAG = {
  not_test: null,
  failed: { label: "不通过", type: "error" },
  passed: { label: "通过", type: "success" },
} as const satisfies Record<
  ProblemStatus,
  { label: string; type: string } | null
>

/**
 * 一段输出后面紧跟着一段输入，说明它是「请输入半径：」这类提示语。学生在自己电脑上
 * 跑，这句是打给自己看的；到了判题狗这里它一样算进 stdout，是最常见的 WA 原因，
 * 所以单独标出来。
 */
function shownSegments(sample: Sample): ShownSegment[] {
  const segments = sample.segments
  if (!segments) return [{ text: sample.msg, kind: "out" }]
  return segments.map((seg, index) => ({
    // 样例的输入大多不带结尾换行（库里就是 `"700"`），照原样贴出来，下一行输出会
    // 和它挤在一起变成 `700` `7` → `7007`。学生真在终端里敲的话这里有个回车，
    // 补上它才是他电脑上看到的样子 —— 只影响显示，判定用的是 msg。
    text:
      seg.kind === "input" && !seg.text.endsWith("\n")
        ? seg.text + "\n"
        : seg.text,
    kind:
      seg.kind === "input"
        ? "in"
        : segments[index + 1]?.kind === "input"
          ? "prompt"
          : "out",
  }))
}

function hasFedInput(sample: Sample) {
  return !!sample.segments?.some((seg) => seg.kind === "input")
}

/**
 * 把提示语抠掉之后正好等于期望输出 —— 这时候能把话说死：答案是对的，删掉就通过。
 * 抠掉还是对不上，就只说提示语也算输出，不误导。
 */
function hint(sample: Sample) {
  if (sample.status !== "failed") return ""
  const shown = shownSegments(sample)
  if (!shown.some((seg) => seg.kind === "prompt")) return ""
  const withoutPrompt = shown
    .filter((seg) => seg.kind === "out")
    .map((seg) => seg.text)
    .join("")
  if (withoutPrompt.trim() === sample.output.trim()) {
    return "答案本身是对的，只是输出里多了带下划线的提示语 —— 判题狗只对比程序打印的结果，把 input() / printf() 里的提示语删掉就通过了。"
  }
  return "带下划线的是你自己打印的提示语，判题狗也会把它算进你的输出里。"
}

function segStyle(kind: ShownSegment["kind"]) {
  if (kind === "in") {
    return { color: theme.value.infoColor, fontWeight: 600 }
  }
  if (kind === "prompt") {
    return {
      color: theme.value.textColor3,
      textDecoration: "underline dotted",
      textUnderlineOffset: "3px",
    }
  }
  return {}
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

    <n-flex align="center">
      <n-tag>{{ problem._id }}</n-tag>
      <h2 class="problemTitle">{{ problem.title }}</h2>
    </n-flex>
    <p class="title" :style="style">
      <n-flex align="center">
        <Icon icon="streamline-ultimate-color:checklist"></Icon>
        描述
      </n-flex>
    </p>
    <MdPreview
      preview-theme="vuepress"
      :model-value="problem.description"
      :theme="isDark ? 'dark' : 'light'"
    />

    <template v-if="!isSQL">
      <p class="title" :style="style">
        <n-flex align="center">
          <Icon icon="streamline-ultimate-color:envelope-back-front"></Icon>
          输入
        </n-flex>
      </p>
      <MdPreview
        preview-theme="vuepress"
        :model-value="problem.inputDescription"
        :theme="isDark ? 'dark' : 'light'"
      />

      <p class="title" :style="style">
        <n-flex align="center">
          <Icon icon="streamline-ultimate-color:mailbox-post"></Icon>
          输出
        </n-flex>
      </p>
      <MdPreview
        preview-theme="vuepress"
        :model-value="problem.outputDescription"
        :theme="isDark ? 'dark' : 'light'"
      />
    </template>

    <template v-if="isSQL && sqlDisplay">
      <p class="title" :style="style">
        <n-flex align="center">
          <Icon icon="devicon:sqlite"></Icon>
          数据表
        </n-flex>
      </p>
      <div v-for="t in sqlDisplay.tables" :key="t.name">
        <p class="sqlTableName">{{ t.name }}</p>
        <SQLDataTable
          :columns="t.columns"
          :rows="t.rows"
          :total-rows="t.total_rows"
          :truncated="t.truncated"
        />
      </div>

      <p class="title" :style="style">
        <n-flex align="center">
          <Icon icon="streamline-ultimate-color:check-button"></Icon>
          期望结果
        </n-flex>
      </p>
      <template v-if="sqlExpectedQuery">
        <SQLDataTable
          :columns="sqlExpectedQuery.columns"
          :rows="sqlExpectedQuery.rows"
          :total-rows="sqlExpectedQuery.total_rows"
          :truncated="sqlExpectedQuery.truncated"
        />
        <p v-if="!problem.sqlConfig?.order_sensitive" class="sqlNote">
          结果顺序不限
        </p>
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
      <p class="title" :style="style">
        <n-flex align="center">
          <Icon icon="streamline-emojis:man-tipping-hand-1"></Icon>
          提示
        </n-flex>
      </p>
      <MdPreview
        preview-theme="preview"
        :model-value="problem.hint"
        :theme="isDark ? 'dark' : 'light'"
      />
    </div>

    <!-- 代码要求（AST 规则） -->
    <div v-if="astRequirements.length > 0">
      <p class="title" :style="style">
        <n-flex align="center">
          <Icon icon="streamline-ultimate-color:check-button"></Icon>
          要求
        </n-flex>
      </p>
      <div v-for="[lang, rules] in astRequirements" :key="lang">
        <p v-if="astRequirements.length > 1" class="lang-label">
          {{ lang }}
        </p>
        <n-list bordered style="margin-bottom: 8px">
          <n-list-item v-for="(rule, i) in rules" :key="i">
            <n-tag :type="KIND_TAG_TYPE[rule.kind]">
              {{ rule.description }}
            </n-tag>
          </n-list-item>
        </n-list>
      </div>
    </div>

    <template v-if="!isSQL">
      <div v-for="(sample, index) of samples" :key="index">
        <n-flex align="center">
          <p class="title" :style="style">
            <n-flex align="center">
              <Icon icon="streamline-emojis:microscope"></Icon>
              例子 {{ index + 1 }}
            </n-flex>
          </p>
          <n-button
            size="small"
            :loading="sample.loading"
            @click="test(sample, index)"
          >
            测试
          </n-button>
          <n-tag
            v-if="STATUS_TAG[sample.status]"
            size="small"
            :type="STATUS_TAG[sample.status]!.type"
          >
            {{ STATUS_TAG[sample.status]!.label }}
          </n-tag>
        </n-flex>
        <n-descriptions
          bordered
          :column="2"
          label-style="width: 50%; min-width: 100px"
        >
          <n-descriptions-item>
            <template #label>
              <n-flex>
                <span>输入</span>
                <Copy :value="sample.input" />
              </n-flex>
            </template>
            <div class="testcase">{{ sample.input }}</div>
          </n-descriptions-item>
          <n-descriptions-item>
            <template #label>
              <n-flex>
                <span>输出</span>
                <Copy :value="sample.output" />
              </n-flex>
            </template>
            <div class="testcase">{{ sample.output }}</div>
          </n-descriptions-item>
          <n-descriptions-item
            label="运行过程"
            v-if="sample.msg || sample.segments?.length"
          >
            <div class="terminal">
              <span
                v-for="(seg, i) of shownSegments(sample)"
                :key="i"
                :style="segStyle(seg.kind)"
                >{{ seg.text }}</span
              >
            </div>
            <p v-if="hasFedInput(sample)" class="terminalNote">
              蓝色那几段是判题狗提前准备好、自动喂给程序的输入 ——
              所以这里不用你敲键盘，程序也不会停下来等。
            </p>
            <p v-if="hint(sample)" class="terminalNote">{{ hint(sample) }}</p>
          </n-descriptions-item>
        </n-descriptions>
      </div>
    </template>

    <div v-if="problem.source">
      <p class="title" :style="style">
        <n-flex align="center">
          <Icon icon="streamline-ultimate-color:book-open-bookmark"></Icon>
          来源
        </n-flex>
      </p>
      <MdPreview
        preview-theme="vuepress"
        :model-value="problem.source"
        :theme="isDark ? 'dark' : 'light'"
      />
    </div>

    <!-- 相似题目推荐 -->
    <div v-if="similarProblems.length > 0">
      <n-divider />
      <p class="title" :style="style">
        <n-flex align="center">
          <Icon icon="streamline-ultimate-color:like"></Icon>
          相似题目推荐
        </n-flex>
      </p>
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
            <n-tag
              size="small"
              :type="
                sp.difficulty === 'Low'
                  ? 'success'
                  : sp.difficulty === 'High'
                    ? 'error'
                    : 'warning'
              "
            >
              {{
                DIFFICULTY[sp.difficulty as keyof typeof DIFFICULTY] || "中等"
              }}
            </n-tag>
          </n-flex>
        </n-list-item>
      </n-list>
    </div>
  </div>
</template>

<style scoped>
.problemTitle {
  margin: 0;
}

.title {
  font-size: 20px;
  margin: 12px 0;
}

.testcase {
  font-size: 14px;
  white-space: pre;
  font-family: "Monaco";
}

.terminal {
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.7;
  font-family: Monaco, Consolas, monospace;
}

.terminalNote {
  font-size: 13px;
  opacity: 0.75;
  margin: 8px 0 0;
}

.status-alert {
  margin-bottom: 16px;
}

.lang-label {
  font-weight: 600;
  margin: 8px 0 4px;
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

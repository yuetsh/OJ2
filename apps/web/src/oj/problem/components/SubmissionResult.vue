<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { HINT_MIN_FAILURES } from "@oj2/contract"
import { JUDGE_STATUS, SubmissionStatus } from "utils/constants"
import {
  submissionMemoryFormat,
  submissionTimeFormat,
} from "utils/functions"
import type { Submission } from "utils/types"
import SubmissionResultTag from "shared/components/SubmissionResultTag.vue"
import { useProblemStore } from "oj/store/problem"
import { aiStreamError, consumeJSONEventStream } from "utils/stream"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { useDark } from "@vueuse/core"

const props = defineProps<{
  submission?: Submission
}>()

const isDark = useDark()
const problemStore = useProblemStore()
const theme = useThemeVars()

// AI 提示状态
const hintContent = ref("")
const hintLoading = ref(false)
const hintError = ref("")

// 错误信息格式化
const msg = computed(() => {
  if (!props.submission) return ""

  let msg = ""
  const result = props.submission.result

  // 编译错误或运行时错误时给出提示；
  // SQL 题的运行错误多半是"查询题里写了增删改"这类被判题拒绝的语句，err_info 已说明原因，不套这句
  if (
    (result === SubmissionStatus.compile_error ||
      result === SubmissionStatus.runtime_error) &&
    props.submission.language !== "SQL"
  ) {
    msg += "请仔细检查，看看代码的格式是不是写错了！\n\n"
  }

  if (
    result !== SubmissionStatus.ast_check_failed &&
    props.submission.statisticInfo?.err_info
  ) {
    msg += props.submission.statisticInfo.err_info
  }

  return msg
})

// 是否显示AI提示区域。
// 阈值和后端 POST /ai/hint 共用契约里的 HINT_MIN_FAILURES，别在这里写死数字；
// failCount 现在含服务端下发的历史失败数，刷新页面不会把进度清掉。
// system_error 也要排掉：那是判题机自己崩了，学生代码没毛病，让 AI 去分析
// 只会瞎编一通，后端的失败计数同样不认这个状态。
const showAIHint = computed(() => {
  if (!props.submission) return false
  // 比赛题不给提示，和「求助」按钮一致。用 problem.contestId 而不是路由参数：
  // 带 contestId 的题目只可能从比赛入口进来（题库列表按 contest_id is null 过滤）。
  if (problemStore.problem?.contestId != null) return false
  return (
    problemStore.failCount >= HINT_MIN_FAILURES &&
    props.submission.result !== SubmissionStatus.accepted &&
    props.submission.result !== SubmissionStatus.ast_check_failed &&
    props.submission.result !== SubmissionStatus.system_error &&
    props.submission.result !== SubmissionStatus.pending &&
    props.submission.result !== SubmissionStatus.judging &&
    props.submission.result !== SubmissionStatus.submitting
  )
})

// 结果面板现在是 display-directive="show"，关掉不再销毁组件，提示内容能留到重新打开。
// 代价是换了一次提交它也留着，所以这里按提交 id 手动清一次 —— 否则新结果底下挂着
// 上一次提交的提示，而且按钮已经被 v-if 藏了，学生没法重新分析。
watch(
  () => props.submission?.id,
  () => {
    hintContent.value = ""
    hintError.value = ""
    hintLoading.value = false
  },
)

async function fetchHint(submissionId: string) {
  hintLoading.value = true
  hintContent.value = ""
  hintError.value = ""

  try {
    const response = await fetch("/api/ai/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId }),
    })

    if (!response.ok) throw await aiStreamError(response)

    await consumeJSONEventStream(response, {
      onMessage: (data: {
        type: string
        content?: string
        message?: string
      }) => {
        if (data.type === "delta" && data.content) {
          hintContent.value += data.content
        } else if (data.type === "error") {
          hintError.value = data.message || "AI 提示生成失败"
        }
      },
    })
  } catch (e: any) {
    hintError.value = e.message || "请求失败"
  } finally {
    hintLoading.value = false
  }
}

// 测试用例表格数据（只在部分通过时显示）
const infoTable = computed(() => {
  if (!props.submission?.info?.data?.length) return []

  const result = props.submission.result
  // AC、编译错误、运行时错误不显示测试用例表格
  if (
    result === SubmissionStatus.accepted ||
    result === SubmissionStatus.ast_check_failed ||
    result === SubmissionStatus.compile_error ||
    result === SubmissionStatus.runtime_error
  ) {
    return []
  }

  const data = props.submission.info.data
  // 只有存在失败的测试用例时才显示
  return data.some((item) => item.result === 0) ? data : []
})

// 测试用例表格列配置
const columns: DataTableColumn<Submission["info"]["data"][number]>[] = [
  { title: "测试用例", key: "test_case" },
  {
    title: "测试状态",
    key: "result",
    render: (row) => h(SubmissionResultTag, { result: row.result }),
  },
  {
    title: "占用内存",
    key: "memory",
    render: (row) => submissionMemoryFormat(row.memory),
  },
  {
    title: "执行耗时",
    key: "real_time",
    render: (row) => submissionTimeFormat(row.real_time),
  },
  { title: "信号", key: "signal" },
]
</script>

<template>
  <div v-if="submission">
    <n-alert
      :type="JUDGE_STATUS[submission.result]['type']"
      :title="JUDGE_STATUS[submission.result]['title']"
      class="mb-3"
    />
    <n-flex
      vertical
      v-if="
        msg || infoTable.length || submission.statisticInfo?.ast_results?.length
      "
    >
      <n-card v-if="submission.statisticInfo?.ast_results?.length" embedded>
        <n-flex vertical :size="8">
          <n-flex
            v-for="(rule, i) in submission.statisticInfo.ast_results"
            :key="i"
            align="center"
            :size="6"
          >
            <n-icon
              :color="rule.passed ? theme.successColor : theme.errorColor"
            >
              <Icon :icon="rule.passed ? 'ph:check-bold' : 'ph:x-bold'" />
            </n-icon>
            <span>{{ rule.description }}</span>
            <!-- 次数类规则光说「出现 2 次 ✗」，学生不知道自己写了几次 -->
            <span
              v-if="!rule.passed && rule.actual !== undefined"
              :style="{ color: theme.errorColor }"
            >
              当前 {{ rule.actual }} 次
            </span>
          </n-flex>
        </n-flex>
      </n-card>
      <n-card v-if="msg" embedded class="msg">{{ msg }}</n-card>
      <n-data-table
        v-if="infoTable.length"
        striped
        :data="infoTable"
        :columns="columns"
      />
    </n-flex>

    <!-- AI 提示区域 -->
    <template v-if="showAIHint">
      <n-card size="small" style="margin-top: 12px; max-width: 480px">
        <n-alert
          v-if="hintError"
          type="error"
          :title="hintError"
          class="mb-3"
        />
        <n-button
          v-if="!hintContent && !hintLoading"
          type="primary"
          @click="fetchHint(submission.id)"
        >
          让 AI 分析我的代码
        </n-button>
        <n-spin v-else-if="hintLoading && !hintContent" size="small" />
        <MdPreview
          v-if="hintContent"
          :model-value="hintContent"
          preview-theme="vuepress"
          :theme="isDark ? 'dark' : 'light'"
        />
      </n-card>
    </template>
  </div>
</template>

<style scoped>
.msg {
  white-space: pre;
  word-break: break-all;
  line-height: 1.5;
}

.gradient-text {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-weight: bold;
}
</style>

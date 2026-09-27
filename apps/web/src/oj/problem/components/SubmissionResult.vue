<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { HINT_MIN_FAILURES, hintLevelLabel } from "@oj2/contract"
import type { AiHintDone, JudgeCaseResult } from "@oj2/contract"
import { JUDGE_STATUS, SubmissionStatus } from "utils/constants"
import {
  submissionCaseResults,
  submissionMemoryFormat,
  submissionPartialCases,
  submissionResultTitle,
  submissionTimeFormat,
} from "utils/functions"
import type { Submission } from "utils/types"
import SubmissionResultTag from "shared/components/SubmissionResultTag.vue"
import { useProblemStore } from "oj/store/problem"
import PythonErrorExplain from "./PythonErrorExplain.vue"
import RuntimeErrorExplain from "./RuntimeErrorExplain.vue"
import WrongAnswerExplain from "./WrongAnswerExplain.vue"
import LessonNext from "./LessonNext.vue"
import { useAIStream } from "shared/composables/aiStream"
import { submitHintFeedback } from "oj/api"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { useDark } from "@vueuse/core"

const props = defineProps<{
  submission?: Submission
}>()

const isDark = useDark()
const problemStore = useProblemStore()
const theme = useThemeVars()

// AI 提示状态。
// hintTarget 是后端发来的全文，hintContent 是已经"打"出来的那一截 ——
// 后端从 2c 起整段生成、过滤通过才推（设计 2.6），一次就把全文发过来，
// 逐字显示改在这边模拟。
const hintTarget = ref("")
const hintContent = ref("")
const hintStream = useAIStream()
// 整条流跑完才算结束：提示是一次推全文，没有「第一个字到了」的中间态
const hintLoading = hintStream.running
const hintError = ref("")
// 这条提示在 ai_hint 里的 id，生成完由 done 事件带回来；后端落库失败时没有，就不出评价按钮
const hintId = ref<number | null>(null)
// 这条提示是哪一级（-1 = 编译错误那一档，不在阶梯上），以及还能不能再往上要一级。
// 两个都由后端算好在 done 里给，前端不自己推阶梯
const hintLevel = ref<number | null>(null)
const hintCanEscalate = ref(false)
const hintHelpful = ref<boolean | null>(null)
const hintFeedbackSending = ref(false)

// 打字机：每 24ms 吐 3 个字，约 125 字/秒。步子不敢迈太小 ——
// 每一帧都要让 MdPreview 重渲染一次 Markdown，机房那批机器扛不住逐字
const TYPE_STEP = 3
const TYPE_INTERVAL = 24
let typingTimer: ReturnType<typeof setInterval> | null = null
const hintTyping = computed(() => hintContent.value.length < hintTarget.value.length)

function stopTyping() {
  if (typingTimer === null) return
  clearInterval(typingTimer)
  typingTimer = null
}

function startTyping() {
  if (typingTimer !== null) return
  typingTimer = setInterval(() => {
    if (!hintTyping.value) {
      stopTyping()
      return
    }
    hintContent.value = hintTarget.value.slice(0, hintContent.value.length + TYPE_STEP)
  }, TYPE_INTERVAL)
}

function resetHint() {
  stopTyping()
  hintTarget.value = ""
  hintContent.value = ""
  hintError.value = ""
  hintId.value = null
  hintLevel.value = null
  hintCanEscalate.value = false
  hintHelpful.value = null
}

onUnmounted(stopTyping)

/** 判题机的临时目录名（`/judger/run/<32 位随机串>/`）对学生没有意义，只剩文件名 */
function stripJudgePath(text: string) {
  return text.replace(/\/judger\/run\/[^/"]+\//g, "")
}

/**
 * Python 的编译错误交给 PythonErrorExplain 翻成中文。只管 Python：C / C++ 的
 * gcc 报错另是一套句式，还没做。
 */
const pythonCompileError = computed(() => {
  const submission = props.submission
  if (!submission || submission.result !== SubmissionStatus.compile_error) return ""
  if (submission.language !== "Python") return ""
  return submission.statisticInfo?.err_info ?? ""
})

// 错误信息格式化
/**
 * 运行时错误的诊断（行号 + 归类），交给 RuntimeErrorExplain。比赛提交、诊断失败的
 * 没有这个字段（见后端 judge/run.ts 的 diagnoseRuntimeError），走下面 msg 的通用提示。
 */
const runtimeError = computed(() => {
  const submission = props.submission
  if (!submission || submission.result !== SubmissionStatus.runtime_error) return null
  return submission.statisticInfo?.runtime_error ?? null
})

/** 答案错误时公开样例上的对比，交给 WrongAnswerExplain；比赛提交没有（见后端 checkSamples） */
const sampleCheck = computed(() => {
  const submission = props.submission
  if (!submission || submission.result !== SubmissionStatus.wrong_answer) return null
  return submission.statisticInfo?.sample_check ?? null
})

/**
 * 通过之后给「这节课的下一题」。比赛有自己的题目列表；从题单入口进来的，通过后
 * 1.5 秒会自动跳回题单（SubmitCode 的 goToProblemSetDelayed），这两种都不给
 */
const route = useRoute()
const showLessonNext = computed(
  () =>
    props.submission?.result === SubmissionStatus.accepted &&
    problemStore.problem?.contestId == null &&
    !route.params.problemSetId,
)

const msg = computed(() => {
  if (!props.submission) return ""
  // 走 PythonErrorExplain / RuntimeErrorExplain 那两张中文卡片
  if (pythonCompileError.value || runtimeError.value) return ""

  let msg = ""
  const result = props.submission.result

  // 编译错误或运行时错误时给出提示；
  // SQL 题的运行错误多半是"查询题里写了增删改"这类被判题拒绝的语句，err_info 已说明原因，不套这句
  if (props.submission.language !== "SQL") {
    if (result === SubmissionStatus.compile_error) {
      msg += "请仔细检查，看看代码的格式是不是写错了！\n\n"
    } else if (result === SubmissionStatus.runtime_error) {
      // 原来和编译错误共用「代码格式写错了」那句，可运行时错误恰恰是格式没错、跑起来才出事
      msg +=
        "程序运行到一半出错，停下来了。检查一下输入是怎么读的、下标有没有越界、除数是不是 0。\n\n"
    }
  }

  if (result !== SubmissionStatus.ast_check_failed && props.submission.statisticInfo?.err_info) {
    msg += stripJudgePath(props.submission.statisticInfo.err_info)
  }

  return msg
})

// 部分测试点通过时的进度。学生拿不到 info，那张测试点表格只有管理员看得见，
// 这是学生这边唯一能看出「比上次多过了几个点」的地方。
const partialCases = computed(() => submissionPartialCases(props.submission))

// 是否显示AI提示区域。
// 阈值和后端 POST /ai/hint 共用契约里的 HINT_MIN_FAILURES，别在这里写死数字；
// 编译失败不数次数，和后端同口径（理由见 HINT_MIN_FAILURES 的注释）；
// failCount 现在含服务端下发的历史失败数，刷新页面不会把进度清掉。
// system_error 也要排掉：那是判题机自己崩了，学生代码没毛病，让 AI 去分析
// 只会瞎编一通，后端的失败计数同样不认这个状态。
const showAIHint = computed(() => {
  if (!props.submission) return false
  // 比赛题不给提示，和「求助」按钮一致。用 problem.contestId 而不是路由参数：
  // 带 contestId 的题目只可能从比赛入口进来（题库列表按 contest_id is null 过滤）。
  if (problemStore.problem?.contestId != null) return false
  return (
    (problemStore.failCount >= HINT_MIN_FAILURES ||
      props.submission.result === SubmissionStatus.compile_error) &&
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
    // 上一次提交的提示还在生成的话掐掉，不然它会写进新提交的面板里
    hintStream.abort()
    resetHint()
  },
)

// more = 学生点的是「再多一点提示」。升级只能由学生主动发起，而且后端还要看
// 「上次开出这一级之后有没有再交过」，所以点了也未必真升 —— 以 done 里的 level 为准
async function fetchHint(submissionId: string, more = false) {
  resetHint()
  try {
    await hintStream.run<AiHintDone>(
      "ai/hint",
      { submissionId, more },
      {
        onDelta(content) {
          hintTarget.value += content
          startTyping()
        },
        onDone(data) {
          hintId.value = data.hintId ?? null
          hintLevel.value = data.level ?? null
          hintCanEscalate.value = data.canEscalate === true
        },
      },
    )
  } catch (error) {
    hintError.value = (error as Error).message
  }
}

// 可以改票：点另一个就覆盖。失败了不打扰学生，按钮恢复原样就行 ——
// 评价是给我们看的，不值得为它弹一条报错
async function sendHintFeedback(helpful: boolean) {
  if (hintId.value === null || hintFeedbackSending.value) return
  if (hintHelpful.value === helpful) return
  hintFeedbackSending.value = true
  try {
    await submitHintFeedback(hintId.value, helpful)
    hintHelpful.value = helpful
  } catch {
    // 静默
  } finally {
    hintFeedbackSending.value = false
  }
}

// 测试用例表格数据（只在部分通过时显示）
const infoTable = computed(() => {
  const submission = props.submission
  if (!submission) return []
  const data = submissionCaseResults(submission.info)
  if (!data.length) return []

  const result = submission.result
  // AC、编译错误、运行时错误不显示测试用例表格
  if (
    result === SubmissionStatus.accepted ||
    result === SubmissionStatus.ast_check_failed ||
    result === SubmissionStatus.compile_error ||
    result === SubmissionStatus.runtime_error
  ) {
    return []
  }

  // 只有存在失败的测试用例时才显示
  return data.some((item) => item.result === 0) ? data : []
})

// 测试用例表格列配置
const columns: DataTableColumn<JudgeCaseResult>[] = [
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
      :title="submissionResultTitle(submission)"
      class="mb-3"
    >
      <template v-if="partialCases" #default>
        <n-progress
          type="line"
          status="success"
          :percentage="(partialCases.passed / partialCases.total) * 100"
          :show-indicator="false"
        />
      </template>
    </n-alert>
    <!-- key 用提交 id：同一道题再交一次、又通过了，要重新拉一遍「还剩几道」 -->
    <LessonNext
      v-if="showLessonNext && problemStore.problem"
      :key="submission.id"
      :problem-display-id="problemStore.problem._id"
    />
    <n-flex
      vertical
      v-if="
        pythonCompileError ||
        runtimeError ||
        sampleCheck ||
        msg ||
        infoTable.length ||
        submission.statisticInfo?.ast_results?.length
      "
    >
      <PythonErrorExplain v-if="pythonCompileError" :err-info="pythonCompileError" />
      <RuntimeErrorExplain v-if="runtimeError" :info="runtimeError" :code="submission.code" />
      <WrongAnswerExplain
        v-if="sampleCheck"
        :check="sampleCheck"
        :code="submission.code"
        :language="submission.language"
      />
      <n-card v-if="submission.statisticInfo?.ast_results?.length" embedded>
        <n-flex vertical :size="8">
          <n-flex
            v-for="(rule, i) in submission.statisticInfo.ast_results"
            :key="i"
            align="center"
            :size="6"
          >
            <n-icon :color="rule.passed ? theme.successColor : theme.errorColor">
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
      <n-data-table v-if="infoTable.length" striped :data="infoTable" :columns="columns" />
    </n-flex>

    <!-- AI 提示区域 -->
    <template v-if="showAIHint">
      <n-card size="small" style="margin-top: 12px; max-width: 480px">
        <n-alert v-if="hintError" type="error" :title="hintError" class="mb-3" />
        <n-button
          v-if="!hintTarget && !hintLoading"
          type="primary"
          @click="fetchHint(submission.id)"
        >
          让 AI 分析我的代码
        </n-button>
        <n-spin v-else-if="hintLoading && !hintTarget" size="small" />
        <MdPreview
          v-if="hintContent"
          :model-value="hintContent"
          preview-theme="vuepress"
          :theme="isDark ? 'dark' : 'light'"
        />
        <!-- 等级和「再多一点提示」。按钮出不出由后端 done 里的 canEscalate 定，
             前端不自己推阶梯（要再交一次才升得动，规则在 services/hint-level.ts） -->
        <n-flex
          v-if="hintLevel !== null && !hintLoading && !hintTyping"
          align="center"
          size="small"
          style="margin-top: 8px"
        >
          <n-tag size="small" :bordered="false">
            {{ hintLevelLabel(hintLevel) }}
          </n-tag>
          <n-button
            v-if="hintCanEscalate"
            size="tiny"
            type="primary"
            ghost
            @click="fetchHint(submission.id, true)"
          >
            再多一点提示
          </n-button>
        </n-flex>
        <n-flex
          v-if="hintId !== null && !hintLoading && !hintTyping"
          align="center"
          size="small"
          style="margin-top: 8px"
        >
          <n-text depth="3">这条提示对你有帮助吗？</n-text>
          <n-button
            size="tiny"
            :type="hintHelpful === true ? 'primary' : 'default'"
            :disabled="hintFeedbackSending"
            @click="sendHintFeedback(true)"
          >
            有帮助
          </n-button>
          <n-button
            size="tiny"
            :type="hintHelpful === false ? 'warning' : 'default'"
            :disabled="hintFeedbackSending"
            @click="sendHintFeedback(false)"
          >
            没帮助
          </n-button>
        </n-flex>
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

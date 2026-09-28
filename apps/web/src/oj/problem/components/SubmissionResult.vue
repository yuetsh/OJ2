<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { HINT_MIN_FAILURES, hintLevelLabel } from "@oj2/contract"
import type { JudgeCaseResult } from "@oj2/contract"
import { JUDGE_STATUS, SubmissionStatus } from "utils/constants"
import {
  submissionCaseResults,
  submissionMemoryFormat,
  submissionPartialCases,
  submissionTimeFormat,
} from "utils/functions"
import type { Submission } from "utils/types"
import SubmissionResultTag from "shared/components/SubmissionResultTag.vue"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"
import PythonErrorExplain from "./PythonErrorExplain.vue"
import RuntimeErrorExplain from "./RuntimeErrorExplain.vue"
import WrongAnswerExplain from "./WrongAnswerExplain.vue"
import LessonNext from "./LessonNext.vue"
import ResultHeader from "./ResultHeader.vue"
import SimilarProblems from "./SimilarProblems.vue"
import { useLessonStore } from "oj/store/lesson"
import { useProblemPageContext } from "../composables/problemPageContext"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { useDark } from "@vueuse/core"

const props = defineProps<{
  submission?: Submission
  /**
   * 看的是别人的提交（协作中的老师看学生最近一次交的）：不给 AI 提示 —— 那是按登录的人
   * 自己的失败次数解锁的 —— 也不给「这节课的下一题」
   */
  peer?: boolean
}>()

const isDark = useDark()
const problemStore = useProblemStore()
const theme = useThemeVars()

// AI 提示的状态在 submission store 里（见 oj/problem/composables/useSubmissionHint.ts）：
// 这个组件在提交按钮那边，编辑器一卸载它就跟着卸载，已经生成的提示不能跟着没
const {
  hintTarget,
  hintContent,
  hintLoading,
  hintError,
  hintId,
  hintLevel,
  hintCanEscalate,
  hintHelpful,
  hintFeedbackSending,
  hintTyping,
  fetchHint,
  sendHintFeedback,
} = useSubmissionStore().hint

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
 * 1.5 秒会自动跳回题单（SubmissionEffects），这两种都不给
 */
const ctx = useProblemPageContext()
const showLessonNext = computed(
  () =>
    !props.peer && props.submission?.result === SubmissionStatus.accepted && ctx.value.lessonNext,
)

/**
 * 通过了、但这道题不在这节课里（没有「下一题」可给）：给几道相似题接着练。
 * 原来相似题只在题面最底下，交完不会有人再滚回去看
 */
const lessonStore = useLessonStore()
const showSimilar = computed(
  () =>
    !props.peer &&
    props.submission?.result === SubmissionStatus.accepted &&
    ctx.value.similar &&
    !!problemStore.problem &&
    !lessonStore.includes(problemStore.problem._id),
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

/** 在公开的例子上就错了：这时候「通过 x/y 个测试点」没意义，先说是哪个例子 */
const failedOnSample = computed(() =>
  sampleCheck.value && !sampleCheck.value.passed ? sampleCheck.value : null,
)

/**
 * 结果标题（设计文档第 6 节、设计稿「答案错误 / 答案正确 / 错在隐藏测试点」）：
 * 大字是判题结果，灰色小字说清楚错在哪 —— 例子上就错了的说「在例子 N 上就错了」、不挂进度；
 * 其余照旧报「通过 x/y 个测试点」（一个都没过就不报）；做对了说全对了。
 * 提交详情页还用通用的 submissionResultTitle
 */
const header = computed(() => {
  const submission = props.submission
  if (!submission) return null
  const status = JUDGE_STATUS[submission.result]
  if (
    submission.result === SubmissionStatus.pending ||
    submission.result === SubmissionStatus.judging ||
    submission.result === SubmissionStatus.submitting
  ) {
    return { kind: "pending" as const, title: status.title, sub: "", progress: null }
  }
  if (submission.result === SubmissionStatus.accepted) {
    return {
      kind: "success" as const,
      title: status.title,
      sub: "所有测试点都对了",
      progress: null,
    }
  }
  if (failedOnSample.value) {
    return {
      kind: status.type,
      title: status.title,
      sub: `在例子 ${(failedOnSample.value.index ?? 0) + 1} 上就错了`,
      progress: null,
    }
  }
  const cases = partialCases.value
  return {
    kind: status.type,
    title: status.title,
    sub: cases ? `通过 ${cases.passed}/${cases.total} 个测试点` : "",
    progress: cases,
  }
})

/**
 * 例子都对了、错在隐藏测试点：「去『自己输入』拿 90、80 这些数试试」。数取题目描述里出现的、
 * 例子里没有的头两个 —— 分段、判断一类题的边界多半就写在描述里（设计稿「错在隐藏测试点」）。
 * SQL 题、比赛里没有「自己输入」
 */
const submissionStore = useSubmissionStore()
const customRunHint = computed(() => {
  if (!sampleCheck.value?.passed || props.peer) return ""
  const problem = problemStore.problem
  if (!problem || problem.sqlConfig) return ""
  // 例子里出现过的数不算：例子已经对了，拿它们再试一遍没用
  const inSamples = new Set(
    problem.samples.flatMap(
      (sample) => `${sample.input} ${sample.output}`.match(/-?\d+(?:\.\d+)?/g) ?? [],
    ),
  )
  const numbers = [...new Set(problem.description.match(/-?\d+(?:\.\d+)?/g) ?? [])]
    .filter((value) => !inSamples.has(value))
    .slice(0, 2)
  return numbers.length
    ? `去「自己输入」拿 ${numbers.join("、")} 这些数试试 ›`
    : "去「自己输入」拿特殊的数试试 ›"
})

// 是否显示AI提示区域。
// 阈值和后端 POST /ai/hint 共用契约里的 HINT_MIN_FAILURES，别在这里写死数字；
// 编译失败不数次数，和后端同口径（理由见 HINT_MIN_FAILURES 的注释）；
// failCount 现在含服务端下发的历史失败数，刷新页面不会把进度清掉。
// system_error 也要排掉：那是判题机自己崩了，学生代码没毛病，让 AI 去分析
// 只会瞎编一通，后端的失败计数同样不认这个状态。
const showAIHint = computed(() => {
  if (!props.submission || props.peer) return false
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
    <ResultHeader
      v-if="header"
      :kind="header.kind"
      :title="header.title"
      :sub="header.sub"
      :progress="header.progress"
    />
    <LessonNext
      v-if="showLessonNext && problemStore.problem"
      :problem-display-id="problemStore.problem._id"
    />
    <SimilarProblems v-if="showSimilar" title="再练几道相似的" />
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
        full
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

    <!--
      设计稿：还没问过 AI 时只是一个描边按钮；错在隐藏测试点时旁边给「去自己输入试试」。
      问过之后，AI 的回答才放进卡片
    -->
    <div v-if="(showAIHint && !hintTarget) || customRunHint" class="actions">
      <n-button
        v-if="showAIHint && !hintTarget"
        type="primary"
        ghost
        :loading="hintLoading"
        @click="fetchHint(submission.id)"
      >
        让 AI 分析我的代码
      </n-button>
      <n-button
        v-if="customRunHint"
        text
        type="primary"
        @click="submissionStore.revealResult('custom')"
      >
        {{ customRunHint }}
      </n-button>
    </div>
    <n-alert v-if="showAIHint && hintError" type="error" :title="hintError" class="hint-error" />
    <template v-if="showAIHint && hintTarget">
      <n-card size="small" class="hint-card">
        <n-spin v-if="hintLoading && !hintContent" size="small" />
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
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 12px;
}

.hint-error {
  margin-top: 12px;
}

.hint-card {
  margin-top: 12px;
  max-width: 560px;
}

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

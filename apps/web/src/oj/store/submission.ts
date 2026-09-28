import { defineStore } from "pinia"
import { errorCode, errorMessage } from "utils/api"
import { formatCode, submitCode } from "oj/api"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionMonitor } from "oj/problem/composables/useSubmissionMonitor"
import { useSubmissionHint } from "oj/problem/composables/useSubmissionHint"
import { restartEditTrace, snapshotEditTrace } from "oj/problem/utils/editTrace"
import { useCollabStore } from "shared/store/collab"
import { LANGUAGE_FORMAT_VALUE } from "utils/constants"
import type { SubmitCodePayload } from "utils/types"

/**
 * 题目页上「这一次提交」的全部状态：正在跟的那条提交、判题跟踪（WebSocket + 轮询）、
 * 提交前语法检查的错误、结果面板开没开、5 秒冷却、AI 提示。
 *
 * 原来它们都长在提交按钮那个组件（SubmitCode）里，而那个组件在编辑器的工具栏里 ——
 * 手机上交完切到「描述」页签（Naive 的页签默认切走即卸载）、桌面切到「题目 / 自测」
 * 模式，编辑器一卸载，判题结果、AI 提示、失败计数、通过后的点评和回题单全都丢了。
 * 挪到 store 之后组件卸了再挂回来，状态还在。
 *
 * 判完之后「该发生什么」（失败计数、标成已解决、烟花、点评、回题单）不在这里，
 * 在页面这一层的 SubmissionEffects —— 它们要路由守卫和弹窗，得挂在一直在的组件上。
 */
export const useSubmissionStore = defineStore("submission", () => {
  const problemStore = useProblemStore()
  const codeStore = useCodeStore()
  const collabStore = useCollabStore()

  const monitor = useSubmissionMonitor()
  const hint = useSubmissionHint()

  /** 结果面板开着没有。放 store 里是为了按钮组件卸了再挂回来，面板还是原来的开合 */
  const showResult = ref(false)
  const isFormatting = ref(false)
  const isSubmittingRequest = ref(false)

  /**
   * 提交前语法检查查出来的错误（CPython 的报错原文），有它时结果面板显示中文说明、
   * 不显示上一次的判题结果。这次没交上去，所以不是一条提交、也不数进失败次数。
   *
   * 检查在服务端做（`/code/format` 里先用 CPython 编译一遍），原来是浏览器里的 Skulpt：
   * 那个只能报「第 N 行有错」，而且要下载 ~226KB。
   */
  const syntaxErrorInfo = ref("")

  const { start: startCooldown, isPending: isCooldown } = useTimeout(5000, {
    controls: true,
    immediate: false,
  })

  /**
   * 交一次。`contestId` / `problemSetId` 是路由参数（空串 = 不是从那个入口进来的），
   * 由调用方给：store 不看路由。
   */
  async function submit(entry: { contestId: string; problemSetId: string }) {
    const problem = problemStore.problem
    if (!problem) return
    syntaxErrorInfo.value = ""

    // 0. 提交前自动格式化（Python 用 ruff，C/C++ 用 clang-format，SQL 用 sqlparse）。
    //    Python 在格式化之前先由服务端的 CPython 查一遍语法，有错就不提交
    const formatLang = LANGUAGE_FORMAT_VALUE[codeStore.code.language]
    if (["python", "c", "cpp", "sql"].includes(formatLang)) {
      isFormatting.value = true
      try {
        const res = await formatCode({
          code: codeStore.code.value,
          language: formatLang,
        })
        codeStore.setCode(res.code)
      } catch (e) {
        if (errorCode(e) === "syntax-error") {
          // 仅 Python 会出现：message 是 CPython 的报错原文，交给 PythonErrorExplain 翻译
          syntaxErrorInfo.value = errorMessage(e)
          showResult.value = true
          return
        }
        // server-error / 网络异常：格式化工具问题，静默降级，提交原代码
      } finally {
        isFormatting.value = false
      }
    }

    // 1. 构建提交数据
    const data: SubmitCodePayload = {
      problemId: problem.id,
      language: codeStore.code.language,
      code: codeStore.code.value,
      // 编辑过程信号，见 utils/editTrace.ts。协作的判断和 ProblemEditor 的 collabHere 同一个口径
      trace: snapshotEditTrace(
        collabStore.room !== null && collabStore.room.problemId === problem._id,
      ),
    }
    if (entry.contestId) {
      data.contestId = parseInt(entry.contestId)
    }
    // 从题单入口进来的，把来源题单一起报上去：提交列表要据此标出「来自题单」。
    // 只是来源标记，题单进度仍由后端判完之后自己记账（judge/run.ts）
    if (entry.problemSetId) {
      data.problemSetId = parseInt(entry.problemSetId)
    }
    // 2. 提交代码到后端
    isSubmittingRequest.value = true
    try {
      const res = await submitCode(data)
      console.log(`[Submit] 代码已提交: ID=${res.submissionId}`)
      // 交上了才清零；被限流 / 网络失败的话这一段接着记，下次提交一起报
      restartEditTrace(codeStore.code.value.length)

      // 3. 启动冷却 + 监控
      startCooldown()
      monitor.startMonitoring(res.submissionId)
      showResult.value = true
    } finally {
      isSubmittingRequest.value = false
    }
  }

  /**
   * 收掉这一道题的所有东西：结果面板、语法错误、还在跟的那条提交、AI 提示。
   * 提交本身照常判完落库，只是这边不再跟 —— 不然上一道还在判的那条判完，
   * 会把**新题**标成已解决。
   */
  function reset() {
    showResult.value = false
    syntaxErrorInfo.value = ""
    monitor.reset()
    hint.clearHint()
  }

  // 题目页换题是同一个组件复用（顶栏题号直达、「下一题」都只换路由参数）
  watch(
    () => problemStore.problem?._id,
    (next, previous) => {
      if (!previous || next === previous) return
      reset()
    },
  )

  // 换了一次提交就清掉上一次的 AI 提示，否则新结果底下挂着上一次的提示，
  // 而「让 AI 分析」按钮已经被藏了，学生没法重新分析
  watch(() => monitor.submission.value?.id, hint.clearHint)

  return {
    submission: monitor.submission,
    judging: monitor.judging,
    pending: monitor.pending,
    submitting: monitor.submitting,
    showResult,
    isFormatting,
    isSubmittingRequest,
    syntaxErrorInfo,
    isCooldown,
    submit,
    reset,
    // markRaw：不让 store 把它包成 reactive，组件解构出来的还是 ref
    hint: markRaw(hint),
  }
})

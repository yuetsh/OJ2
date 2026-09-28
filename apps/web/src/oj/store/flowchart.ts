import { createDiscreteApi } from "naive-ui"
import { defineStore } from "pinia"
import { errorCode } from "utils/api"
import {
  getCurrentProblemFlowchartSubmission,
  getFlowchartSubmission,
  getFlowchartSubmissionDetail,
  submitFlowchart,
} from "oj/api"
import { useProblemStore } from "oj/store/problem"
import { useFlowchartWebSocket, type FlowchartEvaluationUpdate } from "shared/composables/websocket"
import { useMyFlowchartStore } from "shared/store/myFlowchart"
import { useUserStore } from "shared/store/user"

// store 里没有组件上下文，useMessage() 拿不到，和 utils/api.ts 一样用独立的一份
const { message } = createDiscreteApi(["message"])

export interface FlowchartRating {
  score: number
  grade: string
}

type Outcome = { ok: true; score: number; grade: string } | { ok: false; error?: string }

/** AI 评分比判题慢得多，轮询放缓一点 */
const POLL_INTERVAL = 3000
/** 到点还没结果就收手，别无限轮询下去 */
const POLL_TIMEOUT = 3 * 60 * 1000

/**
 * 流程图提交与 AI 评分：正在评的那一次、最近一次的分数、提交次数。
 *
 * 原来都在提交按钮那个组件（SubmitFlowchart）里，而它只在语言选成 Flowchart 时才挂载 ——
 * 交完切到写代码，组件一卸载就断开 WebSocket，正在评的那次结果就丢了（评分中位 4.8 秒、
 * 最长二十几秒，足够学生切走）。挪到 store 之后，切走了照样评完、照样提示、照样把
 * A/S 的图亮到「我的流程图」。评分详情弹框只是展示，还留在组件里。
 */
export const useFlowchartStore = defineStore("flowchart", () => {
  const problemStore = useProblemStore()
  const myFlowchartStore = useMyFlowchartStore()

  const loading = ref(false)
  const latestRating = ref<FlowchartRating>({ score: 0, grade: "" })
  const submissionCount = ref(0)
  /** 最近一次交上去的那张图，评到 A/S 时亮到「我的流程图」 */
  const lastSubmittedMermaidCode = ref("")
  /** 最近一次分数是哪道题的；换题后置空，下次挂载时重新拉 */
  let loadedFor: number | null = null

  // ==================== 评分结果监听 ====================
  /**
   * 评分结果有两条路进来：WebSocket 推送（快）和轮询（稳）。谁先到谁结算，
   * 靠 monitoringId 去重 —— 结算时清空，另一条路后到就直接跳过。
   *
   * 之所以必须有轮询兜底：Redis pub/sub 是发完不管的，worker 推的那一刻只要这条
   * 连接不在（重连空窗、页面刚从后台切回来），这条消息就永远丢了。判题那边一直
   * 有兜底轮询，流程图这边没有，丢一次消息按钮就一直转圈转到用户自己刷新。
   */
  let monitoringId = ""

  const { pause: pausePolling, resume: resumePolling } = useIntervalFn(
    async () => {
      if (!monitoringId) {
        pausePolling()
        return
      }
      try {
        const data = await getFlowchartSubmission(monitoringId)
        if (data.status === 2) {
          settle(data.id, {
            ok: true,
            score: data.aiScore ?? 0,
            grade: data.aiGrade ?? "",
          })
        } else if (data.status === 3) {
          settle(data.id, { ok: false })
        }
      } catch (error) {
        console.error("[Flowchart] 轮询失败:", error)
        pausePolling()
      }
    },
    POLL_INTERVAL,
    { immediate: false },
  )

  // WebSocket 正常时压根用不上轮询，先给它 5 秒，到点还没结果才开始拉
  const { start: startPollingFallback, stop: stopPollingFallback } = useTimeoutFn(
    () => {
      if (monitoringId) resumePolling()
    },
    5000,
    { immediate: false },
  )

  const { start: startPollingDeadline, stop: stopPollingDeadline } = useTimeoutFn(
    () => {
      if (!monitoringId) return
      stopMonitoring()
      message.warning("评分等待超时，请稍后刷新页面查看结果")
    },
    POLL_TIMEOUT,
    { immediate: false },
  )

  /** 不再跟这一次评分：结算完、超时、或者换了题 */
  function stopMonitoring() {
    monitoringId = ""
    unsubscribe()
    pausePolling()
    stopPollingFallback()
    stopPollingDeadline()
    loading.value = false
  }

  function settle(submissionId: string, outcome: Outcome) {
    // 一个学生可能同时开着几道题的页面，每条连接都订在同一个用户 topic 上，
    // 别的页面的评分结果照样会推到这里来 —— 必须认 id，不然会张冠李戴
    if (!submissionId || submissionId !== monitoringId) return
    stopMonitoring()
    // 评完了就不急着断：接着还可能再交一次。和判题那边一样，闲 15 分钟再断
    scheduleDisconnect(15 * 60 * 1000)

    if (!outcome.ok) {
      message.error(
        outcome.error ? `流程图评分失败: ${outcome.error}` : "流程图评分失败，请稍后重试",
      )
      return
    }
    latestRating.value = { score: outcome.score, grade: outcome.grade }
    message.success(`流程图评分完成！得分: ${outcome.score}分 (${outcome.grade}级)`)
    if ((outcome.grade === "A" || outcome.grade === "S") && lastSubmittedMermaidCode.value) {
      myFlowchartStore.show(lastSubmittedMermaidCode.value)
    }
  }

  const handleWebSocketMessage = (data: FlowchartEvaluationUpdate) => {
    if (data.type === "flowchart_evaluation_completed") {
      settle(data.submissionId, {
        ok: true,
        score: data.score ?? 0,
        grade: data.grade || "",
      })
    } else if (data.type === "flowchart_evaluation_failed") {
      settle(data.submissionId, { ok: false, error: data.error })
    }
  }

  const { connect, subscribe, unsubscribe, scheduleDisconnect, cancelScheduledDisconnect } =
    useFlowchartWebSocket(handleWebSocketMessage)

  // ==================== 提交 ====================
  /** 交一张图。图的两种形态（Mermaid 源码、压缩过的编辑器数据）由组件从编辑器里取出来给 */
  async function submit(mermaidCode: string, compressedData: string) {
    const problem = problemStore.problem
    if (!problem) return
    // 原来没有这一道：没登录也能点，请求发出去才被拦下，学生只看到一句「提交失败」
    if (!useUserStore().isAuthed) {
      message.warning("请先登录")
      return
    }

    lastSubmittedMermaidCode.value = mermaidCode
    loading.value = true
    latestRating.value = { score: 0, grade: "" }

    try {
      const response = await submitFlowchart({
        problemId: problem.id,
        mermaidCode,
        flowchartData: {
          compressed: true,
          data: compressedData,
        },
      })

      if (response.submissionId) {
        // 订阅提交更新，同时开启轮询兜底。connect() 幂等；没连上时 subscribe 会先记着
        cancelScheduledDisconnect()
        connect()
        monitoringId = response.submissionId
        subscribe(response.submissionId)
        startPollingFallback()
        startPollingDeadline()
      }

      message.success("流程图已提交，请耐心等待评分")
    } catch (error) {
      loading.value = false
      // 按错误码分支（见 utils/api.ts 的约定）。限流是最容易撞上的一种：
      // 只说「提交失败」的话，学生会以为是自己的图有问题，然后反复点，越点越久
      if (errorCode(error) === "too-many-submissions") {
        message.warning("提交太频繁了，缓一会儿再交")
      } else if (errorCode(error) === "flowchart-not-allowed") {
        message.error("这道题不接受流程图提交")
      } else {
        message.error("流程图提交失败")
      }
      console.error("提交流程图失败:", error)
    }
  }

  // ==================== 最近一次的分数 ====================
  /**
   * 这道题最近一次的分数；画到了 A/S 的话，把那张图亮到「我的流程图」。
   * 同一道题只拉一次（组件卸了再挂回来不重拉），换题后 loadedFor 清空。
   */
  async function ensureLoaded() {
    const problemId = problemStore.problem?.id
    if (!problemId || loadedFor === problemId) return
    loadedFor = problemId
    try {
      const data = await getCurrentProblemFlowchartSubmission(problemId)
      // 换题之后才回来的是上一道题的分数，别盖掉新题的
      if (problemStore.problem?.id !== problemId) return
      submissionCount.value = data.count
      latestRating.value = { score: data.score, grade: data.grade }
      const grade = data.grade
      if ((grade === "A" || grade === "S") && data.count > 0) {
        const detail = await getFlowchartSubmissionDetail(problemId, data.count)
        // 查的这一会儿又换了题，这张图不是新题的
        if (problemStore.problem?.id !== problemId) return
        if (detail.submission?.mermaidCode) myFlowchartStore.show(detail.submission.mermaidCode)
      }
    } catch (error) {
      // 拉不到就当没交过；下次挂载再试
      loadedFor = null
      console.error("[Flowchart] 读取最近一次评分失败:", error)
    }
  }

  /**
   * 收掉这一道题的：还在评的那一次不再跟（照常评完落库），分数、次数清空。
   * 题目页换题是同一个组件复用，两道题都能画流程图、语言又停在 Flowchart 时组件
   * 连卸载都不会 —— 不收的话上一道还在评的那次评完，会把它的图挂到新题上。
   */
  function reset() {
    stopMonitoring()
    latestRating.value = { score: 0, grade: "" }
    submissionCount.value = 0
    lastSubmittedMermaidCode.value = ""
    loadedFor = null
  }

  watch(
    () => problemStore.problem?.id,
    (next, previous) => {
      if (!previous || next === previous) return
      reset()
    },
  )

  return {
    loading,
    latestRating,
    submissionCount,
    submit,
    ensureLoaded,
    reset,
  }
})

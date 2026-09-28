import { createDiscreteApi } from "naive-ui"
import { defineStore } from "pinia"
import { errorCode } from "utils/api"
import { isFlowchartPass, type FlowchartScores, type FlowchartSubmission } from "@oj2/contract"
import type { Edge, Node } from "@vue-flow/core"
import { getFlowchartScores, getFlowchartSubmission, submitFlowchart } from "oj/api"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"
import { useFlowchartWebSocket, type FlowchartEvaluationUpdate } from "shared/composables/websocket"
import { useMyFlowchartStore } from "shared/store/myFlowchart"
import { useUserStore } from "shared/store/user"
import { useAchievementStore } from "shared/store/achievement"
import type { QueuedAchievement } from "utils/types"

// store 里没有组件上下文，useMessage() 拿不到，和 utils/api.ts 一样用独立的一份
const { message } = createDiscreteApi(["message"])

export interface FlowchartRating {
  score: number
  grade: string
}

type Outcome = { ok: true; score: number; grade: string } | { ok: false; error?: string }

/** 编辑器对外的两个方法（FlowchartEditor 的 defineExpose） */
export interface FlowchartEditorInstance {
  getFlowchartData: () => { nodes: unknown[]; edges: unknown[] }
  setFlowchartData: (data: { nodes: Node[]; edges: Edge[] }) => void
}

// 「A / S 算做完」的规则在契约里，前后端一份；这里转出去，组件照旧从 flowchart store 引
export { isFlowchartPass }

/**
 * 这一页上最近一次交的图走到哪了。idle = 这一页还没交过（历史分数照样有）
 */
export type FlowchartPhase = "idle" | "evaluating" | "done" | "failed"

/** AI 评分比判题慢得多，轮询放缓一点 */
const POLL_INTERVAL = 3000
/** 到点还没结果就收手，别无限轮询下去 */
const POLL_TIMEOUT = 3 * 60 * 1000

/**
 * 流程图提交与 AI 评分：正在评的那一次、历次分数、结果页签正在看哪一次。
 *
 * 原来都在提交按钮那个组件（SubmitFlowchart）里，而它只在语言选成 Flowchart 时才挂载 ——
 * 交完切到写代码，组件一卸载就断开 WebSocket，正在评的那次结果就丢了（评分中位 4.8 秒、
 * 最长二十几秒，足够学生切走）。挪到 store 之后，切走了照样评完、照样提示、照样把
 * A/S 的图亮到「你画的流程图」。评分详情从 1000px 的弹框挪进了左栏「结果」页签
 * （FlowchartResult），那边只管显示。
 */
export const useFlowchartStore = defineStore("flowchart", () => {
  const problemStore = useProblemStore()
  const myFlowchartStore = useMyFlowchartStore()

  const loading = ref(false)
  const latestRating = ref<FlowchartRating>({ score: 0, grade: "" })
  const phase = ref<FlowchartPhase>("idle")
  /**
   * 这一页上**刚刚**评完一次就加一（不含进页面时读到的历史）。课堂条标做完、题单里
   * 1.5 秒后跳回题单，都只认这一下 —— 进页面读到以前的 A 不该再跳一次
   */
  const evaluatedSeq = ref(0)
  /** 这道题评完的每一次，早的在前；hidden = 加入题单之前、被藏起来的次数 */
  const scores = ref<FlowchartScores["scores"]>([])
  const hiddenCount = ref(0)
  const submissionCount = computed(() => scores.value.length)
  /** 结果页签正在看哪一次；null = 最新那次 */
  const selectedId = ref<string | null>(null)
  /** 看过的几次的完整评语，按 id 缓存（评完就不会再变） */
  const details = ref<Record<string, FlowchartSubmission>>({})
  const detailLoading = ref(false)
  /**
   * 进题时历次分数没读出来。原来读失败就当没交过，结果页签写着「还没交过流程图」——
   * 学生明明交过五次，会以为记录丢了
   */
  const scoresFailed = ref(false)

  /** 画布本身。结果页签要拿当前画布和某一版比一比、把那一版载回去 */
  const editor = shallowRef<FlowchartEditorInstance | null>(null)
  function attachEditor(instance: FlowchartEditorInstance | null) {
    editor.value = instance
  }
  /** 最近一次交上去的那张图，评到 A/S 时亮到「我的流程图」 */
  const lastSubmittedMermaidCode = ref("")
  /** 最近一次分数是哪道题的；换题后置空，下次挂载时重新拉 */
  let loadedFor: number | null = null
  /**
   * 换一次题（reset）加一。每个 await 回来都要对一下：请求在路上时学生换了题，
   * 回来的是上一道题的东西，不能落到这一道上
   */
  let generation = 0

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
  /** 正在跟的那一次是哪道题的，结算时再对一遍 */
  let monitoringProblemId: number | null = null

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
    monitoringProblemId = null
    unsubscribe()
    pausePolling()
    stopPollingFallback()
    stopPollingDeadline()
    loading.value = false
    // 连接挂在 store 上，离开题目页也不会跟着组件断。不立刻断：接着还可能再交一次，
    // A/S 之后的成就也走这条连接推过来。和判题那边一样，闲 15 分钟再断
    scheduleDisconnect(15 * 60 * 1000)
  }

  function settle(submissionId: string, outcome: Outcome) {
    // 一个学生可能同时开着几道题的页面，每条连接都订在同一个用户 topic 上，
    // 别的页面的评分结果照样会推到这里来 —— 必须认 id，不然会张冠李戴
    if (!submissionId || submissionId !== monitoringId) return
    // 换题时 reset 已经把 monitoringId 清了，这里再对一遍题号：别的题评完的分数、烟花、
    // 「这节课做完」、A/S 那张图，都不能落到眼前这道题上
    const problemId = monitoringProblemId
    stopMonitoring()
    if (!problemId || problemStore.problem?.id !== problemId) return

    if (!outcome.ok) {
      phase.value = "failed"
      message.error("AI 这次没评出来，再交一次试试")
      return
    }
    latestRating.value = { score: outcome.score, grade: outcome.grade }
    phase.value = "done"
    selectedId.value = null
    evaluatedSeq.value++
    // 学生这会儿可能在看题目：只提示一句、页签上亮状态，不强行把他切过去（设计文档 5.3）
    message.success(`AI 点评完了：${outcome.score} 分，${outcome.grade} 级`)
    if (isFlowchartPass(outcome.grade) && lastSubmittedMermaidCode.value) {
      myFlowchartStore.show(lastSubmittedMermaidCode.value)
    }
    // 先把这一次记进历次分数，再去拉全量：拉失败的话，结果页签照样看得到这次的分数，
    // 不会还停在上一次（第一次交时则是「还没交过流程图」）
    if (!scores.value.some((row) => row.id === submissionId)) {
      scores.value = [
        ...scores.value,
        {
          id: submissionId,
          score: outcome.score,
          grade: outcome.grade,
          createTime: new Date().toISOString(),
        },
      ]
    }
    loadScores(problemId).catch((error) => {
      console.error("[Flowchart] 刷新历次评分失败:", error)
    })
  }

  const handleWebSocketMessage = (data: FlowchartEvaluationUpdate) => {
    // 流程图画到 A/S 算完成之后，后端会在同一条用户通道上推题单徽章、成就（flowchart/run.ts 的
    // recordSolvedAndNotify）。原来这里只认评分那两种，交代码的监视器又不一定开着，要等下次
    // 换路由拉 pending 才弹。队列按 id 去重，两条连接各收一遍也只弹一次
    const frame = data as unknown as { type: string; achievements?: QueuedAchievement[] }
    if (frame.type === "achievement_unlocked") {
      useAchievementStore().enqueue(frame.achievements ?? [])
      return
    }
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

    const gen = generation
    lastSubmittedMermaidCode.value = mermaidCode
    loading.value = true
    phase.value = "evaluating"
    // 结果页签回到最新这一次：刚才可能在翻以前的某一次，那样就看不到「AI 正在看你的图」
    selectedId.value = null
    // 交上去就切到「结果」页签，和交代码一样
    useSubmissionStore().revealResult()

    try {
      const response = await submitFlowchart({
        problemId: problem.id,
        mermaidCode,
        flowchartData: {
          compressed: true,
          data: compressedData,
        },
      })

      // 请求在路上时换了题：这一次照常评完落库，回到那道题时在历次分数里看得到；
      // 但不能再跟它 —— 评完会把分数、烟花、「做完了」都落到新题上
      if (gen !== generation) return
      if (response.submissionId) {
        // 订阅提交更新，同时开启轮询兜底。connect() 幂等；没连上时 subscribe 会先记着
        cancelScheduledDisconnect()
        connect()
        monitoringId = response.submissionId
        monitoringProblemId = problem.id
        subscribe(response.submissionId)
        startPollingFallback()
        startPollingDeadline()
      }
    } catch (error) {
      if (gen !== generation) return
      loading.value = false
      phase.value = "idle"
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

  // ==================== 历次分数 ====================
  async function loadScores(problemId: number) {
    const data = await getFlowchartScores(problemId)
    // 换题之后才回来的是上一道题的，别盖掉新题的
    if (problemStore.problem?.id !== problemId) return
    scores.value = data.scores
    hiddenCount.value = data.hidden
    const latest = data.scores.at(-1)
    if (latest && phase.value !== "evaluating") {
      latestRating.value = { score: latest.score, grade: latest.grade }
    }
  }

  /**
   * 进这道题时读一次历次分数；画到过 A/S 的话，把最近那张 A/S 亮到题面的「你画的流程图」。
   * 同一道题只读一次（组件卸了再挂回来不重读），换题后 loadedFor 清空。
   */
  async function ensureLoaded() {
    const problemId = problemStore.problem?.id
    if (!problemId || loadedFor === problemId) return
    loadedFor = problemId
    const gen = generation
    try {
      await loadScores(problemId)
      if (problemStore.problem?.id !== problemId) return
      scoresFailed.value = false
      const passed = scores.value.filter((row) => isFlowchartPass(row.grade)).at(-1)
      if (passed) {
        const detail = await fetchDetail(passed.id)
        // 查的这一会儿又换了题，这张图不是新题的
        if (problemStore.problem?.id !== problemId) return
        if (detail?.mermaidCode) myFlowchartStore.show(detail.mermaidCode)
      }
    } catch (error) {
      console.error("[Flowchart] 读取历次评分失败:", error)
      // 换过题了：这是上一道题的失败，别把新题的状态改掉
      if (gen !== generation) return
      // 下次挂载、或者结果页签里点「再读一次」时重试
      loadedFor = null
      if (!scores.value.length) scoresFailed.value = true
    }
  }

  async function fetchDetail(id: string) {
    const cached = details.value[id]
    if (cached) return cached
    const gen = generation
    const detail = await getFlowchartSubmission(id)
    // 换过题就不进缓存：reset 刚清过，别把上一道题的塞回去
    if (gen === generation) details.value[id] = detail
    return detail
  }

  /** 结果页签里点了某一次（null = 回到最新）：把那次的完整评语拉回来 */
  async function select(id: string | null) {
    selectedId.value = id
    const target = id ?? scores.value.at(-1)?.id
    if (!target || details.value[target]) return
    const gen = generation
    detailLoading.value = true
    try {
      await fetchDetail(target)
    } catch {
      if (gen === generation) message.error("这一次的评语读不出来，过一会儿再试")
    } finally {
      if (gen === generation) detailLoading.value = false
    }
  }

  /**
   * 收掉这一道题的：还在评的那一次不再跟（照常评完落库），分数、次数清空。
   * 题目页换题是同一个组件复用，两道题都能画流程图、语言又停在 Flowchart 时组件
   * 连卸载都不会 —— 不收的话上一道还在评的那次评完，会把它的图挂到新题上。
   */
  function reset() {
    generation++
    stopMonitoring()
    latestRating.value = { score: 0, grade: "" }
    phase.value = "idle"
    scores.value = []
    hiddenCount.value = 0
    selectedId.value = null
    details.value = {}
    detailLoading.value = false
    scoresFailed.value = false
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
    phase,
    evaluatedSeq,
    scores,
    hiddenCount,
    submissionCount,
    selectedId,
    details,
    detailLoading,
    scoresFailed,
    editor,
    attachEditor,
    submit,
    ensureLoaded,
    select,
    reset,
  }
})

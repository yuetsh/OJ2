import { ref, computed, onUnmounted } from "vue"
import { useIntervalFn, useTimeoutFn } from "@vueuse/core"
import { getSubmission } from "oj/api"
import { SubmissionStatus } from "utils/constants"
import type { PendingAchievement, Submission } from "utils/types"
import { useAchievementStore } from "shared/store/achievement"
import {
  useSubmissionWebSocket,
  type SubmissionUpdate,
} from "shared/composables/websocket"

/**
 * 判题监控 Composable
 * 负责通过 WebSocket + 轮询双保险机制监控判题结果
 */
export function useSubmissionMonitor() {
  // ==================== 状态 ====================
  const submissionId = ref("")
  const submission = ref<Submission>()

  // ==================== 轮询机制 ====================
  const { pause: pausePolling, resume: resumePolling } = useIntervalFn(
    async () => {
      if (!submissionId.value) return

      try {
        const res = await getSubmission(submissionId.value)
        submission.value = res

        const result = res.result
        // 判题完成，停止轮询
        if (
          result !== SubmissionStatus.judging &&
          result !== SubmissionStatus.pending
        ) {
          pausePolling()
        }
      } catch (error) {
        console.error("[SubmissionMonitor] 轮询失败:", error)
        pausePolling()
      }
    },
    2000,
    { immediate: false },
  )

  // ==================== WebSocket 处理 ====================
  const handleSubmissionUpdate = (data: SubmissionUpdate) => {
    // push_to_user 复用了 submission_update 这个 channel handler，
    // 其他类型的消息会走同一条 WebSocket 帧进来，必须先分流
    const frame = data as unknown as {
      type: string
      achievements?: PendingAchievement[]
    }
    if (frame.type === "achievement_unlocked") {
      useAchievementStore().enqueue(frame.achievements ?? [])
      return
    }
    if (frame.type !== "submission_update") {
      return
    }

    console.log("[SubmissionMonitor] 收到WebSocket更新:", data)

    if (data.submissionId !== submissionId.value) {
      console.log("[SubmissionMonitor] 提交ID不匹配，忽略")
      return
    }

    if (!submission.value) {
      submission.value = {} as Submission
    }

    submission.value.result = data.result as Submission["result"]

    // 判题完成或出错，获取完整详情
    if (data.status === "finished" || data.status === "error") {
      console.log(
        `[SubmissionMonitor] 判题${data.status === "finished" ? "完成" : "出错"}`,
      )

      // 停止轮询（WebSocket已成功）
      pausePolling()
      // 结果已经到手，别让重连再去重放这条早就判完的订阅
      unsubscribe()

      getSubmission(submissionId.value).then((res) => {
        submission.value = res
        // 15分钟无新提交则断开WebSocket（节省资源）
        scheduleDisconnect(15 * 60 * 1000)
      })
    }
  }

  // 初始化 WebSocket
  const {
    connect,
    subscribe,
    unsubscribe,
    scheduleDisconnect,
    cancelScheduledDisconnect,
  } = useSubmissionWebSocket(handleSubmissionUpdate)

  // ==================== 轮询保底启动 ====================
  const { start: startPollingFallback } = useTimeoutFn(
    () => {
      if (
        submission.value &&
        (submission.value.result === SubmissionStatus.judging ||
          submission.value.result === SubmissionStatus.pending ||
          submission.value.result === SubmissionStatus.submitting)
      ) {
        console.log("[SubmissionMonitor] WebSocket未及时响应，启动轮询保底")
        resumePolling()
      }
    },
    5000,
    { immediate: false },
  )

  // ==================== 启动监控 ====================
  const startMonitoring = (id: string) => {
    submissionId.value = id
    submission.value = { id, result: SubmissionStatus.submitting } as Submission

    // 取消之前的断开计划
    cancelScheduledDisconnect()

    // connect() 是幂等的：已经连着就直接返回，顺带把上一次空闲断开留下的状态清掉
    connect()

    // 直接订阅，不必先等 status 变成 connected：连接没就绪时 subscribe() 会把 id
    // 记在 pendingSubmissionId 上，由 onConnected() 补发（断线重连后同样有效）。
    //
    // 原来这里是 watch(wsStatus, ..., { immediate: true })，而 immediate 的回调在
    // watch() **返回之前**就同步跑了 —— 已经连着时 unwatch 还是 null，if 不成立，
    // 这个 watcher 就永远停不掉：每提交一次泄漏一个，而且往后每次重连时它们都会
    // 把各自那个早就判完的旧 submissionId 重新订阅一遍。
    subscribe(id)

    // 5秒后启动轮询保底（防止WebSocket失败）
    startPollingFallback()
  }

  // ==================== 计算属性 ====================
  const judging = computed(
    () => submission.value?.result === SubmissionStatus.judging,
  )

  const pending = computed(
    () => submission.value?.result === SubmissionStatus.pending,
  )

  const submitting = computed(
    () => submission.value?.result === SubmissionStatus.submitting,
  )

  const isProcessing = computed(() => {
    return judging.value || pending.value || submitting.value
  })

  // ==================== 清理 ====================
  onUnmounted(() => {
    pausePolling()
  })

  return {
    // 状态
    submissionId,
    submission,

    // 计算属性
    judging,
    pending,
    submitting,
    isProcessing,

    // 方法
    startMonitoring,
    pausePolling,
  }
}

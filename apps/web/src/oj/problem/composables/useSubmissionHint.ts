import type { AiHintDone } from "@oj2/contract"
import { submitHintFeedback } from "oj/api"
import { useAIStream } from "shared/composables/aiStream"

/**
 * 一次提交的 AI 提示。
 *
 * 原来这些状态长在结果面板（SubmissionResult）里，而结果面板在提交按钮那个组件里 ——
 * 手机上切一下页签、桌面切一下分栏模式，编辑器连同它一起卸载，已经生成的提示没了，
 * 那次 LLM 调用白花。现在由 submission store 持有（见 oj/store/submission.ts）。
 *
 * hintTarget 是后端发来的全文，hintContent 是已经「打」出来的那一截 ——
 * 后端从 2c 起整段生成、过滤通过才推（设计 2.6），一次就把全文发过来，
 * 逐字显示改在这边模拟。
 */
export function useSubmissionHint() {
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

  /** 换了一次提交：还在生成的那条掐掉（不然它会写进新提交的面板里），内容清空 */
  function clearHint() {
    hintStream.abort()
    resetHint()
  }

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

  if (getCurrentScope()) onScopeDispose(stopTyping)

  return {
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
    clearHint,
  }
}

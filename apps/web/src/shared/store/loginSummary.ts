import type { LoginSummary as ContractLoginSummary } from "@oj2/contract"
import { getAILoginSummary } from "oj/api"

type LoginSummary = ContractLoginSummary["summary"]

export const useLoginSummaryStore = defineStore("loginSummary", () => {
  const show = ref(false)
  const loading = ref(false)
  const summary = ref<LoginSummary | null>(null)
  const analysis = ref("")
  const analysisError = ref("")

  function shouldShowSummary(nextSummary: LoginSummary | null) {
    if (!nextSummary) {
      return false
    }
    const values = [
      nextSummary.newProblemCount,
      nextSummary.submissionCount,
      nextSummary.acceptedCount,
      nextSummary.solvedCount,
      nextSummary.flowchartSubmissionCount,
    ]
    const zeroCount = values.filter((value) => value === 0).length
    return zeroCount < Math.floor(values.length / 2) + 1
  }

  async function fetchSummary() {
    loading.value = true
    analysis.value = ""
    analysisError.value = ""
    try {
      const res = await getAILoginSummary()
      summary.value = res.data.summary
      analysis.value = res.data.analysis || ""
      analysisError.value = res.data.analysisError || ""
    } catch (err) {
      analysisError.value = "获取登录统计失败，请稍后再试"
    } finally {
      loading.value = false
    }
  }

  async function open() {
    await fetchSummary()
    if (!summary.value && analysisError.value) {
      show.value = true
      return
    }
    show.value = shouldShowSummary(summary.value)
  }

  function close() {
    show.value = false
  }

  return {
    show,
    loading,
    summary,
    analysis,
    analysisError,
    fetchSummary,
    open,
    close,
  }
})

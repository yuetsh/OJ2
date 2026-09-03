import type { DetailsData, DurationData, SolvedProblem } from "utils/types"
import { aiStreamError, consumeJSONEventStream } from "utils/stream"
import {
  getAIDetailData,
  getAIDurationData,
  getAIHeatmapData,
  getAIPinnedReport,
  getAISolved,
} from "../api"

export const useAIStore = defineStore("ai", () => {
  const duration = ref("months:6")
  const targetUsername = ref("")
  // 生成 AI 分析时要把同一段时间原样报给后端（数据由后端重算，前端只报范围）
  const rangeStart = ref("")
  const rangeEnd = ref("")
  const durationData = ref<DurationData[]>([])
  const detailsData = reactive<DetailsData>({
    user: "",
    start: "",
    end: "",
    grade: "",
    className: null,
    tags: {},
    difficulty: {},
    contestCount: 0,
    solvedCount: 0,
    attempts: [],
    flowcharts: [],
    activity: [],
    errors: [],
    rankScope: "global",
  })
  const heatmapData = ref<{ timestamp: number; value: number }[]>([])

  // 解题明细走服务端分页：一个活跃学生一年几百道题，整份跟着 detail 一起下发没必要
  const solvedRows = ref<SolvedProblem[]>([])
  const solvedTotal = ref(0)
  const solvedPage = ref(1)
  const solvedPageSize = ref(20)

  const loading = reactive({
    fetching: false, // 合并 details 和 duration 的 loading
    ai: false,
    heatmap: false,
    solved: false,
  })

  const mdContent = ref("")
  const pinnedReport = ref<{ analysis: string } | null>(null)

  async function fetchDetailsData(start: string, end: string) {
    const res = await getAIDetailData(
      start,
      end,
      targetUsername.value || undefined,
    )
    detailsData.start = res.start
    detailsData.end = res.end
    detailsData.grade = res.grade
    detailsData.className = res.className
    detailsData.tags = res.tags
    detailsData.difficulty = res.difficulty
    detailsData.contestCount = res.contestCount
    detailsData.solvedCount = res.solvedCount
    detailsData.attempts = res.attempts
    detailsData.activity = res.activity
    detailsData.errors = res.errors
    detailsData.rankScope = res.rankScope
    detailsData.flowcharts = res.flowcharts
  }

  async function fetchDurationData(end: string, duration: string) {
    const res = await getAIDurationData(
      end,
      duration,
      targetUsername.value || undefined,
    )
    durationData.value = res
  }

  async function fetchSolved(page = solvedPage.value) {
    if (!rangeStart.value || !rangeEnd.value) return
    loading.solved = true
    try {
      const res = await getAISolved(
        rangeStart.value,
        rangeEnd.value,
        (page - 1) * solvedPageSize.value,
        solvedPageSize.value,
        targetUsername.value || undefined,
      )
      solvedRows.value = res.results
      solvedTotal.value = res.total
      solvedPage.value = page
    } finally {
      loading.solved = false
    }
  }

  async function fetchHeatmapData() {
    loading.heatmap = true
    const res = await getAIHeatmapData(targetUsername.value || undefined)
    heatmapData.value = res
    loading.heatmap = false
  }

  async function fetchAnalysisData(
    start: string,
    end: string,
    duration: string,
  ) {
    rangeStart.value = start
    rangeEnd.value = end
    // 换时间范围就回到第一页，否则停在第 5 页但新范围只有两页
    solvedPage.value = 1
    loading.fetching = true
    try {
      await Promise.all([
        fetchDetailsData(start, end),
        fetchDurationData(end, duration),
        fetchSolved(1),
      ])
    } finally {
      loading.fetching = false
    }
  }

  let aiController: AbortController | null = null

  async function fetchAIAnalysis() {
    if (aiController) {
      aiController.abort()
    }
    const controller = new AbortController()
    aiController = controller

    loading.ai = true
    mdContent.value = ""

    try {
      const response = await fetch("/api/ai/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: rangeStart.value,
          end: rangeEnd.value,
          duration: duration.value,
          username: targetUsername.value || undefined,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw await aiStreamError(response)
      }

      let hasStarted = false

      await consumeJSONEventStream(response, {
        signal: controller.signal,
        onEvent(event) {
          if (event === "end" && !hasStarted) {
            loading.ai = false
          }
        },
        onMessage(payload) {
          const parsed = payload as {
            type?: string
            content?: string
            message?: string
          }

          if (parsed.type === "delta" && parsed.content) {
            if (!hasStarted) {
              hasStarted = true
              loading.ai = false
            }
            mdContent.value += parsed.content
          } else if (parsed.type === "error") {
            throw new Error(parsed.message || "AI 服务异常")
          } else if (parsed.type === "done" && !hasStarted) {
            loading.ai = false
          }
        },
      })
    } catch (error: any) {
      if (controller.signal.aborted) {
        return
      }
      console.error("生成 AI 分析失败", error)
      const message = error?.message || "生成失败，请稍后再试"
      mdContent.value = `生成失败：${message}`
    } finally {
      if (aiController === controller) {
        aiController = null
        loading.ai = false
      }
    }
  }

  async function fetchPinnedReport() {
    const res = await getAIPinnedReport()
    pinnedReport.value = res
  }

  async function simulatePinnedStream() {
    if (!pinnedReport.value) return
    const text = pinnedReport.value.analysis
    mdContent.value = ""
    const CHUNK = 6
    const DELAY = 18
    await new Promise<void>((resolve) => {
      let i = 0
      function step() {
        if (i >= text.length) {
          resolve()
          return
        }
        mdContent.value += text.slice(i, i + CHUNK)
        i += CHUNK
        setTimeout(step, DELAY)
      }
      step()
    })
  }

  return {
    fetchAnalysisData,
    fetchHeatmapData,
    fetchSolved,
    solvedRows,
    solvedTotal,
    solvedPage,
    solvedPageSize,
    fetchAIAnalysis,
    fetchPinnedReport,
    simulatePinnedStream,
    durationData,
    detailsData,
    heatmapData,
    duration,
    targetUsername,
    loading,
    mdContent,
    pinnedReport,
  }
})

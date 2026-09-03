import type { DetailsData, DurationData } from "utils/types"
import { aiStreamError, consumeJSONEventStream } from "utils/stream"
import {
  getAIDetailData,
  getAIDurationData,
  getAIHeatmapData,
  getAIPinnedReport,
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
    solved: [],
    flowcharts: [],
    rankScope: "global",
  })
  const heatmapData = ref<{ timestamp: number; value: number }[]>([])

  const loading = reactive({
    fetching: false, // 合并 details 和 duration 的 loading
    ai: false,
    heatmap: false,
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
    detailsData.solved = res.solved
    detailsData.grade = res.grade
    detailsData.className = res.className
    detailsData.tags = res.tags
    detailsData.difficulty = res.difficulty
    detailsData.contestCount = res.contestCount
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
    loading.fetching = true
    try {
      await Promise.all([
        fetchDetailsData(start, end),
        fetchDurationData(end, duration),
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

import { computed, ref, type Ref } from 'vue'
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { SubmissionStatus } from 'utils/constants'
import { FlowchartSubmissionStatus, type FlowchartSubmissionListItem, type SubmissionListItem } from 'utils/types'
import type { Row, SubmissionQuery } from './listQuery'

function isPending(row: Row) {
  if ('result' in row) {
    return row.result === SubmissionStatus.pending || row.result === SubmissionStatus.judging
  }
  return row.status === FlowchartSubmissionStatus.PENDING || row.status === FlowchartSubmissionStatus.PROCESSING
}

/**
 * 提交列表的实时更新。两件事，一个定时器：
 * - 本页有「正在评分」的，3 秒拉一次，把结果原地换上；
 * - 第一页每 15 秒看一眼有没有新交的。**新的不直接插进来** —— 老师正看着第 5 行，
 *   上面突然塞进 3 行，选中的那行就跑了。顶上给一条「有 N 条新提交」，点了才换。
 * 页面切到后台就停。
 *
 * `requestSeq` 是列表那边的请求序号：拉的这期间筛选变了、翻页了，这份结果就作废。
 */
export function useListLive(options: {
  query: SubmissionQuery
  flowMode: Ref<boolean>
  rows: Ref<Row[]>
  submissions: Ref<SubmissionListItem[]>
  flowcharts: Ref<FlowchartSubmissionListItem[]>
  loading: Ref<boolean>
  loaded: Ref<boolean>
  fetchPage: () => Promise<{ results: Row[] }>
  requestSeq: () => number
}) {
  const { query, flowMode, rows, submissions, flowcharts } = options
  const newCount = ref(0)
  const newCountCapped = computed(() => newCount.value >= query.limit)
  let lastPoll = Date.now()
  const visibility = useDocumentVisibility()

  const hasPending = computed(() => rows.value.some(isPending))

  useIntervalFn(async () => {
    if (visibility.value !== 'visible' || options.loading.value || !options.loaded.value) return
    const interval = hasPending.value ? 3000 : 15000
    if (Date.now() - lastPoll < interval) return
    if (!hasPending.value && query.page !== 1) return
    lastPoll = Date.now()
    const seq = options.requestSeq()
    const mode = flowMode.value
    let res
    try {
      res = await options.fetchPage()
    } catch {
      return
    }
    // 这期间筛选变了、翻页了，这份结果就作废
    if (seq !== options.requestSeq() || mode !== flowMode.value) return
    const fresh = new Map<string, Row>(res.results.map((row) => [row.id, row]))
    if (mode) {
      flowcharts.value = flowcharts.value.map((row) => (fresh.get(row.id) as FlowchartSubmissionListItem | undefined) ?? row)
    } else {
      submissions.value = submissions.value.map((row) => (fresh.get(row.id) as SubmissionListItem | undefined) ?? row)
    }
    if (query.page === 1) {
      const current = new Set(rows.value.map((row) => row.id))
      const newest = rows.value[0]?.createTime ?? ''
      newCount.value = res.results.filter((row) => !current.has(row.id) && row.createTime > newest).length
    }
  }, 1000)

  /** 刚点了重新判题 / 重新评分：下一秒就拉，不等满 3 秒 */
  function pollSoon() {
    lastPoll = 0
  }

  return { newCount, newCountCapped, pollSoon }
}

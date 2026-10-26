import { reactive, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { DEFAULT_PERIOD } from 'oj/statistics/period'
import type { SubmissionQuery } from './listQuery'

/**
 * 提交列表和「统计」之间来回带条件：打开统计时带上列表现在的班级 / 学生 / 题号 /
 * 代码或流程图，统计里点「在提交列表里看」时把条件改回列表上。
 */
export function useStatsLink(options: {
  query: SubmissionQuery
  flowMode: Ref<boolean>
  statsPanel: Ref<boolean>
  /** 列表的「按整名只看一个人」，从统计回来时要放掉 */
  exactFor: Ref<string>
}) {
  const { query, flowMode, statsPanel } = options
  const router = useRouter()

  /**
   * 「统计」弹框的查询条件。每次打开从这张列表现在的班级 / 学生 / 题号 / 代码或流程图
   * 带进去（「今天」带过去就是统计的「今天」）；时间段沿用上次在弹框里选的
   */
  const statsQuery = reactive({
    tab: 'code',
    className: '',
    username: '',
    problem: '',
    period: DEFAULT_PERIOD as string,
    from: '',
    to: '',
  })

  /**
   * 老师的「统计」：带着这张列表现在的班级 / 学生 / 题号 / 代码或流程图打开。原来旁边还有一颗
   * 「今日统计」，和「数据统计」名字分不清（用户说的），老师那一版并进来了 —— 什么都没筛时
   * 打开就是「一行一节课」，选「今天」就是原来今日统计看的东西
   */
  function openStatistics() {
    Object.assign(statsQuery, {
      tab: flowMode.value ? 'flow' : 'code',
      className: query.className,
      username: query.username,
      problem: query.problem,
      ...(query.today === '1' ? { period: 'today' } : {}),
    })
    statsPanel.value = true
  }

  /** 手机上的「统计」：同样的条件，带去统计页 */
  function openStatisticsPage() {
    router.push({
      name: 'statistics',
      query: {
        tab: flowMode.value ? 'flow' : 'code',
        ...(query.className ? { className: query.className } : {}),
        ...(query.username ? { username: query.username } : {}),
        ...(query.problem ? { problem: query.problem } : {}),
        ...(query.today === '1' ? { period: 'today' } : {}),
      },
    })
  }

  /** 统计里的「在提交列表里看」：直接改背后这张列表的筛选，关掉弹框 */
  function listFromStatistics(next: Record<string, string>) {
    statsPanel.value = false
    options.exactFor.value = ''
    Object.assign(query, {
      username: next.username ?? '',
      className: next.className ?? '',
      result: '',
      myself: '0',
      problem: next.problem ?? '',
      language: next.language === 'Flowchart' ? 'Flowchart' : flowMode.value ? '' : query.language,
      today: next.today === '1' ? '1' : '0',
    })
  }

  return { statsQuery, openStatistics, openStatisticsPage, listFromStatistics }
}

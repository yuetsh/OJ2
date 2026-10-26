import { nextTick, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { filterEmptyValue } from 'utils/functions'

export interface PaginationQuery {
  page: number
  limit: number
  [key: string]: any
}

export interface UsePaginationOptions {
  /** 默认每页条数 */
  defaultLimit?: number
  /** 默认页码 */
  defaultPage?: number
  /** 当其他查询条件变化时是否重置页码 */
  resetPageOnChange?: boolean
  /**
   * 不归分页管、但同步地址时要带上的键。不给的话地址整个按 query 重写，别的键会被丢掉
   * （提交列表手机上点开一条是 `?id=`，翻一页详情就关了）
   */
  extraQuery?: () => Record<string, string>
  /** 返回 true 时同步地址一律 replace，不压历史（提交列表手机上开着详情时翻页） */
  replace?: () => boolean
}

/**
 * 分页相关的 composable，处理分页状态和 URL 同步
 * 每次调用创建新的分页状态实例
 * @param initialQuery 初始查询参数对象
 * @param options 配置选项
 */
export function usePagination<T extends Record<string, any>>(
  initialQuery: Omit<T, 'page' | 'limit'> = {} as Omit<T, 'page' | 'limit'>,
  options: UsePaginationOptions = {},
) {
  const { defaultLimit = 10, defaultPage = 1, resetPageOnChange = true, extraQuery, replace } = options

  const route = useRoute()
  const router = useRouter()

  // 从 URL 查询参数初始化状态
  const query = reactive({
    page: parseInt(<string>route.query.page) || defaultPage,
    limit: parseInt(<string>route.query.limit) || defaultLimit,
    ...initialQuery,
  }) as unknown as T & PaginationQuery
  // 键是运行时按 initialQuery 枚举出来的，静态类型写不出来；写入统一走这一个口子
  const writable = query as Record<string, unknown>

  /**
   * 正在从地址同步回来：这一拍里 query 的变化本来就是地址带来的，别再写回地址。
   * 写回去的话（浏览器后退到第 1 页，地址没写默认的 today=0，比一下「不一样」）会压一条
   * 新历史，把前进的那几条冲掉，返回键还得多按一次。
   * 页面自己盯着 route.query 补默认值的（提交列表）也在同一拍里，一起算
   */
  let syncing = false

  // 同步 URL 查询参数到本地状态
  function syncFromRoute() {
    syncing = true
    nextTick(() => (syncing = false))
    writable.page = parseInt(<string>route.query.page) || defaultPage
    writable.limit = parseInt(<string>route.query.limit) || defaultLimit

    // 同步其他查询参数
    Object.keys(initialQuery).forEach((key) => {
      const value = route.query[key]
      if (value === undefined) {
        // 地址里没有这一项（后退到不带筛选的地址、点顶栏回到列表）就是没筛，
        // 不能留着上一个地址的值：后退回 /problem 页面还停在上一个知识点。
        // 和 clearQuery 一样清成空值 —— initialQuery 是进页面时从地址读的，不一定是空的
        const initialValue = initialQuery[key]
        writable[key] = typeof initialValue === 'boolean' ? false : typeof initialValue === 'number' ? 0 : ''
      } else {
        // 处理不同类型的参数
        if (typeof initialQuery[key] === 'boolean') {
          writable[key] = value === '1' || value === 'true'
        } else if (typeof initialQuery[key] === 'number') {
          writable[key] = parseInt(<string>value) || initialQuery[key]
        } else {
          writable[key] = <string>value || initialQuery[key]
        }
      }
    })
  }

  // 更新 URL
  function updateRoute() {
    const newQuery = { ...filterEmptyValue(query), ...extraQuery?.() }
    // 和当前地址只差默认的 page / limit（后退到 /problem，同步完又补上 ?page=1&limit=30）：
    // 是同一个页面，用 replace，别多压一条历史、让人得多按一次后退
    const normalized = (q: Record<string, unknown>) =>
      JSON.stringify(
        Object.entries(q)
          .filter(([key, value]) => {
            if (key === 'page') return String(value) !== String(defaultPage)
            if (key === 'limit') return String(value) !== String(defaultLimit)
            return value != null && value !== ''
          })
          .map(([key, value]) => [key, String(value)])
          .sort(),
      )
    const navigate = replace?.() || normalized(route.query) === normalized(newQuery) ? router.replace : router.push
    navigate({
      path: route.path,
      query: newQuery,
    })
  }

  // 重置页码到第一页
  function resetPage() {
    writable.page = defaultPage
  }

  // 清空所有查询条件（除了分页参数）
  function clearQuery() {
    Object.keys(initialQuery).forEach((key) => {
      const initialValue = initialQuery[key]
      if (typeof initialValue === 'string') {
        writable[key] = ''
      } else if (typeof initialValue === 'boolean') {
        writable[key] = false
      } else if (typeof initialValue === 'number') {
        writable[key] = 0
      } else {
        writable[key] = initialValue
      }
    })
    resetPage()
  }

  // 监听页码变化，同步到 URL
  watch(
    () => query.page,
    () => {
      if (!syncing) updateRoute()
    },
  )

  // 监听每页条数变化，重置页码并同步到 URL
  watch(
    () => query.limit,
    () => {
      if (syncing) return
      if (resetPageOnChange) {
        resetPage()
      }
      updateRoute()
    },
  )

  // 监听其他查询条件变化，重置页码并同步到 URL
  if (resetPageOnChange && Object.keys(initialQuery).length > 0) {
    const otherQueryKeys = Object.keys(initialQuery)
    watch(
      () => otherQueryKeys.map((key) => query[key]),
      () => {
        if (syncing) return
        resetPage()
        updateRoute()
      },
      { deep: true },
    )
  }

  // 监听路由变化，同步到本地状态
  watch(
    () => route.query,
    () => {
      syncFromRoute()
    },
    { deep: true },
  )

  return {
    query,
    updateRoute,
    resetPage,
    clearQuery,
    syncFromRoute,
  }
}

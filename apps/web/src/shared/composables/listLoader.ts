import { ref } from 'vue'
import { createDiscreteApi } from 'naive-ui'
import { errorCode, errorMessage, GLOBALLY_HANDLED_CODES } from 'utils/api'

const { message } = createDiscreteApi(['message'])

/**
 * 列表页的取数：转圈、出错提示、旧请求晚回来不盖新结果。
 *
 * 原来后台列表各写各的 `const res = await getXxx(); rows.value = res.results`：
 * - 没有 try：接口 500 或断网时什么都不提示，表格停在旧数据上，老师以为筛选没生效；
 * - 没有请求序号：关键词防抖和翻页一交错，先发的那个晚回来，会把新结果盖掉；
 * - 没有 loading：慢的时候看不出是在加载还是就这么多。
 *
 * 用法是把请求包一层，其余照旧：
 *
 *   const res = await track(getContestList(offset, query.limit, query.keyword))
 *   if (!res) return
 *   contests.value = res.results
 *
 * 被后发的请求顶掉、或者出错（已经提示过）时 `track` 给 undefined，调用方直接 return。
 */
export function useListLoader() {
  const loading = ref(false)
  let seq = 0

  async function track<R>(request: Promise<R>): Promise<R | undefined> {
    const mine = ++seq
    loading.value = true
    try {
      const result = await request
      return mine === seq ? result : undefined
    } catch (error) {
      if (mine !== seq) return undefined
      // 登录过期、没权限这几种全局拦截器已经提示过了
      if (!GLOBALLY_HANDLED_CODES.includes(errorCode(error) ?? '')) message.error(errorMessage(error, '列表没加载出来，刷新一下再试'))
      return undefined
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  return { loading, track }
}

import { PROBLEM_TAG_MAX_LENGTH } from '@oj2/contract'
import { StorageSerializers, useLocalStorage, watchDebounced } from '@vueuse/core'
import type { WatchSource } from 'vue'
import { errorCode, errorMessage } from 'utils/api'
import { DIFFICULTY } from 'utils/constants'
import { unique } from 'utils/functions'

/**
 * 编程题（detail.vue）、SQL 题（SqlDetail.vue）两个出题页共用的零件。两页要填的东西几乎
 * 不重合，所以没合成一页（见 SqlDetail.vue 顶部），但这几样原来是逐字抄了两三份。
 */

/** 富文本编辑器清空之后留下的是一个空段落，不是空串 */
export const isBlankHtml = (html: string) => !html.trim() || html === '<p><br></p>'

export const difficultyOptions = (['Low', 'Mid', 'High'] as const).map((value) => ({
  label: DIFFICULTY[value],
  value,
}))

/** 出题页的「返回」：比赛题回这场比赛的题目列表，公开题回题库 */
export function problemListRoute(contestID: string | undefined) {
  return contestID ? { name: 'admin contest problem list', params: { contestID } } : { name: 'admin problem list' }
}

/** 保存失败给老师看的话。编号撞了是最常见的一种，单独说清楚 */
export function saveErrorText(err: unknown) {
  return errorCode(err) === 'display-id-exists' ? '显示编号重复了，换一个' : errorMessage(err)
}

/**
 * 下拉里新打的标签：去空格、去重。有超长的就返回它（调用方提示、这次改动不收），
 * 后端也卡这个长度，先在这儿拦省一次往返
 */
export function cleanTags(tags: string[]): { tags: string[] } | { tooLong: string } {
  const tooLong = tags.find((t) => t.length > PROBLEM_TAG_MAX_LENGTH)
  if (tooLong) return { tooLong }
  return { tags: unique(tags.map((t) => t.trim()).filter(Boolean)) }
}

export const tagTooLongText = (tag: string) => `标签最多 ${PROBLEM_TAG_MAX_LENGTH} 个字：${tag}`

/**
 * 新建页的草稿：改动停 0.8 秒存一次，什么都没填就清掉。编辑页不存 —— 原来编辑页也往
 * 同一个 key 里写，没保存就离开的话，那道题的 id 会跟着草稿漂到新建页。
 *
 * `enabled` 在页面数据摆好之前要返回 false，不然加载时那一下会把空表单存进去。
 */
export function useCreateDraft<T>(key: string, options: { source: WatchSource; enabled: () => boolean; empty: () => boolean; take: () => T }) {
  // 初值是 null 时 VueUse 推不出类型，会拿 String() 存成 "[object Object]"，得显式指定
  const draft = useLocalStorage<T | null>(key, null, { serializer: StorageSerializers.object })
  watchDebounced(
    options.source,
    () => {
      if (!options.enabled()) return
      draft.value = options.empty() ? null : options.take()
    },
    { debounce: 800, deep: true },
  )
  return draft
}

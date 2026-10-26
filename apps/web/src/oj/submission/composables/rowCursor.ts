import { computed, nextTick, ref, type Ref } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import type { Row, SubmissionQuery } from './listQuery'

/**
 * 提交列表的「选中与翻阅」：右栏跟着选中的那条走，↑ ↓ 换条，到了页头页尾自动翻页。
 *
 * 翻页是异步的：先记下「落地后停在哪一头」（pendingJump），新一页回来之后由列表调
 * `settleSelection()` 再选。
 */
export function useRowCursor(options: {
  rows: Ref<Row[]>
  total: Ref<number>
  query: SubmissionQuery
  loading: Ref<boolean>
  isMobile: Ref<boolean>
  isDesktop: Ref<boolean>
  /** 开着弹框时方向键不归列表 */
  keysBlocked: () => boolean
  /** 地址里带着的 ?id=（手机上开着详情时刷新、别人发来的链接） */
  wantedId: () => string
  /** 这一页上没有 ?id= 那一条：详情开不出来，让列表把它从地址上摘掉 */
  dropWanted: () => void
  /** 跨页落地后这一页一条能看的都没有 */
  onNothingToShow: () => void
}) {
  const { rows, total, query, loading, isMobile, isDesktop } = options

  const selectedId = ref('')
  const selectedRow = computed(() => rows.value.find((row) => row.id === selectedId.value) ?? null)

  /** 方向键只在能看的行之间走：跳到一条看不了的上面只会看到一把锁 */
  const navigable = computed(() => rows.value.filter((row) => row.showLink))
  const position = computed(() => {
    const index = navigable.value.findIndex((row) => row.id === selectedId.value)
    return index === -1 ? null : { index: index + 1, count: navigable.value.length }
  })

  // 翻页是异步的，先记下「落地后停在哪一头」，新一页回来再选
  let pendingJump: 'first' | 'last' | null = null

  /** 加载失败了别把「落地后停在哪一头」留给下一次不相干的加载 */
  function forgetJump() {
    pendingJump = null
  }

  function settleSelection() {
    const jump = pendingJump
    pendingJump = null
    const list = navigable.value
    if (jump) {
      const row = jump === 'first' ? list[0] : list[list.length - 1]
      if (row) {
        select(row.id)
        return
      }
      options.onNothingToShow()
    }
    // 地址里带着 ?id= 的（手机上开着详情时刷新、别人发来的链接）就停在那一条
    const wanted = options.wantedId()
    if (wanted && rows.value.some((row) => row.id === wanted)) {
      selectedId.value = wanted
      return
    }
    // 这一页上没有那一条：详情开不出来，把 ?id= 摘掉
    options.dropWanted()
    if (rows.value.some((row) => row.id === selectedId.value)) return
    // 手机上没有右栏，不用预先选一条
    if (isMobile.value) {
      selectedId.value = ''
      return
    }
    selectedId.value = (list[0] ?? rows.value[0])?.id ?? ''
  }

  function select(id: string) {
    selectedId.value = id
    nextTick(() => {
      document.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  }

  const maxPage = computed(() => Math.max(1, Math.ceil(total.value / query.limit)))

  function move(step: 1 | -1) {
    // 这一页一条能看的都没有（学生看全站时常见）：不翻页，不然按一下翻一页停不下来
    if (!navigable.value.length) return
    // 上一次跨页还没回来：按住 ↓ 或者在页尾连按两下，不然会整页跳过
    if (loading.value || pendingJump) return
    const all = rows.value
    const start = all.findIndex((row) => row.id === selectedId.value)
    for (let i = start + step; i >= 0 && i < all.length; i += step) {
      if (all[i]!.showLink) {
        select(all[i]!.id)
        return
      }
    }
    const page = query.page + step
    if (page < 1 || page > maxPage.value) return
    pendingJump = step > 0 ? 'first' : 'last'
    query.page = page
  }

  // 只用 ↑ ↓（用户定的，← → 不要）
  onKeyStroke(['ArrowUp', 'ArrowDown'], (e: KeyboardEvent) => {
    if (!isDesktop.value || options.keysBlocked()) return
    // 别的控件已经处理了这次按键（下拉框自己会开菜单、换选项）
    if (e.defaultPrevented) return
    const target = e.target as HTMLElement | null
    if (target) {
      // 「代码 / 流程图」「全部 / 我的」是单选框：点过之后焦点停在上面，浏览器默认会拿方向键
      // 切换选项 —— 老师想看下一条，结果模式被切了。单选框照常换条，下面的 preventDefault 挡掉切换
      const radio = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'radio'
      // 焦点在输入框、下拉框、弹框里时不抢方向键
      if (
        (!radio && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) ||
        target.isContentEditable ||
        target.closest('.n-base-selection, .n-base-select-menu, .n-dropdown-menu, .n-modal')
      ) {
        return
      }
    }
    if (!rows.value.length) return
    e.preventDefault()
    move(e.key === 'ArrowUp' ? -1 : 1)
  })

  return { selectedId, selectedRow, position, maxPage, select, move, settleSelection, forgetJump }
}

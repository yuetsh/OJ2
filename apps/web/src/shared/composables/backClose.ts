import type { MaybeRefOrGetter, Ref } from "vue"

/**
 * 手机上整屏（或大半屏）的弹框、抽屉：按返回键先关它，而不是退出整页。
 *
 * 学生在手机上看到一整屏的东西，下意识就按返回 —— 原来这一下直接退到了前一页（提交列表点开
 * 一条、再按返回，回到的是首页）。所以打开时往历史里压一条同地址的记录：
 * - 按返回：浏览器弹掉这一条，这里收到 popstate，把弹框关掉，页面原地不动；
 * - 点 × / 点遮罩关掉：自己 history.back() 把那条弹掉，不然要多按一次返回才退得出去。
 *
 * 压的是 history.state 的原样拷贝（vue-router 要的 position 等字段都在）。弹掉它时
 * **不能让 vue-router 看见**：它会当成一次同地址的跳转，route 对象换新，页面上盯着
 * route.query 的同步逻辑（usePagination）跟着跑一遍，又压一条历史，返回键就要多按一次。
 * 抢在它前面拦不住 —— window 上的 popstate 按注册顺序派发（捕获监听也不优先，实测过），
 * 路由的监听最早注册。所以记录压着的这段时间把 router.listening 整个关掉，弹掉以后再开：
 * 关着的只是「响应浏览器前进后退」这一项，弹框里点链接 router.push 照常走。
 *
 * 弹框开着时点了站内链接，路由守卫先把它拦下，等那条记录弹完再跳（back() 是异步的，
 * 先跳的话会把刚跳过去的那一条弹掉）。
 */
export function useBackClose(show: Ref<boolean>, enabled: MaybeRefOrGetter<boolean> = true) {
  const router = useRouter()
  /** 压了记录、还没弹掉（这段时间路由不听前进后退） */
  let pushed = false
  let afterPop: (() => void) | null = null

  watch(show, (open) => {
    if (open && !pushed && toValue(enabled)) {
      history.pushState(history.state, "")
      pushed = true
      router.listening = false
    } else if (!open && pushed) {
      // 点 × 关的：自己弹掉那条，路由照旧关着，等下面收到 popstate 再开
      history.back()
    }
  })

  useEventListener(window, "popstate", () => {
    if (!pushed) return
    pushed = false
    // 按了返回键的：只管关（watch 里看到 pushed 已经是 false，不会再 back）
    show.value = false
    router.listening = true
    const next = afterPop
    afterPop = null
    next?.()
  })

  // 弹框里点了链接要跳走（自学目录里选一课）：先关弹框、把压的那条退掉，再跳。
  // 直接跳的话新页面压在那条后面，回来时要多按一次返回，而且那一下路由不听（见上）
  const removeGuard = router.beforeEach((to) => {
    if (!pushed) return
    afterPop = () => void router.push(to.fullPath)
    show.value = false
    return false
  })

  // 弹框开着组件就没了：路由一定要开回来，不然整站的返回键都失灵
  onBeforeUnmount(() => {
    removeGuard()
    if (!pushed) return
    pushed = false
    router.listening = true
  })
}

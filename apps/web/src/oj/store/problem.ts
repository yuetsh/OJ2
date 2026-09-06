import { defineStore } from "pinia"
import type { LANGUAGE, Problem } from "utils/types"

export const useProblemStore = defineStore("problem", () => {
  const problem = ref<Problem | null>(null)
  const route = useRoute()

  /**
   * 本次会话里新增的失败提交数。**只是增量**，历史失败数看 `problem.myFailedCount`。
   *
   * 原来 failCount 就是这一个从 0 起数的 ref，于是「失败 3 次解锁 AI 提示」实际变成了
   * 「在当前这次页面会话里再失败 3 次」：刷新一下、从题单跳进跳出一次就清零，
   * 昨天在这题上撞了十次墙的学生今天进来照样看不到按钮。而后端的闸门数的是数据库里
   * 的历史失败数，两边根本不是一回事。
   */
  const sessionFailCount = ref(0)

  /**
   * 这道题一共失败了几次 = 服务端算好的历史值 + 本次会话的增量。
   * 和后端 `countFailedSubmissions` 同一个口径，所以按钮亮起来的时刻就是
   * `POST /ai/hint` 放行的时刻。
   *
   * 题目详情只在 problemID 变化时重新拉（见 oj/problem/detail.vue 的 init），
   * 而那时下面的 watch 已经把增量清零了，不会和新的 myFailedCount 叠加。
   */
  const failCount = computed(
    () => (problem.value?.myFailedCount ?? 0) + sessionFailCount.value,
  )

  const languages = computed<LANGUAGE[]>(() => {
    if (route.name === "problem" && problem.value?.allowFlowchart) {
      return ["Flowchart", ...problem.value?.languages]
    }
    return problem.value?.languages ?? []
  })

  function incrementFailCount() {
    sessionFailCount.value++
  }

  watch(
    () => problem.value?.id,
    () => {
      sessionFailCount.value = 0
    },
  )

  return {
    problem,
    failCount,
    languages,
    incrementFailCount,
  }
})

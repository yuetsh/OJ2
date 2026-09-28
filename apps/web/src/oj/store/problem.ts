import { defineStore } from "pinia"
import { useBreakpoints } from "shared/composables/breakpoints"
import type { LANGUAGE, ProblemDetail } from "utils/types"
import { problemEntryOf } from "oj/problem/composables/problemPageContext"
import { useCodeStore } from "oj/store/code"

export const useProblemStore = defineStore("problem", () => {
  const problem = ref<ProblemDetail | null>(null)
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
  const failCount = computed(() => (problem.value?.myFailedCount ?? 0) + sessionFailCount.value)

  const { isDesktop } = useBreakpoints()

  /**
   * 这道题能不能画流程图。比赛里不给（入口差异表）；题单里原来也不给，现在给了，画到 A/S
   * 算完成（设计文档第 3 节决定 4）。手机上不给：节点库是 HTML5 拖放，手机上拖不动。
   */
  const canDraw = computed(
    () => !!problem.value?.allowFlowchart && problemEntryOf(route) !== "contest" && isDesktop.value,
  )

  /**
   * 编辑器能切到的全部「语言」。流程图在内部仍是一门叫 Flowchart 的语言（提交、草稿、编辑器
   * 切换都按它分支），但界面上不再混在语言下拉里 —— 那是工具栏最左边的「写代码 / 画流程图」。
   */
  const languages = computed<LANGUAGE[]>(() => {
    const own = problem.value?.languages ?? []
    return canDraw.value ? ["Flowchart", ...own] : own
  })

  /** 语言下拉里的：真正的编程语言 */
  const codeLanguages = computed(() => languages.value.filter((it) => it !== "Flowchart"))

  /**
   * 请编辑器换语言，并读回那门语言的草稿（没有就是模板）。只有编辑器（ProblemEditor）知道
   * 草稿存在哪，所以这里只留一个请求，由它接住 —— 结果页签里的「照着它写代码」不在编辑器里。
   */
  const languageRequest = ref<LANGUAGE | null>(null)
  function switchLanguage(language: LANGUAGE) {
    languageRequest.value = language
  }

  /**
   * 这道题收不收当前语言，不收就退到学生习惯的那门、再退到它支持的第一种（SQL 题只有 "SQL"，硬编码的
   * Python 会被后端拒绝）。编辑器每次载入代码之前都要过一遍：草稿的键里带着语言，
   * 先载入再改语言，编辑器里摆的就是另一种语言的模板。
   */
  function supportedLanguage(current: LANGUAGE): LANGUAGE {
    if (languages.value.includes(current)) return current
    // 当前这门这道题不给，先回到学生习惯用的那门。current 是 Flowchart 时最要紧：
    // 在能画图的题上画着图换到不能画的题，直接取第一项会把偏好 C 的学生扔到 Python，
    // 而且 code store 的 watch 会把 Python 记成新的偏好
    const preferred = useCodeStore().preferredLanguage()
    if (preferred !== "Flowchart" && languages.value.includes(preferred)) return preferred
    // 兜底落在编程语言上：languages 的第一项可能是 Flowchart，不能默认把人扔到画布上
    return codeLanguages.value[0] ?? languages.value[0] ?? "Python"
  }

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
    canDraw,
    languages,
    codeLanguages,
    languageRequest,
    switchLanguage,
    supportedLanguage,
    incrementFailCount,
  }
})

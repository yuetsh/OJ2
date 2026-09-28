import { defineStore } from "pinia"
import { getClassActivity } from "oj/api"
import type { ClassActivity, ClassActivityProblem } from "utils/types"

/** 同一节课里来回换题不用每次都重拉；过了这么久再进题目页就重拉一次 */
const STALE_MS = 2 * 60 * 1000

/**
 * 「这节课的题」：首页「班里在做」那几道（老师在课堂看板布置的，或者从同班提交推断的）。
 *
 * 题目页有两处要用：顶部的课堂条（做完几道、每道的状态），和通过之后的「下一题」。
 * 原来「下一题」每次通过都自己拉一遍，现在两处读同一份，通过之后由判题那边
 * （SubmissionEffects）先把这道就地标成做完、再重拉一次。
 */
export const useLessonStore = defineStore("lesson", () => {
  const activity = ref<ClassActivity | null>(null)
  let loadedAt = 0
  let loading: Promise<void> | null = null

  /** 没拉过或者旧了才拉；force 用在刚通过一道题之后 */
  function load(force = false) {
    if (!force && activity.value && Date.now() - loadedAt < STALE_MS) return loading
    loading = getClassActivity()
      .then((res) => {
        activity.value = res
        loadedAt = Date.now()
      })
      // 拉不到就没有课堂条，不影响做题
      .catch(() => {})
      .finally(() => {
        loading = null
      })
    return loading
  }

  /** 刚通过：不等重拉，先把这道标成做完，课堂条上的「做完 N/M」马上加一 */
  function markAccepted(problemDisplayId: string) {
    const item = find(problemDisplayId)
    if (item) item.myStatus = "accepted"
  }

  function find(problemDisplayId: string): ClassActivityProblem | undefined {
    const id = problemDisplayId.toLowerCase()
    return activity.value?.problems.find((item) => item.problemDisplayId.toLowerCase() === id)
  }

  /** 这道题在不在这节课里；不在（学生在做别的）就没有课堂条、也没有「下一题」 */
  function includes(problemDisplayId: string) {
    return !!find(problemDisplayId)
  }

  /** 老师布置的叫「老师布置的题」，推断出来的叫「这节课的题」 */
  const label = computed(() =>
    activity.value?.source === "teacher" ? "老师布置的题" : "这节课的题",
  )

  return { activity, label, load, markAccepted, includes }
})

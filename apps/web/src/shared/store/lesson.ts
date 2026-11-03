import { LESSON_MODE_LABEL, type LessonMode } from '@oj2/contract'
import { defineStore } from 'pinia'
import { getClassActivity } from 'shared/api'
import { LANGUAGE_SHOW_VALUE } from 'utils/constants'
import type { ClassActivity, ClassActivityProblem } from 'utils/types'

/**
 * 学生这边这节课做什么：按每道题合起来的要求算（后端 todaySteps 把今天几节里同一道题的要求并在一起），
 * 不直接用 `mode` —— 那是今天最后布置的那一节的。先布置画流程图、再「用这几道题写代码」，
 * 最后一节是写代码，但还没画完的照样要画，标题只写「用 C语言做」就漏了画图。
 * 推断出来的课为 null
 */
export function activityMode(activity: ClassActivity | null | undefined): LessonMode | null {
  if (!activity?.mode) return null
  const draw = activity.problems.some((item) => item.draw !== null)
  const code = activity.problems.some((item) => item.code !== null)
  return draw && code ? 'both' : draw ? 'flowchart' : code ? 'code' : activity.mode
}

/** 同一节课里来回换题不用每次都重拉；过了这么久再进题目页就重拉一次 */
const STALE_MS = 2 * 60 * 1000

/**
 * 「这节课的题」：首页「班里在做」那几道（老师在课堂任务布置的，或者从同班提交推断的）。
 *
 * 题目页有两处要用：顶部的课堂条（做完几道、每道的状态），和通过之后的「下一题」。
 * 原来「下一题」每次通过都自己拉一遍，现在两处读同一份，通过之后由判题那边
 * （SubmissionEffects）先把这道就地标成做完、再重拉一次。
 */
export const useLessonStore = defineStore('lesson', () => {
  const activity = ref<ClassActivity | null>(null)
  let loadedAt = 0
  let loading: Promise<void> | null = null
  /**
   * 只认最后发出去的那次。进页面那次还在路上时学生就交对了：先就地标成做完、再强制重拉 ——
   * 先发的那次要是后到，会把「做完」盖回去，「下一题」又指回刚做完的这道
   */
  let sequence = 0

  /** 没拉过或者旧了才拉；force 用在刚通过一道题之后 */
  function load(force = false) {
    if (!force && activity.value && Date.now() - loadedAt < STALE_MS) return loading
    if (!force && loading) return loading
    const mine = ++sequence
    loading = getClassActivity()
      .then((res) => {
        if (mine !== sequence) return
        activity.value = res
        loadedAt = Date.now()
      })
      // 拉不到就没有课堂条，不影响做题
      .catch(() => {})
      .finally(() => {
        if (mine === sequence) loading = null
      })
    return loading
  }

  /**
   * 刚做对：不等重拉，先把这道标上，课堂条上的「做完 N/M」马上加一。`step` 是做对的哪一步：
   * 代码交对、还是流程图画到 A / S。老师布置的课要这道题画和写两步时，只做对一步还不算做完；
   * 推断出来的课不分步（draw / code 都是 null），哪样做对都算
   */
  function markAccepted(problemDisplayId: string, step: 'code' | 'draw') {
    const item = find(problemDisplayId)
    if (!item) return
    if (step === 'code' && item.code) item.code = 'accepted'
    if (step === 'draw' && item.draw) item.draw = 'accepted'
    const steps = [item.draw, item.code].filter((value) => value !== null)
    // 这节课不要这一步（只画流程图的课交对了代码）：不算
    if (steps.length && (step === 'code' ? !item.code : !item.draw)) return
    item.myStatus = steps.every((value) => value === 'accepted') ? 'accepted' : 'tried'
  }

  function find(problemDisplayId: string): ClassActivityProblem | undefined {
    const id = problemDisplayId.toLowerCase()
    return activity.value?.problems.find((item) => item.problemDisplayId.toLowerCase() === id)
  }

  /** 这道题在不在这节课里；不在（学生在做别的）就没有课堂条、也没有「下一题」 */
  function includes(problemDisplayId: string) {
    return !!find(problemDisplayId)
  }

  /**
   * 通过这道之后该去哪一道：按列表顺序排在这道**后面**、还没通过的第一道，后面都做完了
   * 再从头找 —— 学生常常跳着做，先做完了第 3 道再回头做第 1 道。当前这道本身不看它的
   * myStatus：重拉回来之前，它还是通过之前那一刻的状态。
   * 这道不在这节课里返回 null；在，但别的都做完了，next 为 null。
   */
  function nextAfter(problemDisplayId: string) {
    const list = activity.value?.problems ?? []
    const id = problemDisplayId.toLowerCase()
    const index = list.findIndex((item) => item.problemDisplayId.toLowerCase() === id)
    if (index < 0) return null
    const rest = [...list.slice(index + 1), ...list.slice(0, index)].filter((item) => item.myStatus !== 'accepted')
    return { total: list.length, next: rest[0] ?? null, remaining: rest.length }
  }

  /**
   * 老师布置时选的做法，给界面写「画流程图」「先画再写 · C语言」「C语言」；没选（推断出来的课、
   * 以前布置的）为空。写代码是默认的，不写出来
   */
  const languageText = computed(() => {
    const mode = activityMode(activity.value)
    const language = mode === 'flowchart' ? null : activity.value?.language
    return [mode && mode !== 'code' ? LESSON_MODE_LABEL[mode] : '', language ? LANGUAGE_SHOW_VALUE[language] : ''].filter(Boolean).join(' · ')
  })

  /** 老师布置的叫「老师布置的题」（选了语言带上语言），推断出来的叫「这节课的题」 */
  const label = computed(() => (activity.value?.source === 'teacher' ? `老师布置的题${languageText.value ? ` · ${languageText.value}` : ''}` : '这节课的题'))

  return { activity, label, languageText, load, markAccepted, find, includes, nextAfter }
})

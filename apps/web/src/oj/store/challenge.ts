import { defineStore } from "pinia"
import type { ProblemChallengeGroup } from "@oj2/contract"
import { getChallenges } from "oj/api"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"
import { useBreakpoints } from "shared/composables/breakpoints"

/**
 * 挑战：做对之后，同一道题加一条写法上的限制再做一遍（契约 challengeSchema）。
 *
 * 正在挑战哪一条记在路由的 `?challenge=<id>` 上：「去挑战」常常是去另一道题（这节课的
 * 别的题），带着 query 跳过去最直接；刷新、返回也还在挑战里。
 *
 * 这里只管当前这道题的挑战（编辑器顶上那条、结果里的成没成）。课堂条「这节课都做完了」
 * 那几道题的列表由 ChallengeList 自己拉。
 */
export const useChallengeStore = defineStore("challenge", () => {
  const route = useRoute()
  const router = useRouter()
  const problemStore = useProblemStore()
  const codeStore = useCodeStore()
  const { isMobile } = useBreakpoints()

  const activeId = computed(() =>
    typeof route.query.challenge === "string" ? route.query.challenge : "",
  )

  /**
   * 进挑战那一刻结果页签里挂着的那次提交。它是进挑战之前那次做对的，也判过挑战（没做到），
   * 不能拿它说「挑战还差一点」—— 只认之后交的。不用时刻比：机房电脑的钟不一定准
   */
  const submissionStore = useSubmissionStore()
  const baselineSubmissionId = ref<string | null>(null)
  watch(
    activeId,
    (id) => {
      if (id) baselineSubmissionId.value = submissionStore.submission?.id ?? null
    },
    { immediate: true },
  )

  /** 当前这道题、编辑器当前语言下的挑战；没配挑战为 null */
  const current = ref<ProblemChallengeGroup | null>(null)
  let sequence = 0
  async function load() {
    const problemId = problemStore.problem?._id
    const language = codeStore.code.language
    const mine = ++sequence
    if (!problemId || language === "Flowchart" || problemStore.problem?.contestId != null) {
      current.value = null
      return
    }
    try {
      const [group] = await getChallenges([problemId], language)
      if (mine === sequence) current.value = group ?? null
    } catch {
      // 拉不到就没有挑战，不影响做题
      if (mine === sequence) current.value = null
    }
  }
  watch([() => problemStore.problem?._id, () => codeStore.code.language], load, {
    immediate: true,
  })

  /** 正在挑战的那条（换了语言、挑战被老师删了就是 null） */
  const active = computed(
    () => current.value?.challenges.find((item) => item.id === activeId.value) ?? null,
  )

  function start(problemId: string, challengeId: string) {
    // 进挑战先看题和代码：手机上编辑器是单独一个页签
    const tab = isMobile.value ? "editor" : "content"
    void router.push({
      name: "problem",
      params: { problemID: problemId },
      query: { challenge: challengeId, tab },
    })
  }

  function stop() {
    const { challenge: _, ...rest } = route.query
    void router.replace({ query: rest })
  }

  return { activeId, active, current, baselineSubmissionId, load, start, stop }
})

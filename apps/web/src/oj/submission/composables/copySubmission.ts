import { LANGUAGE_FORMAT_VALUE } from "utils/constants"
import { compressToBase64 } from "utils/functions"
import type { Submission } from "utils/types"
import { useCodeStore } from "oj/store/code"
import storage from "utils/storage"

/**
 * 「复制到自测猫」「复制回到题目」。提交列表的右栏和独立的 /submission/:id 页面共用。
 */
export function useCopySubmission() {
  const route = useRoute()
  const router = useRouter()
  const codeStore = useCodeStore()

  function copyToCat(submission: Submission) {
    const data = {
      lang: LANGUAGE_FORMAT_VALUE[submission.language],
      code: submission.code,
      input: "",
    }
    const base64 = compressToBase64(JSON.stringify(data))
    const url = `${import.meta.env.PUBLIC_CODE_URL}?share=${encodeURIComponent(base64)}`
    window.open(url, "_blank")
  }

  /**
   * 编辑器的 storageKey 用 display id（problem._id），不是 submission.problemId
   * （内部数字 id）。**不能只靠调用方传的题号** —— 独立的 /submission/:id 路由
   * 只有提交 id，原来会一路带进 router.push 抛 `Missing required param "problemID"`。
   * 响应里的 problemDisplayId 就是干这个的。
   *
   * 比赛提交的 contestId 只下发给管理员；学生在比赛里复制，靠的是当前路由上的比赛 id。
   */
  function copyToProblem(submission: Submission) {
    const { code, language } = submission
    const problemID = submission.problemDisplayId
    const contestId =
      submission.contestId ?? (route.params.contestID ? Number(route.params.contestID) : null)
    const storageKey = `problem_${problemID}_contest_${contestId || null}_lang_${language}`
    storage.set(storageKey, code)
    // 设置语言 + 代码：localStorage 覆盖全新挂载的编辑器，
    // setCode 覆盖已挂载（同页 modal）的编辑器
    codeStore.setLanguage(language)
    codeStore.setCode(code)

    const problemSetId = (route.params.problemSetId as string) ?? ""
    if (contestId) {
      router.push({
        name: "contest problem",
        params: { contestID: String(contestId), problemID },
      })
    } else if (problemSetId) {
      router.push({ name: "problemset problem", params: { problemSetId, problemID } })
    } else {
      router.push({ name: "problem", params: { problemID } })
    }
  }

  return { copyToCat, copyToProblem }
}

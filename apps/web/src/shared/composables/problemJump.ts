import { getProblemList } from "oj/api"

/**
 * 按题号直达。课上老师报一个题号、全班去找，是非比赛提交最主要的来路，
 * 所以敲完题号回车就该进题，而不是先落到列表再点一下。
 *
 * 题号对上了（不分大小写）才直达；对不上、或者敲的是题目名，就去列表搜 ——
 * 列表那边的 keyword 是题号和标题一起模糊匹配，这里只是在它前面加了一步。
 */
export function useProblemJump() {
  const router = useRouter()
  const jumping = ref(false)

  async function jump(input: string) {
    const keyword = input.trim()
    if (!keyword) return router.push("/problem")
    jumping.value = true
    // 查询失败就当没对上，照样去列表搜，别让一次网络抖动把回车吞掉
    const res = await getProblemList(0, 20, { keyword }).catch(() => null)
    jumping.value = false
    const exact = res?.results.find((row) => row._id.toLowerCase() === keyword.toLowerCase())
    if (exact) return router.push(`/problem/${exact._id}`)
    return router.push({ path: "/problem", query: { keyword } })
  }

  return { jump, jumping }
}

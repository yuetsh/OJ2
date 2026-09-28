import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"

/**
 * 这道题、这门语言的本地代码草稿存在哪个键下。编辑器（存、读草稿）和「重置代码」
 * （删草稿）都用这一份 —— 原来键在编辑器里拼、再作为 prop 传给工具栏，手机上「重置」
 * 挪进页签行的「⋯」之后就够不着了，再拼一份迟早和编辑器那份对不上。
 *
 * 题单入口单独一份：原来题库和题单共用 `problem_题号_contest_null_语言`，加入题单之前
 * 在题库里写对的代码，一进题单就摆在编辑器里（设计文档第 11 节 4）。
 * **键的最后一段必须是语言**，编辑器换语言时靠它判断草稿是不是这门语言的。
 */
export function useDraftKey() {
  const route = useRoute()
  const codeStore = useCodeStore()
  const problemStore = useProblemStore()
  return computed(() => {
    const id = problemStore.problem?._id
    if (!id) return ""
    const language = codeStore.code.language
    const problemSetId = route.params.problemSetId
    if (problemSetId) return `problem_${id}_problemset_${problemSetId}_lang_${language}`
    return `problem_${id}_contest_${route.params.contestID || null}_lang_${language}`
  })
}

import { storeToRefs } from "pinia"
import type { Ref } from "vue"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import { LANGUAGE_FORMAT_VALUE, SOURCES } from "utils/constants"
import { compressToBase64, copyToClipboard } from "utils/functions"
import storage from "utils/storage"
import { useDraftKey } from "./draftKey"
import { useTeacherCollab } from "./teacherCollab"

/**
 * 「课堂统计」弹窗开着没有。弹窗挂在题目页上（StatisticsModal），菜单可能在工具栏里、
 * 也可能在手机页签行的「⋯」里，所以这个开关放在模块级，大家共用一个
 */
export const statisticsOpen = ref(false)

/**
 * 编辑器的「更多」菜单：去自测猫 / 复制代码 / 重置代码 / 编辑题目，放不下时再加上课堂统计。
 *
 * 桌面在工具栏的「更多」里，手机在页签行的「⋯」里（设计文档 5.6）。原来这些全写在
 * 工具栏组件里，手机上只能先切到「代码」页签再点「更多」。
 *
 * `statisticsInline`：「课堂统计」是否常驻在工具栏上（桌面、而且放得下）；不常驻就收进菜单
 */
export function useEditorMenu(statisticsInline: Ref<boolean>) {
  const message = useMessage()
  const dialog = useDialog()
  const router = useRouter()
  const userStore = useUserStore()
  const codeStore = useCodeStore()
  const { problem } = storeToRefs(useProblemStore())
  const { isDesktop } = useBreakpoints()
  const teacherCollab = useTeacherCollab()
  const draftKey = useDraftKey()

  const options = computed<DropdownOption[]>(() => {
    const items: DropdownOption[] = []
    // 「本题提交」挪到了「我的提交」抽屉的底部
    if (!statisticsInline.value && userStore.isTeacherOrAbove) {
      items.push({ label: "课堂统计", key: "statistics" })
    }
    if (codeStore.code.language !== "Flowchart") {
      if (codeStore.code.language !== "SQL") items.push({ label: "去自测猫", key: "testcat" })
      items.push({ label: "复制代码", key: "copy" })
      // 协作中的教师不给「重置代码」：那会儿编辑器里是**学生的**代码，而 v-model
      // 一写回去就顺着 Yjs 同步过去，等于一键清空学生的作业，他还没法撤回
      if (!teacherCollab.value) items.push({ label: "重置代码", key: "reset" })
    }
    if (isDesktop.value && userStore.isSuperAdmin) items.push({ label: "编辑题目", key: "edit" })
    return items
  })

  async function copy() {
    const success = await copyToClipboard(codeStore.code.value)
    message[success ? "success" : "error"](`代码复制${success ? "成功" : "失败"}`)
  }

  // 重置会把编辑器里的代码换成模板、连本地草稿一起删掉，点错一下写了半节课的代码就没了，先问一句
  function reset() {
    dialog.warning({
      title: "重置代码",
      content: "编辑器里的代码会换回题目给的模板，存着的草稿也会删掉。确定吗？",
      positiveText: "重置",
      negativeText: "再想想",
      onPositiveClick: () => {
        const language = codeStore.code.language
        codeStore.setCode(problem.value!.template[language] || SOURCES[language])
        storage.remove(draftKey.value)
        message.success("已换回模板，按 Ctrl+Z 可以撤回")
      },
    })
  }

  function goTestCat() {
    const data = {
      lang: LANGUAGE_FORMAT_VALUE[codeStore.code.language],
      code: codeStore.code.value,
      // 没有例子的题原来在这里抛 TypeError，点了没反应
      input: problem.value?.samples[0]?.input ?? "",
    }
    const base64 = compressToBase64(JSON.stringify(data))
    window.open(`${import.meta.env.PUBLIC_CODE_URL}?share=${encodeURIComponent(base64)}`, "_blank")
  }

  function goEdit() {
    const p = problem.value!
    const url = p.contestId
      ? `/admin/contest/${p.contestId}/problem/edit/${p.id}`
      : `/admin/problem/edit/${p.id}`
    window.open(router.resolve(url).href, "_blank")
  }

  /** 菜单项被点了；不是这张菜单里的 key 返回 false，调用方自己处理（页签行的抽屉） */
  function select(key: string) {
    switch (key) {
      case "statistics":
        statisticsOpen.value = true
        return true
      case "testcat":
        goTestCat()
        return true
      case "copy":
        copy()
        return true
      case "reset":
        reset()
        return true
      case "edit":
        goEdit()
        return true
    }
    return false
  }

  return { options, select }
}

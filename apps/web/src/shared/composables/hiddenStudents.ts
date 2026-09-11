import { onMounted, ref } from "vue"

/**
 * 统计面板的「暂时隐藏某个学生」。
 *
 * 老师是把面板投在屏幕上盯着看的，未完成名单里总有那么几个是请假/转班/学号错了的，
 * 一直挂在上面会盖住真正需要盯的人。隐藏是**带过期时间**的（两小时，够一节课），
 * 不是永久删除 —— 下节课自动回来，免得有人被无声地漏掉。
 *
 * 存在 localStorage 而不是后端：这是「这台电脑上这位老师这节课不想看谁」，
 * 换个人、换台机器都不该继承。
 *
 * 原来这套（loadHidden / saveHidden / hideStudent / showAll / 过期清理）在
 * StatisticsPanel.vue 和 FlowchartStatisticsPanel.vue 里各写了一遍，除了存储键
 * 和一个参数名逐字相同；判断「有没有被隐藏」两边还各自内联了三处。
 *
 * @param storageKey localStorage 的键。**两个面板各用各的** —— 提交统计里隐掉的人
 *   不该连带在流程图统计里也消失，那是两件事。
 */
export function useHiddenStudents(storageKey: string) {
  /** 隐藏时长：两小时，一节课的量级 */
  const HIDE_DURATION = 2 * 60 * 60 * 1000

  function load(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}")
    } catch {
      return {}
    }
  }

  const hiddenStudents = ref<Record<string, number>>(load())
  /** 面板上的「隐藏模式」开关：打开后每行才出现那个隐藏按钮 */
  const hideMode = ref(false)

  function save(data: Record<string, number>) {
    localStorage.setItem(storageKey, JSON.stringify(data))
  }

  function hideStudent(username: string) {
    hiddenStudents.value = {
      ...hiddenStudents.value,
      [username]: Date.now() + HIDE_DURATION,
    }
    save(hiddenStudents.value)
  }

  function showAll() {
    hiddenStudents.value = {}
    save({})
  }

  function isHidden(username: string) {
    const expiresAt = hiddenStudents.value[username]
    return !!expiresAt && expiresAt > Date.now()
  }

  /** 给 filter 用：`list.filter(notHidden)` */
  function notHidden(item: { username: string }) {
    return !isHidden(item.username)
  }

  onMounted(() => {
    // 把已经到期的清掉再落一次盘，否则这张表只增不减
    const now = Date.now()
    const cleaned = Object.fromEntries(
      Object.entries(hiddenStudents.value).filter(([, expiresAt]) => expiresAt > now),
    )
    hiddenStudents.value = cleaned
    save(cleaned)
  })

  // 不导出 hiddenStudents 本身：两个面板要的都是「这个人该不该显示」，
  // 把那张表递出去只会让判断逻辑又散回各自的组件里
  return { hideMode, hideStudent, showAll, isHidden, notHidden }
}

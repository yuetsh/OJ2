import { onMounted, ref } from "vue"

/**
 * 课堂看板的「请假隐藏」：暂时把某个学生从「今天还没交过」里藏起来。
 *
 * 老师是把看板投在屏幕上盯着看的，没交名单里总有那么几个是请假/转班/学号错了的，
 * 一直挂在上面会盖住真正需要盯的人。隐藏是**带过期时间**的（两小时，够一节课），
 * 不是永久删除 —— 下节课自动回来，免得有人被无声地漏掉。
 *
 * 存在 localStorage 而不是后端：这是「这台电脑上这位老师这节课不想看谁」，
 * 换个人、换台机器都不该继承。
 *
 * 原来在提交统计、流程图统计两个弹框里；统计改成回头看的页面之后（2026-09），
 * 课上盯人的事归看板，这个也挪了过来。
 *
 * @param storageKey localStorage 的键
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
  /** 「请假隐藏」开关：打开后名字旁边才出现那个 × */
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

  /** 恢复这几个人。只恢复看板上这个班的，别把别的班藏着的人一起放出来 */
  function unhide(usernames: string[]) {
    const drop = new Set(usernames)
    hiddenStudents.value = Object.fromEntries(
      Object.entries(hiddenStudents.value).filter(([name]) => !drop.has(name)),
    )
    save(hiddenStudents.value)
  }

  function isHidden(username: string) {
    const expiresAt = hiddenStudents.value[username]
    return !!expiresAt && expiresAt > Date.now()
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

  // 不导出 hiddenStudents 本身：用的地方要的是「这个人该不该显示」，
  // 把那张表递出去只会让判断逻辑又散回组件里
  return { hideMode, hideStudent, unhide, isHidden }
}

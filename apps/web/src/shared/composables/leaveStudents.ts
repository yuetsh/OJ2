import { onMounted, ref } from "vue"
import { parseTime } from "utils/functions"

/**
 * 课堂看板的「请假」：老师手动标记今天不在的学生，看板的人数、进度、「还没交过」都不算他们。
 *
 * **今天有效**（按东八区的日子），第二天自动清掉 —— 请假一般是请一整天，原来按两小时算，
 * 连上两节课的第二节中途人又冒出来，得重标一遍。
 *
 * 存在 localStorage 而不是后端：这是「这台电脑上这位老师今天不想算谁」，
 * 换个人、换台机器都不该继承（2026-10 用户定的，不上服务器）。
 *
 * 原来叫「请假隐藏」（开关 → 名字变成带 × 的标签 → 点 ×），用户说不会用，2026-10 改成
 * 看板上一个「请假」按钮勾名单。旧键 `oj_hidden_students` 存的是两小时的过期时刻，
 * 口径不同，不迁移，直接删掉。
 *
 * @param storageKey localStorage 的键
 */
export function useLeaveStudents(storageKey: string) {
  /** 用户名 → 标记的那一天（YYYY-MM-DD，东八区） */
  type Marks = Record<string, string>

  function today() {
    return parseTime(new Date(), "YYYY-MM-DD")
  }

  function load(): Marks {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}")
    } catch {
      return {}
    }
  }

  function save(data: Marks) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch {
      // 存不下就只在这次打开里有效，不影响看板
    }
  }

  const marks = ref<Marks>(load())

  function onLeave(username: string) {
    return marks.value[username] === today()
  }

  /**
   * 把 `usernames` 这批人的标记换成 `selected`：在里面但没选的取消，选了的标上。
   * 只动这一批（看板上这个班），别的班标着的人不受影响
   */
  function setLeave(usernames: string[], selected: string[]) {
    const scope = new Set(usernames)
    const day = today()
    const next = Object.fromEntries(
      Object.entries(marks.value).filter(([name]) => !scope.has(name)),
    )
    for (const name of selected) next[name] = day
    marks.value = next
    save(next)
  }

  function cancelLeave(usernames: string[]) {
    setLeave(usernames, [])
  }

  onMounted(() => {
    try {
      localStorage.removeItem("oj_hidden_students")
    } catch {
      // 读写不了 localStorage 的环境，没什么可清的
    }
    // 把不是今天的清掉再落一次盘，否则这张表只增不减
    const day = today()
    const cleaned = Object.fromEntries(
      Object.entries(marks.value).filter(([, marked]) => marked === day),
    )
    marks.value = cleaned
    save(cleaned)
  })

  return { onLeave, setLeave, cancelLeave }
}

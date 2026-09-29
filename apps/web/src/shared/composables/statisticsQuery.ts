import { reactive } from "vue"
import { PANEL_DURATION_OPTIONS } from "utils/constants"
import storage from "utils/storage"

/**
 * 统计面板的查询条件（班级/用户、题号、时间段），**记一小时**：一小时内再打开，
 * 框里是上次查的那一组。
 *
 * 老师一节课里会反复开关这个弹窗（看一眼、关掉、走下去辅导、回来再开），每次都从空的
 * 选班级、敲题号很烦。但也不能一直记着 —— 曾经把上次的班级永久写进 localStorage，
 * 下课换了班、或者换个人坐这台机器，上一个人查的班悄悄留在框里，老师没注意就按了
 * 「统计」，看到的整个是别人的班。一小时是折中：一节课够用，隔一节课就自己清掉。
 * 注意**连堂**时下一节仍在一小时内，框里会是上一个班，这一点是接受了的。
 *
 * 一小时从「最后一次查询」算起（调用方在每次查完后调 `save`，自动刷新也算），
 * 开着面板盯一整节课不会中途过期。
 *
 * 调用方传进来的初值优先：题目页固定是这道题、提交列表带着自己的筛选条件，
 * 那是比缓存更明确的上下文；为空的那几项才用缓存补上。
 * 登录框那份 LOGIN_CLASS 是另一回事：那记的是这台机器的身份，不是一次临时查询。
 *
 * @param storageKey localStorage 的键。**两个面板各用各的** —— 流程图题和代码题的
 *   题号不是一批，互相带过去只会查出一片空。
 */
export function useStatisticsQuery(
  storageKey: string,
  initial: { username: string; problem: string },
) {
  const TTL = 60 * 60 * 1000

  type Cached = { username: string; problem: string; duration: string; savedAt: number }

  function load(): Partial<Cached> {
    try {
      const cached: Cached | null = storage.get(storageKey)
      if (!cached || Date.now() - cached.savedAt > TTL) return {}
      return cached
    } catch {
      return {}
    }
  }

  const cached = load()

  const query = reactive({
    username: initial.username || cached.username || "",
    problem: initial.problem || cached.problem || "",
    // 选项表改过之后旧缓存里的值可能已经不在里面了，认不出来就回到第一档
    duration: PANEL_DURATION_OPTIONS.some((option) => option.value === cached.duration)
      ? cached.duration!
      : PANEL_DURATION_OPTIONS[0].value,
  })

  function save() {
    storage.set(storageKey, {
      // 选择框点了清除是 null，不是空串
      username: query.username ?? "",
      problem: query.problem ?? "",
      duration: query.duration,
      savedAt: Date.now(),
    } satisfies Cached)
  }

  return { query, save }
}

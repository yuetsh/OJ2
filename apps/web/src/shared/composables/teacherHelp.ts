import { useCollabStore } from "shared/store/collab"

/**
 * 老师接单 / 主动打开学生的编辑器。两处入口（顶栏举手面板、课堂看板）共用。
 *
 * 只发消息，不跳页面：房间开好（room_open 到了）才跳到那道题，跳转统一在 CollabHost 里做
 * —— 原来是点完就跳，服务端拒了（别的老师先接走、学生刚走）前端也已经跳过去了。
 *
 * 一个老师同时只在一个房间（服务端也拦）。这里先拦一道：不拦的话等新房间开好跳过去，
 * 等于把手上这场协作断掉。返回 false = 没发出去
 */
export function useTeacherHelp() {
  const collabStore = useCollabStore()
  const message = useMessage()

  function busy() {
    if (!collabStore.room) return false
    message.warning("请先结束当前协作")
    return true
  }

  return {
    help(studentId: number) {
      if (busy()) return false
      collabStore.accept(studentId)
      return true
    },
    peek(studentId: number) {
      if (busy()) return false
      collabStore.peek(studentId)
      return true
    },
  }
}

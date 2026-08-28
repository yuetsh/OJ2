import {
  CollabWebSocket,
  type CollabMessage,
  type CollabRequestItem,
} from "shared/composables/websocket"
import { useUserStore } from "shared/store/user"

export type HelpStatus = "idle" | "pending" | "active"

export interface RoomInfo {
  peerName: string
  peerRole: "student" | "teacher"
  problemId: string
}

/**
 * 课堂求助的全局状态。
 *
 * 连接是**全局常驻**的，不跟着题目页起落 —— 老师可能正在后台改题时收到求助，
 * 学生也需要在等待期间一直挂着。所以这里不用 onUnmounted，由 App.vue 按登录态开关。
 */
export const useCollabStore = defineStore("collab", () => {
  const userStore = useUserStore()

  const ws = new CollabWebSocket()

  /** 老师端：待处理列表 */
  const requests = ref<CollabRequestItem[]>([])
  /** 学生端：自己的求助状态 */
  const helpStatus = ref<HelpStatus>("idle")
  const queueAhead = ref(0)
  const teacherName = ref("")
  /** 双方：当前房间。null 表示不在协作中 */
  const room = ref<RoomInfo | null>(null)
  /** 一次性提示，由组件消费后清空 */
  const notice = ref("")

  const pendingCount = computed(
    () => requests.value.filter((it) => it.status === "pending").length,
  )

  /** 按题目聚合，同题多人时老师能一眼看出该停下来全班讲 */
  const groupedRequests = computed(() => {
    const groups = new Map<string, { problemId: string; problemTitle: string; items: CollabRequestItem[] }>()
    for (const item of requests.value) {
      const group = groups.get(item.problemId)
      if (group) group.items.push(item)
      else
        groups.set(item.problemId, {
          problemId: item.problemId,
          problemTitle: item.problemTitle,
          items: [item],
        })
    }
    // 人多的题排前面；人数相同按最久等待排
    return Array.from(groups.values()).sort(
      (a, b) =>
        b.items.length - a.items.length ||
        a.items[0].createdAt - b.items[0].createdAt,
    )
  })

  const handleMessage = (data: CollabMessage) => {
    switch (data.type) {
      case "requests":
        requests.value = (data.list ?? []) as CollabRequestItem[]
        return
      case "help_status":
        if (data.status === "pending") {
          helpStatus.value = "pending"
          queueAhead.value = Number(data.queueAhead ?? 0)
        } else if (data.status === "active") {
          helpStatus.value = "active"
          teacherName.value = String(data.teacherName ?? "")
        } else if (data.status === "cancelled") {
          helpStatus.value = "idle"
          notice.value = "老师已取消你的求助"
        } else if (data.status === "no_teacher") {
          helpStatus.value = "idle"
          notice.value = "当前没有老师在线"
        }
        return
      case "room_open":
        room.value = {
          peerName: String(data.peer?.name ?? ""),
          peerRole: data.peer?.role === "teacher" ? "teacher" : "student",
          problemId: String(data.problemId ?? ""),
        }
        return
      case "room_closed":
        room.value = null
        // 老师掉线时服务端会另发一条 help_status:pending，这里不抢着改学生状态
        if (data.reason === "done") helpStatus.value = "idle"
        notice.value =
          data.reason === "peer_offline" ? "对方已断开连接" : "协作已结束"
        return
      case "error":
        notice.value = String(data.message ?? "")
        return
    }
  }

  ws.addHandler(handleMessage)

  function connect() {
    ws.connect()
  }

  function disconnect() {
    ws.disconnect()
    requests.value = []
    helpStatus.value = "idle"
    room.value = null
  }

  function requestHelp(problemId: string) {
    ws.send({ type: "help_request", problemId })
  }

  function cancelHelp() {
    ws.send({ type: "help_cancel" })
    helpStatus.value = "idle"
  }

  function accept(studentId: number) {
    ws.send({ type: "accept", studentId })
  }

  function reject(studentId: number) {
    ws.send({ type: "reject", studentId })
  }

  function leave() {
    ws.send({ type: "leave" })
  }

  function sendBinary(data: Uint8Array) {
    ws.sendRaw(data)
  }

  function setBinaryHandler(handler: ((data: ArrayBuffer) => void) | null) {
    ws.setBinaryHandler(handler)
  }

  function consumeNotice() {
    const value = notice.value
    notice.value = ""
    return value
  }

  return {
    requests,
    pendingCount,
    groupedRequests,
    helpStatus,
    queueAhead,
    teacherName,
    room,
    notice,
    isTeacher: computed(() => userStore.isTeacherOrAbove),
    connect,
    disconnect,
    requestHelp,
    cancelHelp,
    accept,
    reject,
    leave,
    sendBinary,
    setBinaryHandler,
    consumeNotice,
  }
})

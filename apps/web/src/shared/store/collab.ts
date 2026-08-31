import {
  CollabWebSocket,
  type CollabMessage,
  type CollabRequestItem,
} from "shared/composables/websocket"
import { useUserStore } from "shared/store/user"
import type { LANGUAGE } from "utils/types"

export type HelpStatus = "idle" | "pending" | "active"

export interface RoomInfo {
  peerName: string
  peerRole: "student" | "teacher"
  problemId: string
  /** 学生编辑器的语言。教师端的弹框按它选高亮和补全 */
  language: LANGUAGE
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
  /** 一次性提示，由 CollabHost 统一消费后清空 */
  const notice = ref("")
  /**
   * 求助列表弹框开着没有。放在 store 里而不是组件内部：打开它的入口（顶栏的
   * 姓名下拉、新求助 toast）和弹框本身已经不在同一棵子树里了。
   */
  const helpPanelOpen = ref(false)
  /**
   * 提示序号，每次设置都自增。
   *
   * 消费方 watch 的是这个，不是 notice 本身：连着两次同样的文案（老师取消了
   * 求助、学生又求助、又被取消）在 Vue 眼里 `===` 相等，watch(notice) 不会
   * 第二次触发，第二条提示就这么没了。
   */
  const noticeSeq = ref(0)

  function setNotice(text: string) {
    notice.value = text
    noticeSeq.value += 1
  }

  const pendingCount = computed(
    () => requests.value.filter((it) => it.status === "pending").length,
  )

  /** 按题目聚合，同题多人时老师能一眼看出该停下来全班讲 */
  const groupedRequests = computed(() => {
    const groups = new Map<
      string,
      { problemId: string; problemTitle: string; items: CollabRequestItem[] }
    >()
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
          setNotice("老师已取消你的求助")
        } else if (data.status === "no_teacher") {
          helpStatus.value = "idle"
          setNotice("当前没有老师在线")
        }
        return
      case "room_open":
        room.value = {
          peerName: String(data.peer?.name ?? ""),
          peerRole: data.peer?.role === "teacher" ? "teacher" : "student",
          problemId: String(data.problemId ?? ""),
          language: (data.language as LANGUAGE) ?? "C",
        }
        return
      case "room_language":
        // 学生在协作期间切了语言。只有教师端收得到这条
        if (room.value) room.value.language = (data.language as LANGUAGE) ?? "C"
        return
      case "room_closed":
        // 不管 reason 一律先归位到 idle：学生这一侧的 socket 发送失败时，
        // 服务端把它从请求表里摘掉却**发不出**任何纠正性的 help_status
        // （那正是刚失败的那条 socket），不这样兜底 store 会卡在陈旧的
        // active/pending 上再也回不来。老师掉线的情况服务端会紧接着另发一条
        // help_status:pending——teardownRoom 里 room_closed 先发、
        // requeueAfterTeacherGone 后发，同一条连接上消息严格按发送顺序到达，
        // 这里先归零，那条 pending 补发会立刻把它纠正回来，不会被这次重置盖掉
        room.value = null
        helpStatus.value = "idle"
        setNotice(
          data.reason === "peer_offline" ? "对方已断开连接" : "协作已结束",
        )
        return
      case "error":
        setNotice(String(data.message ?? ""))
        return
    }
  }

  ws.addHandler(handleMessage)

  // 每次连接**建立**都清一遍本地状态，不止首次 connect() —— 重连（掉线重连、
  // API 重启后的自动重连）同样会触发。旧连接期间的 pending/active/requests
  // 可能早就过时了：老师端等服务端在 handleCollabOpen 里重新推 requests 补齐；
  // 学生端等服务端补发的 help_status 补齐（真在排队/协作中会被立刻纠正回来），
  // 不该让上一条连接的陈旧状态越过重连活下来
  ws.setConnectHandler(() => {
    requests.value = []
    helpStatus.value = "idle"
    queueAhead.value = 0
    teacherName.value = ""
    room.value = null
  })

  function connect() {
    ws.connect()
  }

  function disconnect() {
    ws.disconnect()
    requests.value = []
    helpStatus.value = "idle"
    queueAhead.value = 0
    teacherName.value = ""
    room.value = null
    notice.value = ""
    helpPanelOpen.value = false
  }

  function requestHelp(problemId: string, language: LANGUAGE) {
    ws.send({ type: "help_request", problemId, language })
  }

  /**
   * 求助期间换了语言。老师那边的高亮和补全按这个值选，不同步过去他就只能对着
   * 建房那一刻的语言给学生写代码。idle 时不发 —— 服务端压根没有这条求助记录。
   */
  function updateLanguage(language: LANGUAGE) {
    if (helpStatus.value === "idle") return
    ws.send({ type: "help_language", language })
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
    noticeSeq,
    helpPanelOpen,
    isTeacher: computed(() => userStore.isTeacherOrAbove),
    connect,
    disconnect,
    requestHelp,
    updateLanguage,
    cancelHelp,
    accept,
    reject,
    leave,
    sendBinary,
    setBinaryHandler,
    consumeNotice,
  }
})

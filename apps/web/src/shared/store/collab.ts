import { CollabWebSocket, type CollabMessage, type CollabRequestItem } from 'shared/composables/websocket'
import { useUserStore } from 'shared/store/user'
import type { LANGUAGE } from 'utils/types'

export type HelpStatus = 'idle' | 'pending' | 'active'

export interface RoomInfo {
  /**
   * help = 学生举手、老师接的；peek = 老师在看板上主动打开的（学生没举手）。
   * 学生那边按钮写「在帮你」还是「在看你的代码」、结束时说「帮完了」还是「看完了」看它
   */
  mode: 'help' | 'peek'
  peerName: string
  peerRole: 'student' | 'teacher'
  /** 教师端才有：学生的 id（协作条按它在列表里找他举手多久了）和班级（「帮完了」回哪个班的看板） */
  peerId: number | null
  peerClassName: string | null
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
export const useCollabStore = defineStore('collab', () => {
  const userStore = useUserStore()

  const ws = new CollabWebSocket()

  /** 老师端：待处理列表 */
  const requests = ref<CollabRequestItem[]>([])
  /** 学生端：自己的求助状态 */
  const helpStatus = ref<HelpStatus>('idle')
  const queueAhead = ref(0)
  const teacherName = ref('')
  /** 双方：当前房间。null 表示不在协作中 */
  const room = ref<RoomInfo | null>(null)
  /** 一次性提示，由 CollabHost 统一消费后清空 */
  const notice = ref('')
  /**
   * 顶栏「N 人举手」的面板开着没有。放在 store 里：面板里点了「帮他」「讲这道题」要把它收起来
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

  const pendingCount = computed(() => requests.value.filter((it) => it.status === 'pending').length)

  /** 下一个该帮的：还在排队的里面等得最久的 */
  const nextRequest = computed(() => requests.value.filter((it) => it.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)[0] ?? null)

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
    return Array.from(groups.values()).sort((a, b) => b.items.length - a.items.length || a.items[0].createdAt - b.items[0].createdAt)
  })

  /**
   * room_closed 的提示语。四种 reason 各自对两个角色说一句准确的话 ——
   * 原来不管什么情况都是一句「协作已结束」，学生分不出「老师处理完了」和
   * 「老师走开了」。
   *
   * 服务端保证发起方和对面**收到的 reason 不同**（teardownRoom 的 initiator）：
   * 自己干的是 `done` / `self_left`，对面才是 `peer_left` / `peer_offline`。
   * 所以这里既要看 reason 也要看角色。
   */
  function closedNotice(reason: unknown, closed: RoomInfo | null) {
    const teacher = userStore.isTeacherOrAbove
    const peek = closed?.mode === 'peek'
    // 学生那边：老师点了「帮完了 / 看完了」，或者老师主动看完走开了
    if (!teacher && closed && (reason === 'done' || (peek && reason === 'peer_left'))) {
      return `${closed.peerName} ${peek ? '看完了' : '帮完了'}`
    }
    switch (reason) {
      case 'peer_offline':
        return '对方已断开连接'
      // 对面离开了这道题：学生那侧要说明求助的去向 —— 服务端紧接着会补一条
      // help_status:pending 把他放回队列
      case 'peer_left':
        return teacher ? '学生离开了这道题，协作已结束' : '老师暂时离开，你的求助已重新排队'
      // 自己离开了这道题（跳走页面、把语言切成流程图）
      case 'self_left':
        return teacher ? '你已离开这道题，求助退回队列了' : '你已离开这道题，协作结束'
      // done：老师自己点的「帮完了」，页面跟着回看板或者去下一个，不用再说一句
      default:
        return teacher ? '' : '老师已结束这次帮忙'
    }
  }

  const handleMessage = (data: CollabMessage) => {
    switch (data.type) {
      case 'requests':
        requests.value = (data.list ?? []) as CollabRequestItem[]
        return
      case 'help_status':
        if (data.status === 'pending') {
          helpStatus.value = 'pending'
          queueAhead.value = Number(data.queueAhead ?? 0)
        } else if (data.status === 'active') {
          helpStatus.value = 'active'
          teacherName.value = String(data.teacherName ?? '')
        } else if (data.status === 'cancelled') {
          helpStatus.value = 'idle'
          setNotice('老师已取消你的求助')
        } else if (data.status === 'no_teacher') {
          helpStatus.value = 'idle'
          setNotice('当前没有老师在线')
        } else if (data.status === 'dismissed') {
          // 同一道题好几个人举手，老师全班讲完了，一次放下
          helpStatus.value = 'idle'
          setNotice(`${String(data.teacherName ?? '老师')} 讲了 ${String(data.problemId ?? '这道题')}，还不会就再举手`)
        }
        return
      case 'room_open':
        room.value = {
          mode: data.mode === 'peek' ? 'peek' : 'help',
          peerName: String(data.peer?.name ?? ''),
          peerRole: data.peer?.role === 'teacher' ? 'teacher' : 'student',
          peerId: typeof data.peer?.id === 'number' ? data.peer.id : null,
          peerClassName: typeof data.peer?.className === 'string' ? data.peer.className : null,
          problemId: String(data.problemId ?? ''),
          language: (data.language as LANGUAGE) ?? 'C',
        }
        return
      case 'room_language':
        // 学生在协作期间切了语言。只有教师端收得到这条
        if (room.value) room.value.language = (data.language as LANGUAGE) ?? 'C'
        return
      case 'room_closed':
        // 不管 reason 一律先归位到 idle：学生这一侧的 socket 发送失败时，
        // 服务端把它从请求表里摘掉却**发不出**任何纠正性的 help_status
        // （那正是刚失败的那条 socket），不这样兜底 store 会卡在陈旧的
        // active/pending 上再也回不来。老师掉线的情况服务端会紧接着另发一条
        // help_status:pending——teardownRoom 里 room_closed 先发、
        // requeueAfterTeacherGone 后发，同一条连接上消息严格按发送顺序到达，
        // 这里先归零，那条 pending 补发会立刻把它纠正回来，不会被这次重置盖掉
        {
          const closed = room.value
          room.value = null
          helpStatus.value = 'idle'
          const text = closedNotice(data.reason, closed)
          if (text) setNotice(text)
        }
        return
      case 'error':
        setNotice(String(data.message ?? ''))
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
    helpStatus.value = 'idle'
    queueAhead.value = 0
    teacherName.value = ''
    room.value = null
    // 服务端的「在写」随连接清掉了，重连后补报一次
    if (presence) ws.send({ type: 'presence', ...presence })
  })

  /** 学生此刻开着哪道题的编辑器，重连时补报用 */
  let presence: { problemId: string; language: LANGUAGE } | null = null

  function connect() {
    ws.connect()
  }

  function disconnect() {
    ws.disconnect()
    requests.value = []
    helpStatus.value = 'idle'
    queueAhead.value = 0
    teacherName.value = ''
    room.value = null
    notice.value = ''
    helpPanelOpen.value = false
  }

  function requestHelp(problemId: string, language: LANGUAGE) {
    ws.send({ type: 'help_request', problemId, language })
  }

  /**
   * 求助期间换了语言。老师那边的高亮和补全按这个值选，不同步过去他就只能对着
   * 建房那一刻的语言给学生写代码。idle 时不发 —— 服务端压根没有这条求助记录。
   */
  function updateLanguage(language: LANGUAGE) {
    if (helpStatus.value === 'idle') return
    ws.send({ type: 'help_language', language })
  }

  function cancelHelp() {
    ws.send({ type: 'help_cancel' })
    helpStatus.value = 'idle'
  }

  function accept(studentId: number) {
    ws.send({ type: 'accept', studentId })
  }

  /** 老师在看板上主动打开一个学生正在写的代码（他没举手也行；举着手就等于接单） */
  function peek(studentId: number) {
    ws.send({ type: 'peek', studentId })
  }

  /** 「讲完了，都放下」：这道题还在排队的手一次放下 */
  function dismiss(problemId: string) {
    ws.send({ type: 'dismiss', problemId })
  }

  /**
   * 学生报告他开着哪道题的编辑器（null = 离开了），老师看板「在写」那一列用。
   * 老师不报：老师的编辑器不会被别人打开
   */
  function reportPresence(problemId: string | null, language: LANGUAGE = 'Python') {
    if (userStore.isTeacherOrAbove) return
    presence = problemId ? { problemId, language } : null
    ws.send({ type: 'presence', problemId, language })
  }

  function reject(studentId: number) {
    ws.send({ type: 'reject', studentId })
  }

  /**
   * 退出房间。**两种语义**（服务端按 reason 分，见 collab/handler.ts 的 handleLeave）：
   *
   * - `"done"` —— 点了「结束协作」，这次帮忙结束，求助记录一并清掉；
   * - `"left"` —— 只是离开了这道题的页面。教师端「页面即协作现场」，跳走就不在
   *   房间里了，但那不等于处理完了：服务端会把求助**退回排队**，老师回来再点一次
   *   就接上，学生不用重新举手。
   */
  function leave(reason: 'done' | 'left' = 'done') {
    ws.send({ type: 'leave', reason })
  }

  function sendBinary(data: Uint8Array) {
    ws.sendRaw(data)
  }

  function setBinaryHandler(handler: ((data: ArrayBuffer) => void) | null) {
    ws.setBinaryHandler(handler)
  }

  function consumeNotice() {
    const value = notice.value
    notice.value = ''
    return value
  }

  return {
    requests,
    pendingCount,
    nextRequest,
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
    peek,
    dismiss,
    reportPresence,
    reject,
    leave,
    sendBinary,
    setBinaryHandler,
    consumeNotice,
  }
})

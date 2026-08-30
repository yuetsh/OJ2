import { and, eq, isNull } from "drizzle-orm"

import { touchSession } from "../auth/session"
import { db, schema } from "../db"
import { TEACHER_ROLES } from "../routes/helpers"
import {
  addRequest,
  addTeacher,
  closeRoom,
  getRequest,
  getRoom,
  hasTeacherOnline,
  listRequests,
  openRoom,
  queueAheadOf,
  removeRequest,
  removeTeacher,
  roomOf,
  teacherSockets,
  type CollabSocket,
  type HelpRequest,
  type Room,
} from "./state"

function isTeacher(ws: CollabSocket) {
  return TEACHER_ROLES.includes(ws.data.adminType ?? "")
}

/** 推给老师的列表条目。不含 socket，也不含任何代码内容 */
function serializeRequest(request: HelpRequest) {
  return {
    studentId: request.studentId,
    studentName: request.studentName,
    className: request.className,
    problemId: request.problemId,
    problemTitle: request.problemTitle,
    createdAt: request.createdAt,
    status: request.status,
    teacherName: request.teacherName ?? null,
  }
}

/**
 * 把最新的排队位置推给每个还在等的学生。
 *
 * queueAhead 原来只在「建请求 / 重连 / 退回排队」这三处推过，前面的人被接走或被
 * 取消之后不重算 —— 五个人排队、前四个都处理完了，第五个还一直显示「前面还有 4 人」。
 */
function broadcastQueuePositions() {
  for (const request of listRequests()) {
    if (request.status !== "pending") continue
    sendHelpStatus(request.socket, "pending", {
      queueAhead: queueAheadOf(request.studentId),
    })
  }
}

/**
 * 队列变了：老师端收全量列表，排队中的学生各自收自己的新位置。
 *
 * 两件事捏在一起是因为它们永远同时发生 —— 拆成两个函数分别调，迟早会在某条
 * 路径上漏掉一个。
 */
export function broadcastRequests() {
  const payload = JSON.stringify({
    type: "requests",
    list: listRequests().map(serializeRequest),
  })
  for (const ws of teacherSockets()) ws.send(payload)
  broadcastQueuePositions()
}

function sendHelpStatus(
  ws: CollabSocket,
  status: "pending" | "active" | "cancelled" | "no_teacher",
  extra: Record<string, unknown> = {},
) {
  ws.send(JSON.stringify({ type: "help_status", status, ...extra }))
}

export function handleCollabOpen(ws: CollabSocket) {
  if (isTeacher(ws)) {
    addTeacher(ws)
    // 新上线的老师要立刻看到当前队列，不能等下一次变更
    ws.send(
      JSON.stringify({ type: "requests", list: listRequests().map(serializeRequest) }),
    )
    return
  }

  // 学生（重）连：如果这个账号名下已经有一条请求（掉线重连回来，或者干脆是
  // 同账号第二个标签页），把它迁移到这条新连接上，并把当前状态补发回去 ——
  // 前端 onConnected 时会先把本地状态清空等着这条补发，不发的话就永远卡在
  // idle；不迁移 socket 归属的话，sendHelpStatus/accept 等后续推送会发到一条
  // 已经不用的旧连接上，新连接（新标签页）什么都收不到
  const request = getRequest(ws.data.userId)
  if (!request) return
  request.socket = ws

  const room = getRoom(ws.data.userId)
  if (room && room.studentSocket !== ws) {
    // 协作中的学生换了一条连接。**不迁移房间，直接拆掉。**
    //
    // 原来这里是把 studentSocket 换成新连接就算完，转发确实转到新连接了，
    // 但客户端接不住：前端每次连接建立都会把 room 清成 null（旧连接的状态
    // 不该越过重连活下来），而这里只补发了 help_status，没补 room_open ——
    // 于是学生页面显示「老师正在帮你」、编辑器却早就把 yCollab 摘了，
    // 老师照常敲字、一个字也到不了对面。正是 handleCollabBinary 注释里说的
    // 「看起来在协作、其实各看各的」，比老实断开更糟。
    //
    // 而补发 room_open 也修不好：Yjs 的文档状态跟着旧连接一起没了，新连接
    // 只能新建 Y.Doc，再拿学生编辑器里的内容当种子插进去，就会和老师那份
    // 已有内容合并成重复文本（两份 doc 的 item 身份不同，CRDT 不去重）。
    // 续接一个 CRDT 会话不是哑转发层做得到的事。
    //
    // 所以退回排队，老师再点一次 —— 和老师掉线走的是同一条路子。学生的代码
    // 一直在他自己的编辑器里，不受影响。
    closeRoom(room.studentId)
    room.studentSocket.data.roomOwnerId = undefined
    room.teacherSocket.data.roomOwnerId = undefined
    room.teacherSocket.send(
      JSON.stringify({ type: "room_closed", reason: "peer_offline" }),
    )
    request.status = "pending"
    request.teacherId = undefined
    request.teacherName = undefined
    broadcastRequests()
  }

  if (request.status === "pending") {
    sendHelpStatus(ws, "pending", { queueAhead: queueAheadOf(ws.data.userId) })
  } else if (request.status === "active") {
    sendHelpStatus(ws, "active", { teacherName: request.teacherName ?? "" })
  }
}

/** 老师从房间消失（掉线，或发送失败被判定为事实上不可达）：请求退回排队，
 * 学生不必重新点 —— 可能只是网络抖了一下 */
function requeueAfterTeacherGone(studentId: number) {
  const request = getRequest(studentId)
  if (request) {
    request.status = "pending"
    request.teacherId = undefined
    request.teacherName = undefined
    sendHelpStatus(request.socket, "pending", {
      queueAhead: queueAheadOf(studentId),
    })
  }
}

export function handleCollabClose(ws: CollabSocket) {
  if (isTeacher(ws)) removeTeacher(ws)

  const room = roomOf(ws)
  if (room) {
    closeRoom(room.studentId)
    room.studentSocket.data.roomOwnerId = undefined
    room.teacherSocket.data.roomOwnerId = undefined
    const peer = ws === room.teacherSocket ? room.studentSocket : room.teacherSocket
    peer.send(JSON.stringify({ type: "room_closed", reason: "peer_offline" }))

    if (ws === room.teacherSocket) {
      requeueAfterTeacherGone(room.studentId)
    } else {
      // 学生掉线：请求随人走
      removeRequest(room.studentId)
    }
  } else if (!isTeacher(ws)) {
    // 还在排队时关掉页面，请求也该消失 —— 但只能收自己这条。同一账号可能开了两个
    // 标签页，另一个标签页可能已经把请求接成 active（甚至已经换了一拨新请求），
    // 不加 socket 归属和状态检查，这里会把活跃房间的请求记录连根拔起
    const request = getRequest(ws.data.userId)
    if (request && request.socket === ws && request.status !== "active") {
      removeRequest(ws.data.userId)
    }
  }

  broadcastRequests()
}

export async function handleCollabMessage(ws: CollabSocket, raw: string) {
  let message: { type?: unknown; problemId?: unknown; studentId?: unknown }
  try {
    message = JSON.parse(raw) as typeof message
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
    return
  }

  // 心跳不查库，和 /ws/submissions 的处理一致
  if (message.type === "ping") {
    ws.send(JSON.stringify({ type: "pong", timestamp: (message as any).timestamp }))
    return
  }

  // 握手时校验过一次不算数 —— 这条连接能挂几个小时
  if (!(await touchSession(ws.data.token))) {
    ws.close(1008, "Session expired")
    return
  }

  switch (message.type) {
    case "help_request":
      await handleHelpRequest(ws, message.problemId)
      return
    case "help_cancel":
      handleHelpCancel(ws)
      return
    case "accept":
      await handleAccept(ws, message.studentId)
      return
    case "reject":
      await handleReject(ws, message.studentId)
      return
    case "leave":
      handleLeave(ws)
      return
    default:
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }))
  }
}

async function handleHelpRequest(ws: CollabSocket, problemId: unknown) {
  if (typeof problemId !== "string" || !problemId) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid problemId" }))
    return
  }
  if (isTeacher(ws)) {
    ws.send(JSON.stringify({ type: "error", message: "教师不能发起求助" }))
    return
  }
  if (!hasTeacherOnline()) {
    sendHelpStatus(ws, "no_teacher")
    return
  }

  // 只认非比赛题：contest_id 为空的那条。比赛题不提供求助
  const [problem] = await db
    .select({ title: schema.problem.title })
    .from(schema.problem)
    .where(
      and(
        eq(schema.problem.displayId, problemId),
        isNull(schema.problem.contestId),
      ),
    )
    .limit(1)
  if (!problem) {
    ws.send(JSON.stringify({ type: "error", message: "题目不存在或不支持求助" }))
    return
  }

  const existing = getRequest(ws.data.userId)
  // 已经在协作中就不重复登记，否则会把正在进行的房间挤掉
  if (existing?.status === "active") return

  const [student] = await db
    .select({ className: schema.user.className })
    .from(schema.user)
    .where(eq(schema.user.id, ws.data.userId))
    .limit(1)

  addRequest({
    studentId: ws.data.userId,
    studentName: ws.data.username ?? "",
    className: student?.className ?? null,
    problemId,
    problemTitle: problem.title,
    createdAt: Date.now(),
    status: "pending",
    socket: ws,
  })
  sendHelpStatus(ws, "pending", { queueAhead: queueAheadOf(ws.data.userId) })
  broadcastRequests()
}

function handleHelpCancel(ws: CollabSocket) {
  const request = getRequest(ws.data.userId)
  // 不比对 socket 归属：取消的是这个学生自己的求助，不管从他哪个标签页发起都
  // 合法——getRequest(ws.data.userId) 已经把范围锁在这一个用户上了，不是跨用户
  // 操作。这里和 handleCollabClose 的排队分支不是同一类问题：那边关闭事件是
  // 「顺带」触发的，必须认出是不是本人这条连接；这里是用户主动点了取消
  if (!request || request.status === "active") return
  removeRequest(ws.data.userId)
  broadcastRequests()
}

async function handleAccept(ws: CollabSocket, studentId: unknown) {
  if (!isTeacher(ws)) {
    ws.send(JSON.stringify({ type: "error", message: "无权限" }))
    return
  }
  if (typeof studentId !== "number") {
    ws.send(JSON.stringify({ type: "error", message: "Invalid studentId" }))
    return
  }

  // 握手时的 adminType 是那一刻的快照，接单前按库里的真实身份复核一次。
  // 注意读的是库，不是前端传的任何东西 —— 前端的演示模式在这里没有意义
  const [teacher] = await db
    .select({ adminType: schema.user.adminType })
    .from(schema.user)
    .where(and(eq(schema.user.id, ws.data.userId), eq(schema.user.isDisabled, false)))
    .limit(1)
  if (!teacher || !TEACHER_ROLES.includes(teacher.adminType)) {
    ws.close(1008, "Permission revoked")
    return
  }

  // 上面这次查询是个 await 点，等待期间这条连接可能已经断开——断线时
  // handleCollabClose 已经把它从 teacherSockets 摘掉了，用它来判断这次 accept
  // 还作不作数。continuation 里不能再对着一个死 socket 建房间
  if (!teacherSockets().has(ws)) return

  // 老师同时只能在一个房间
  if (roomOf(ws)) {
    ws.send(JSON.stringify({ type: "error", message: "请先退出当前协作" }))
    return
  }

  const request = getRequest(studentId)
  if (!request || request.status === "active" || getRoom(studentId)) {
    // 被别人接走了、学生已经撤销，或者这个学生 id 名下已经有一个房间在挂着
    // （正常路径走不到，是两个标签页 + 断线重连缝隙的最后一道闸）——
    // 回一份最新列表让老师端自己纠正
    ws.send(
      JSON.stringify({ type: "requests", list: listRequests().map(serializeRequest) }),
    )
    return
  }

  request.status = "active"
  request.teacherId = ws.data.userId
  request.teacherName = ws.data.username ?? ""

  ws.data.roomOwnerId = studentId
  request.socket.data.roomOwnerId = studentId
  openRoom({
    studentId,
    teacherId: ws.data.userId,
    studentSocket: request.socket,
    teacherSocket: ws,
    problemId: request.problemId,
  })

  const openFrame = (peerName: string, peerRole: "student" | "teacher") =>
    JSON.stringify({
      type: "room_open",
      peer: { name: peerName, role: peerRole },
      problemId: request.problemId,
    })
  request.socket.send(openFrame(request.teacherName, "teacher"))
  ws.send(openFrame(request.studentName, "student"))
  sendHelpStatus(request.socket, "active", { teacherName: request.teacherName })
  broadcastRequests()
}

async function handleReject(ws: CollabSocket, studentId: unknown) {
  if (!isTeacher(ws) || typeof studentId !== "number") return

  // reject 很少见，多这一次查询不心疼；不然握手快照挡不住"连接活着期间被降级
  // 或禁用"的老师继续掐掉排队中的求助
  const [teacher] = await db
    .select({ adminType: schema.user.adminType })
    .from(schema.user)
    .where(and(eq(schema.user.id, ws.data.userId), eq(schema.user.isDisabled, false)))
    .limit(1)
  if (!teacher || !TEACHER_ROLES.includes(teacher.adminType)) {
    ws.close(1008, "Permission revoked")
    return
  }

  const request = getRequest(studentId)
  // 已经在协作中的不能靠 reject 掐掉，那是 leave 的事
  if (!request || request.status === "active") return
  removeRequest(studentId)
  sendHelpStatus(request.socket, "cancelled")
  broadcastRequests()
}

/** 主动退出房间。老师点关闭、学生点结束都走这里 */
function handleLeave(ws: CollabSocket) {
  const room = roomOf(ws)
  if (!room) return
  teardownRoom(room, "done")
}

/**
 * 拆房间。reason 决定两端看到什么：
 *   done         —— 有人主动结束，双方都收到，请求一并清除
 *   peer_offline —— 有人断线或发送失败被判定为不可达，见 handleCollabClose /
 *                    handleCollabBinary。offlineSide 是消失的那一方：老师消失，
 *                    请求退回排队；学生消失，请求随人清掉。不传时（当前只有
 *                    handleLeave 走 "done"）不做这一步，只拆房间
 */
function teardownRoom(
  room: Room,
  reason: "done" | "peer_offline",
  offlineSide?: "student" | "teacher",
) {
  closeRoom(room.studentId)
  room.studentSocket.data.roomOwnerId = undefined
  room.teacherSocket.data.roomOwnerId = undefined
  const frame = JSON.stringify({ type: "room_closed", reason })
  room.studentSocket.send(frame)
  room.teacherSocket.send(frame)
  if (reason === "done") {
    removeRequest(room.studentId)
  } else if (offlineSide === "teacher") {
    requeueAfterTeacherGone(room.studentId)
  } else if (offlineSide === "student") {
    removeRequest(room.studentId)
  }
  broadcastRequests()
}

/**
 * Yjs 的 update / awareness 帧。服务端不解析、不留存，只转发给房间里的另一个人。
 *
 * 「服务端不知道代码内容」是有意的：这个通道要做的事只有认证和分房间，
 * 权限由 accept 时的库查询决定，与帧里装的是什么无关。
 */
export function handleCollabBinary(ws: CollabSocket, data: Buffer | Uint8Array) {
  // 空帧：Bun.serve 探测过，send() 对 0 字节帧也回 0（同一个返回值,
  // 真实送达和真实丢弃分不清），不转发、不参与下面的失败判定，直接忽略。
  // 否则任何一方发一个 0 字节二进制帧就能把整间房拆掉
  if (data.length === 0) return

  const room = roomOf(ws)
  if (!room) return
  const peer = ws === room.teacherSocket ? room.studentSocket : room.teacherSocket
  const sent = peer.send(data)
  // Bun.serve 探测过：-1 不代表失败，是背压——消息已排队，最终会送达（实测 8MB
  // 帧照样完整到达）；只有 0 才是真的丢了（对端事实上已经断开）。之前把 <= 0
  // 当成失败，慢网/大粘贴一触发背压就把正常房间拆掉，是本该保护的场景反而先死
  if (sent === 0) {
    // 真丢帧：两边的 Yjs 文档会从此悄悄分叉——教学工具里"看起来在协作、其实
    // 各看各的代码"比老实断开更糟，不做续传，直接拆房间。和教师断线走同一条
    // 收尾路径：老师那侧消失就把请求退回排队，不让学生卡死在 active 出不来
    console.error("Collab binary forward failed, tearing down room", {
      studentId: room.studentId,
    })
    const offlineSide = peer === room.teacherSocket ? "teacher" : "student"
    teardownRoom(room, "peer_offline", offlineSide)
  }
}

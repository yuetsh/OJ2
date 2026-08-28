import { and, eq, isNull } from "drizzle-orm"

import { touchSession } from "../auth/session"
import { db, schema } from "../db"
import { TEACHER_ROLES } from "../routes/helpers"
import {
  addRequest,
  addTeacher,
  closeRoom,
  getRequest,
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

export function broadcastRequests() {
  const payload = JSON.stringify({
    type: "requests",
    list: listRequests().map(serializeRequest),
  })
  for (const ws of teacherSockets()) ws.send(payload)
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
      // 老师掉线：请求退回排队，学生不必重新点 —— 可能只是网络抖了一下
      const request = getRequest(room.studentId)
      if (request) {
        request.status = "pending"
        request.teacherId = undefined
        request.teacherName = undefined
        sendHelpStatus(request.socket, "pending", {
          queueAhead: queueAheadOf(room.studentId),
        })
      }
    } else {
      // 学生掉线：请求随人走
      removeRequest(room.studentId)
    }
  } else if (!isTeacher(ws)) {
    // 还在排队时关掉页面，请求也该消失
    removeRequest(ws.data.userId)
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
      handleReject(ws, message.studentId)
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

  // 老师同时只能在一个房间
  if (roomOf(ws)) {
    ws.send(JSON.stringify({ type: "error", message: "请先退出当前协作" }))
    return
  }

  const request = getRequest(studentId)
  if (!request || request.status === "active") {
    // 被别人接走了或者学生已经撤销 —— 回一份最新列表让老师端自己纠正
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

function handleReject(ws: CollabSocket, studentId: unknown) {
  if (!isTeacher(ws) || typeof studentId !== "number") return
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
 *   peer_offline —— 有人断线，见 handleCollabClose
 */
function teardownRoom(room: Room, reason: "done" | "peer_offline") {
  closeRoom(room.studentId)
  room.studentSocket.data.roomOwnerId = undefined
  room.teacherSocket.data.roomOwnerId = undefined
  const frame = JSON.stringify({ type: "room_closed", reason })
  room.studentSocket.send(frame)
  room.teacherSocket.send(frame)
  if (reason === "done") removeRequest(room.studentId)
  broadcastRequests()
}

/**
 * Yjs 的 update / awareness 帧。服务端不解析、不留存，只转发给房间里的另一个人。
 *
 * 「服务端不知道代码内容」是有意的：这个通道要做的事只有认证和分房间，
 * 权限由 accept 时的库查询决定，与帧里装的是什么无关。
 */
export function handleCollabBinary(ws: CollabSocket, data: Buffer | Uint8Array) {
  const room = roomOf(ws)
  if (!room) return
  const peer = ws === room.teacherSocket ? room.studentSocket : room.teacherSocket
  peer.send(data)
}

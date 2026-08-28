import { and, eq, isNull } from "drizzle-orm"

import { touchSession } from "../auth/session"
import { db, schema } from "../db"
import {
  addRequest,
  addTeacher,
  getRequest,
  hasTeacherOnline,
  listRequests,
  queueAheadOf,
  removeRequest,
  removeTeacher,
  teacherSockets,
  type CollabSocket,
  type HelpRequest,
} from "./state"

const TEACHER_ROLES = ["Teacher Admin", "Super Admin"]

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
  // 房间与请求的清理在 Task 3 补
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

/** Task 3 会把它换成真正的按房间转发。此刻房间还不存在，先收下不处理 */
export function handleCollabBinary(_ws: CollabSocket, _data: Buffer | Uint8Array) {}

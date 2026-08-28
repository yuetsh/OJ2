/**
 * 课堂求助的内存状态。
 *
 * 不落库是有意的：求助是课堂上的即时行为，学生关掉页面这条请求就该消失。
 * 服务端只有一个 serve 进程（main.ts 单二进制 + 子命令，compose 里 oj-api 一个容器），
 * 所以内存态够用，不需要 Redis 同步。进程重启丢掉全部状态，两端重连后回到干净状态。
 */

export type CollabSocket = Bun.ServerWebSocket<import("../websocket").SubmissionSocketData>

export interface HelpRequest {
  studentId: number
  studentName: string
  className: string | null
  /** 题目的展示号（problem._id 列，前端一路用的都是它），不是自增主键 */
  problemId: string
  problemTitle: string
  createdAt: number
  status: "pending" | "active"
  teacherId?: number
  teacherName?: string
  socket: CollabSocket
}

/** 求助表，以学生为键 —— 一个学生同时只有一个求助 */
const requests = new Map<number, HelpRequest>()

/** 在线老师的连接。用于推列表，也用于判断 no_teacher */
const teachers = new Set<CollabSocket>()

export function addRequest(request: HelpRequest) {
  requests.set(request.studentId, request)
}

export function getRequest(studentId: number) {
  return requests.get(studentId)
}

export function removeRequest(studentId: number) {
  return requests.delete(studentId)
}

export function hasRequest(studentId: number) {
  return requests.has(studentId)
}

/** 按发起时间正序。老师端按等待时长排序展示，不强制先来先到 */
export function listRequests() {
  return Array.from(requests.values()).sort((a, b) => a.createdAt - b.createdAt)
}

/** 比自己早创建、且仍在排队的请求数 */
export function queueAheadOf(studentId: number) {
  const self = requests.get(studentId)
  if (!self) return 0
  let ahead = 0
  for (const request of requests.values()) {
    if (request.status === "pending" && request.createdAt < self.createdAt) ahead += 1
  }
  return ahead
}

export function addTeacher(ws: CollabSocket) {
  teachers.add(ws)
}

export function removeTeacher(ws: CollabSocket) {
  teachers.delete(ws)
}

export function hasTeacherOnline() {
  return teachers.size > 0
}

export function teacherSockets() {
  return teachers
}

export interface Room {
  /** 房主 = 学生。房间以学生为键，因为学生的代码是内容源 */
  studentId: number
  teacherId: number
  studentSocket: CollabSocket
  teacherSocket: CollabSocket
  problemId: string
}

const rooms = new Map<number, Room>()

export function openRoom(room: Room) {
  rooms.set(room.studentId, room)
}

export function getRoom(studentId: number) {
  return rooms.get(studentId)
}

export function closeRoom(studentId: number) {
  return rooms.delete(studentId)
}

/** 这条连接当前所在的房间。ws.data.roomOwnerId 是房主（学生）的 id */
export function roomOf(ws: CollabSocket) {
  const ownerId = ws.data.roomOwnerId
  return ownerId === undefined ? undefined : rooms.get(ownerId)
}

/** 仅供进程退出或测试用，正常路径不该调 */
export function resetCollabState() {
  requests.clear()
  teachers.clear()
  rooms.clear()
}

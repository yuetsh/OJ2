/**
 * 课堂求助的内存状态。
 *
 * 不落库是有意的：求助是课堂上的即时行为，学生关掉页面这条请求就该消失。
 * 服务端只有一个 serve 进程（main.ts 单二进制 + 子命令，compose 里 oj-api 一个容器），
 * 所以内存态够用，不需要 Redis 同步。进程重启丢掉全部状态，两端重连后回到干净状态。
 */

import { normalizeLanguage } from '@oj2/contract'

export type CollabSocket = Bun.ServerWebSocket<import('../websocket').SubmissionSocketData>

/**
 * 协作支持的语言。和前端 utils/types.ts 里的 LANGUAGE 对齐，去掉 Flowchart ——
 * 流程图题没有代码编辑器，求助入口本身就是隐藏的。
 */
export const COLLAB_LANGUAGES = ['C', 'C++', 'Python', 'Java', 'JavaScript', 'Golang', 'SQL'] as const

export type CollabLanguage = (typeof COLLAB_LANGUAGES)[number]

/**
 * 认不出来的一律当 C：老客户端不带这个字段，而它以前就是写死 C 的。
 *
 * 先过契约的别名表 —— 上线那一刻学生页面里还揣着 `Python3`，不翻译的话会**静默**
 * 落到 C，求助窗口里的代码高亮和同步编辑都按 C 走，没人会报错。
 */
export function normalizeCollabLanguage(value: unknown): CollabLanguage {
  const normalized = normalizeLanguage(value) ?? value
  return (COLLAB_LANGUAGES as readonly string[]).includes(normalized as string) ? (normalized as CollabLanguage) : 'C'
}

/**
 * 学生这道题最后一次代码提交，老师的举手面板按它写错法（和课堂看板的格子同一份形状，
 * 前端用同一个 errorKind 归类）。只带归类要用的几样，不带代码
 */
export interface CollabLatest {
  submissionId: string
  result: number
  runtimeError?: unknown
  sampleCheck?: unknown
}

export interface HelpRequest {
  studentId: number
  studentName: string
  className: string | null
  /** 题目的展示号（problem._id 列，前端一路用的都是它），不是自增主键 */
  problemId: string
  /** problem.id，查他最后一次提交用 */
  problemPk: number
  problemTitle: string
  /** 他这道题最后一次代码提交；没交过为 null。判完新的一次会刷新（refreshRequestLatest） */
  latest: CollabLatest | null
  /**
   * 学生编辑器当前的语言。决定教师端弹框用哪套高亮和补全 —— 求助时带上，
   * 协作期间学生切语言会用 help_language 更新这里
   */
  language: CollabLanguage
  createdAt: number
  status: 'pending' | 'active'
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
    if (request.status === 'pending' && request.createdAt < self.createdAt) ahead += 1
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
  /**
   * help = 学生举了手、老师接的；peek = 老师在看板上主动打开的（学生没举手）。
   * 两边看到的字不一样（「在帮你」/「在看你的代码」），peek 没有求助记录要清
   */
  mode: 'help' | 'peek'
  teacherId: number
  studentSocket: CollabSocket
  teacherSocket: CollabSocket
  problemId: string
  /** 建房那一刻学生的语言，之后跟着 help_language 走 */
  language: CollabLanguage
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

/**
 * 学生此刻开着哪道题的代码编辑器（题目页，非比赛）。老师在看板上「在写」那一列看它、
 * 点它主动打开 —— 不用等学生举手。学生端编辑器挂上 / 换题 / 卸载时上报，
 * 连接断了就清掉。同一账号开了两个标签页时，后报的算
 */
export interface Presence {
  problemId: string
  language: CollabLanguage
  socket: CollabSocket
}

const presences = new Map<number, Presence>()

export function setPresence(userId: number, presence: Presence) {
  presences.set(userId, presence)
}

/** 只清这条连接报的：同账号另一个标签页报的那份不能被这边关页面顺手清掉 */
export function clearPresence(userId: number, ws: CollabSocket) {
  if (presences.get(userId)?.socket === ws) presences.delete(userId)
}

export function presenceOf(userId: number) {
  return presences.get(userId)
}

import { createDiscreteApi } from "naive-ui"
import { ref, onUnmounted, type Ref } from "vue"

import { useAuthModalStore } from "shared/store/authModal"
import { useUserStore } from "shared/store/user"
import { STORAGE_KEY } from "utils/constants"
import storage from "utils/storage"

// 全站唯一一处，脱离 n-message-provider 也能弹 —— 强制登出跟当前挂着哪个组件无关。
// utils/api.ts 里也是这么做的
const { message: toast } = createDiscreteApi(["message"])

/**
 * 服务端要求下线。两种来源：账号被管理员禁用，或者这张会话没了（在别的标签页
 * 登出、或者会话到期）。
 *
 * 表现刻意和 utils/api.ts 里 account-disabled / login-required 两支保持一致 ——
 * 同一件事从 HTTP 和 WebSocket 两条路进来，学生看到的结果不该有两个样子。
 */
function handleForceLogout(reason: string) {
  const userStore = useUserStore()
  // 配置通道和提交通道可能同时挂着，两条都会收到这一帧。第一次就把登录态清了，
  // 第二次在这里掉头，免得弹两遍
  if (!userStore.isAuthed) return
  storage.remove(STORAGE_KEY.AUTHED)
  userStore.clearProfile()
  if (reason === "account-disabled") {
    // 不能弹登录框：账号已经禁用，登进去还是被拒，会陷进「弹框 → 登录 → 又弹框」
    toast.error("账号已被禁用，请联系老师")
    return
  }
  useAuthModalStore().openLoginModal()
}

/**
 * WebSocket 连接状态
 */
export type ConnectionStatus =
  "disconnected" | "connecting" | "connected" | "error"

/**
 * WebSocket 消息类型
 */
export interface WebSocketMessage {
  type: string
  [key: string]: any
}

/**
 * WebSocket 配置
 */
export interface WebSocketConfig {
  /** 完整 URL。后端只认 /ws/submissions 和 /ws/config 两条，按当前页面的协议与 host 拼 */
  url: string
  /**
   * 最大重连次数，默认不限。
   * 原来默认 5 次、线性退避，加起来只有 15 秒 —— 后端 deploy 重启一次就超了，
   * 之后这条连接死到用户刷新页面为止。机房网络抖动同理，所以默认不再封顶。
   */
  maxReconnectAttempts?: number
  /** 首次重连延迟（毫秒），默认 1000。之后指数退避 */
  reconnectDelay?: number
  /** 重连延迟上限（毫秒），默认 30000 */
  maxReconnectDelay?: number
  /** 心跳间隔（毫秒），默认 30000（30秒） */
  heartbeatTime?: number
  /** 是否启用心跳，默认 true */
  enableHeartbeat?: boolean
  /** 是否启用自动重连，默认 true */
  enableAutoReconnect?: boolean
}

/**
 * WebSocket 消息处理器
 */
export type MessageHandler<T extends WebSocketMessage = WebSocketMessage> = (
  data: T,
) => void

/**
 * WebSocket 基础连接管理类
 * 提供连接、重连、心跳等通用功能
 */
export class BaseWebSocket<T extends WebSocketMessage = WebSocketMessage> {
  protected ws: WebSocket | null = null
  protected url: string
  protected handlers: Set<MessageHandler<T>> = new Set()
  protected reconnectAttempts = 0
  protected maxReconnectAttempts: number
  protected reconnectDelay: number
  protected heartbeatInterval: number | null = null
  protected heartbeatTime: number
  protected enableHeartbeat: boolean
  protected enableAutoReconnect: boolean
  protected maxReconnectDelay: number
  protected disconnectTimer: number | null = null
  protected reconnectTimer: number | null = null
  /**
   * 「用户主动断开」的意图，和 enableAutoReconnect 这个**配置**分开存。
   * 以前两者共用一个字段：disconnect() 把配置改成 false 来阻止重连，而 connect()
   * 从不改回 true —— 登出再登录后，这条连接就永远失去了自动重连能力。
   */
  protected closedByUser = false
  protected reviveBound = false

  public status: Ref<ConnectionStatus> = ref<ConnectionStatus>("disconnected")

  constructor(config: WebSocketConfig) {
    this.url = config.url

    this.maxReconnectAttempts = config.maxReconnectAttempts ?? Number.POSITIVE_INFINITY
    this.reconnectDelay = config.reconnectDelay ?? 1000
    this.maxReconnectDelay = config.maxReconnectDelay ?? 30000
    this.heartbeatTime = config.heartbeatTime ?? 30000
    this.enableHeartbeat = config.enableHeartbeat ?? true
    this.enableAutoReconnect = config.enableAutoReconnect ?? true
  }

  /**
   * 连接 WebSocket
   */
  connect() {
    // 重新表达「我要连着」的意图：把上一次 disconnect() 留下的状态清掉
    this.closedByUser = false
    this.clearReconnectTimer()

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    this.bindReviveListeners()
    this.status.value = "connecting"

    try {
      // 所有回调都闭包住这个局部 ws 而不是读 this.ws：一条被换掉的旧连接
      // 迟到的 onclose / onerror 不该去改现在这条连接的状态
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.binaryType = "arraybuffer"

      ws.onopen = () => {
        if (ws !== this.ws) return
        this.status.value = "connected"
        this.reconnectAttempts = 0
        console.log(`[WebSocket] 连接成功: ${this.url}`)
        if (this.enableHeartbeat) {
          this.startHeartbeat()
        }
        this.onConnected()
      }

      ws.onmessage = (event) => {
        if (ws !== this.ws) return

        // Yjs 这类二进制帧不是 JSON，交给子类。基类的 pong / force_logout 都是文本帧，
        // 不会走到这条路径上
        if (typeof event.data !== "string") {
          this.onBinary(event.data as ArrayBuffer)
          return
        }

        try {
          const data = JSON.parse(event.data) as T

          // 处理心跳响应
          if (data.type === "pong") {
            return
          }

          // 服务端要求下线。和 pong 一样是协议层的事，不该让每个业务 handler
          // 各自认一遍 —— 而且此刻多半根本没有能处理它的 handler 挂着
          if (data.type === "force_logout") {
            // 必须主动断，否则服务端断开后这条连接会照常自动重连，然后一路 401
            // 撞到退避上限 —— 正是这条机制要消掉的浪费
            this.disconnect()
            handleForceLogout(String(data.reason ?? ""))
            return
          }

          // 调用消息处理钩子
          this.onMessage(data)
        } catch (error) {
          console.error("[WebSocket] 解析消息失败:", error)
        }
      }

      ws.onerror = (error) => {
        if (ws !== this.ws) return
        console.error("[WebSocket] 连接错误:", error)
        this.status.value = "error"
        this.onError(error)
      }

      ws.onclose = (event) => {
        // disconnect() 会先把 this.ws 置空再 close()，所以主动断开走不到这里，
        // 收尾由 disconnect() 自己做 —— 也就不会再像以前那样「断完立刻重连」
        if (ws !== this.ws) return
        this.ws = null
        console.log(
          `[WebSocket] 连接关闭: code=${event.code}, reason=${event.reason}`,
        )
        this.status.value = "disconnected"
        this.stopHeartbeat()
        this.onDisconnected(event)
        this.scheduleReconnect()
      }
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error)
      this.status.value = "error"
      this.scheduleReconnect()
    }
  }

  /**
   * 安排一次重连。指数退避 + 抖动：一个班几十台机器同时掉线时，
   * 别在同一毫秒一起冲回来把刚起来的后端再压趴一次。
   */
  protected scheduleReconnect() {
    if (this.closedByUser || !this.enableAutoReconnect) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return
    if (this.reconnectTimer !== null) return

    this.reconnectAttempts++
    const base = Math.min(
      this.reconnectDelay * 2 ** (this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    )
    const delay = Math.round(base * (0.5 + Math.random() * 0.5))
    console.log(`[WebSocket] 将在 ${delay}ms 后重连 (第 ${this.reconnectAttempts} 次)`)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  protected clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /**
   * 网络恢复 / 标签页重新可见时立刻重连，不必等退避计时器走完。
   * 退避到 30 秒后，用户切回页面却还要再干等半分钟是说不过去的。
   */
  protected readonly revive = () => {
    if (this.closedByUser || !this.enableAutoReconnect) return
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    if (document.visibilityState === "hidden") return
    if (navigator.onLine === false) return
    this.clearReconnectTimer()
    this.reconnectAttempts = 0
    this.connect()
  }

  protected bindReviveListeners() {
    if (this.reviveBound) return
    this.reviveBound = true
    window.addEventListener("online", this.revive)
    document.addEventListener("visibilitychange", this.revive)
  }

  protected unbindReviveListeners() {
    if (!this.reviveBound) return
    this.reviveBound = false
    window.removeEventListener("online", this.revive)
    document.removeEventListener("visibilitychange", this.revive)
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.closedByUser = true
    this.cancelScheduledDisconnect()
    // 以前没存重连计时器的句柄：卸载后那个 setTimeout 照样会触发 connect()，
    // 在已经销毁的组件上又建一条连接出来
    this.clearReconnectTimer()
    this.stopHeartbeat()
    this.unbindReviveListeners()
    this.reconnectAttempts = 0
    // 先摘掉引用再 close()，onclose 里的 `ws !== this.ws` 就能识别出这是主动断开
    const ws = this.ws
    this.ws = null
    if (ws) ws.close()
    this.status.value = "disconnected"
  }

  /**
   * 安排延迟断开连接
   * @param delay 延迟时间（毫秒），默认 900000（15分钟）
   */
  scheduleDisconnect(delay: number = 15 * 60 * 1000) {
    // 取消之前的定时器
    this.cancelScheduledDisconnect()

    // 设置新的定时器
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = null
      const minutes = Math.floor(delay / 60000)
      console.log(`WebSocket idle for ${minutes} minutes, disconnecting...`)
      // 这里**只断开**。原来断完紧接着一句 `enableAutoReconnect = true`，
      // 而 close 是异步的 —— 等 onclose 跑到时标志已经翻回来了，于是 1 秒后
      // 又自动连上：这个「省资源」的空闲断开从来没有真正生效过。
      // 下一次 connect()（新提交）会自己把 closedByUser 清掉，不需要在这里预置。
      this.disconnect()
    }, delay)
  }

  /**
   * 取消已安排的断开连接
   */
  cancelScheduledDisconnect() {
    if (this.disconnectTimer !== null) {
      clearTimeout(this.disconnectTimer)
      this.disconnectTimer = null
    }
  }

  /**
   * 发送消息
   */
  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
      return true
    }
    return false
  }

  /**
   * 二进制帧钩子。基类不认二进制，默认丢弃；collab 这类通道在子类里覆盖。
   * 和 onMessage 对称，不要在这里做 JSON 解析。
   */
  protected onBinary(_data: ArrayBuffer) {}

  /**
   * 不做 JSON 序列化的发送。Yjs 的 update / awareness 本身就是 Uint8Array，
   * 走 send() 会被 JSON.stringify 成一个 {"0":12,"1":3,...} 的对象。
   */
  sendRaw(data: ArrayBuffer | Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data)
      return true
    }
    return false
  }

  /**
   * 添加消息处理器
   */
  addHandler(handler: MessageHandler<T>) {
    this.handlers.add(handler)
  }

  /**
   * 移除消息处理器
   */
  removeHandler(handler: MessageHandler<T>) {
    this.handlers.delete(handler)
  }

  /**
   * 清除所有处理器
   */
  clearHandlers() {
    this.handlers.clear()
  }

  /**
   * 发送心跳包
   */
  protected sendHeartbeat() {
    this.send({ type: "ping", timestamp: Date.now() })
  }

  /**
   * 开始心跳
   */
  protected startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatInterval = window.setInterval(() => {
      this.sendHeartbeat()
    }, this.heartbeatTime)
  }

  /**
   * 停止心跳
   */
  protected stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * 连接成功钩子（子类可重写）
   */
  protected onConnected() {
    // 子类实现
  }

  /**
   * 断开连接钩子（子类可重写）
   */
  protected onDisconnected(_event: CloseEvent) {
    // 子类实现
  }

  /**
   * 错误钩子（子类可重写）
   */
  protected onError(_error: Event) {
    // 子类实现
  }

  /**
   * 消息处理钩子（子类可重写）
   */
  protected onMessage(data: T) {
    // 通知所有处理器
    this.handlers.forEach((handler) => {
      try {
        handler(data)
      } catch (error) {
        console.error("Error in message handler:", error)
      }
    })
  }
}

/**
 * 提交状态更新的数据类型
 */
export interface SubmissionUpdate extends WebSocketMessage {
  type: "submission_update"
  submissionId: string
  result: number
  status: "pending" | "judging" | "finished" | "error"
  score?: number
}

/**
 * 带「订阅意图」的连接。
 *
 * subscribe() 在连接还没就绪时先把 id 记下来，等 onConnected() 补发 —— 调用方
 * 不用关心此刻连上没有，断线重连后也会自动重新订阅。
 *
 * 原来这套只有 SubmissionWebSocket 有，FlowchartWebSocket 是 send 失败就打一行
 * 日志了事：socket 一掉，那次评分的结果就再也回不来，页面永远转圈。提到基类上，
 * 两条通道共用同一套语义。
 */
class SubscribingWebSocket<
  T extends WebSocketMessage,
> extends BaseWebSocket<T> {
  /**
   * 当前在等结果的提交。**一直留着**，直到调用方 unsubscribe()。
   *
   * 原来这个字段叫 pendingSubmissionId，订阅一发成功就清空 —— 它只解决了
   * 「还没连上就调 subscribe」，没解决断线重连。而真正会丢结果的恰恰是后者：
   * 服务端收到 subscribe 会回一份当前状态，掉线期间错过的那条推送就是靠这次
   * 重放补回来的。不重新订阅，重连后就只收得到「将来」的事件，可结果已经是过去式了。
   */
  private subscribedId = ""

  /**
   * 订阅特定提交的更新。连接没就绪也可以调，连上后会自动补发。
   */
  subscribe(submissionId: string) {
    this.subscribedId = submissionId
    this.sendSubscribe(submissionId)
  }

  /** 结果已经拿到，重连后不必再问一遍 */
  unsubscribe() {
    this.subscribedId = ""
  }

  protected onConnected() {
    if (this.subscribedId) this.sendSubscribe(this.subscribedId)
  }

  private sendSubscribe(submissionId: string) {
    return this.send({ type: "subscribe", submissionId })
  }
}

/**
 * 提交 WebSocket 连接管理类
 */
class SubmissionWebSocket extends SubscribingWebSocket<SubmissionUpdate> {
  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    super({ url: `${protocol}//${window.location.host}/ws/submissions` })
  }
}

/**
 * 用于组件中使用 WebSocket 的 Composable
 * 每次调用创建新的 WebSocket 实例
 */
export function useSubmissionWebSocket(
  handler?: MessageHandler<SubmissionUpdate>,
) {
  const ws = new SubmissionWebSocket()

  // 如果提供了处理器，添加到实例中
  if (handler) {
    ws.addHandler(handler)
  }

  // 组件卸载时清理资源
  onUnmounted(() => {
    if (handler) {
      ws.removeHandler(handler)
    }
    ws.disconnect()
  })

  return {
    connect: () => ws.connect(),
    disconnect: () => ws.disconnect(),
    subscribe: (submissionId: string) => ws.subscribe(submissionId),
    unsubscribe: () => ws.unsubscribe(),
    scheduleDisconnect: (delay?: number) => ws.scheduleDisconnect(delay),
    cancelScheduledDisconnect: () => ws.cancelScheduledDisconnect(),
    status: ws.status,
    addHandler: (h: MessageHandler<SubmissionUpdate>) => ws.addHandler(h),
    removeHandler: (h: MessageHandler<SubmissionUpdate>) => ws.removeHandler(h),
  }
}

/**
 * 通用 WebSocket Composable 工厂函数
 * 用于创建自定义的 WebSocket composable
 *
 * @example
 * ```ts
 * // 创建通知 WebSocket
 * interface NotificationMessage extends WebSocketMessage {
 *   type: 'notification'
 *   title: string
 *   content: string
 * }
 *
 * class NotificationWebSocket extends BaseWebSocket<NotificationMessage> {
 *   constructor() {
 *     const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
 *     super({ url: `${protocol}//${window.location.host}/ws/notifications` })
 *   }
 * }
 *
 * let notificationWs: NotificationWebSocket | null = null
 *
 * export function useNotificationWebSocket(handler?: MessageHandler<NotificationMessage>) {
 *   if (!notificationWs) {
 *     notificationWs = new NotificationWebSocket()
 *   }
 *   return createWebSocketComposable(notificationWs, handler)
 * }
 * ```
 */
export function createWebSocketComposable<T extends WebSocketMessage>(
  ws: BaseWebSocket<T>,
  handler?: MessageHandler<T>,
) {
  if (handler) {
    ws.addHandler(handler)
  }

  onUnmounted(() => {
    if (handler) {
      ws.removeHandler(handler)
    }
  })

  return {
    connect: () => ws.connect(),
    disconnect: () => ws.disconnect(),
    send: (data: any) => ws.send(data),
    status: ws.status,
    addHandler: (h: MessageHandler<T>) => ws.addHandler(h),
    removeHandler: (h: MessageHandler<T>) => ws.removeHandler(h),
  }
}

/**
 * 流程图评分更新消息类型
 */
export interface FlowchartEvaluationUpdate extends WebSocketMessage {
  type:
    | "flowchart_evaluation_completed"
    | "flowchart_evaluation_failed"
    | "flowchart_evaluation_update"
  submissionId: string
  score?: number
  grade?: string
  feedback?: string
  suggestions?: string
  criteriaDetails?: any
  error?: string
}

/**
 * 流程图 WebSocket 连接管理类
 */
class FlowchartWebSocket extends SubscribingWebSocket<FlowchartEvaluationUpdate> {
  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    super({ url: `${protocol}//${window.location.host}/ws/submissions` })
  }
}

/**
 * 用于组件中使用流程图 WebSocket 的 Composable
 */
export function useFlowchartWebSocket(
  handler?: MessageHandler<FlowchartEvaluationUpdate>,
) {
  const ws = new FlowchartWebSocket()

  // 如果提供了处理器，添加到实例中
  if (handler) {
    ws.addHandler(handler)
  }

  // 组件卸载时清理资源
  onUnmounted(() => {
    if (handler) {
      ws.removeHandler(handler)
    }
    ws.disconnect()
  })

  return {
    connect: () => ws.connect(),
    disconnect: () => ws.disconnect(),
    subscribe: (submissionId: string) => ws.subscribe(submissionId),
    unsubscribe: () => ws.unsubscribe(),
    scheduleDisconnect: (delay?: number) => ws.scheduleDisconnect(delay),
    cancelScheduledDisconnect: () => ws.cancelScheduledDisconnect(),
    status: ws.status,
    addHandler: (h: MessageHandler<FlowchartEvaluationUpdate>) =>
      ws.addHandler(h),
    removeHandler: (h: MessageHandler<FlowchartEvaluationUpdate>) =>
      ws.removeHandler(h),
  }
}

/**
 * 配置更新消息类型
 */
export interface ConfigUpdate extends WebSocketMessage {
  type: "config_update"
  key: string
  value: any
}

/**
 * 配置 WebSocket 连接管理类
 */
class ConfigWebSocket extends BaseWebSocket<ConfigUpdate> {
  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    super({ url: `${protocol}//${window.location.host}/ws/config` })
  }
  // 这条通道是**单向**的：只收后端广播。服务端的消息处理只认 ping / subscribe，
  // 客户端往这里推 config_update 会被回一个 error 帧 —— 别再加发送方法。
  // 配置变更走 POST /admin/website，由后端广播给所有人。
}

/**
 * 用于组件中使用配置 WebSocket 的 Composable
 */
export function useConfigWebSocket(handler?: MessageHandler<ConfigUpdate>) {
  const ws = new ConfigWebSocket()

  // 同步注册，和另外两个 composable 一致。原来放在 onMounted 里，而调用方
  // （useConfigUpdate）在 setup 阶段就 connect() 了 —— 中间那段窗口收到的广播
  // 没有任何 handler 接。窗口极小，但没有任何理由留着它。
  if (handler) {
    ws.addHandler(handler)
  }

  onUnmounted(() => {
    if (handler) {
      ws.removeHandler(handler)
    }
    ws.disconnect()
  })

  return {
    connect: () => ws.connect(),
    disconnect: () => ws.disconnect(),
    status: ws.status,
    addHandler: (h: MessageHandler<ConfigUpdate>) => ws.addHandler(h),
    removeHandler: (h: MessageHandler<ConfigUpdate>) => ws.removeHandler(h),
  }
}

export interface CollabRequestItem {
  studentId: number
  studentName: string
  className: string | null
  problemId: string
  problemTitle: string
  createdAt: number
  status: "pending" | "active"
  teacherName: string | null
}

export interface CollabMessage extends WebSocketMessage {
  type:
    | "requests"
    | "help_status"
    | "room_open"
    | "room_closed"
    | "error"
}

/**
 * 课堂求助 / 协作通道。和另外两条的区别是它**双向**且**收发二进制** ——
 * 控制面是 JSON，Yjs 的 update / awareness 走 sendRaw 与 onBinary。
 */
export class CollabWebSocket extends BaseWebSocket<CollabMessage> {
  private binaryHandler: ((data: ArrayBuffer) => void) | null = null
  private connectHandler: (() => void) | null = null

  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    super({ url: `${protocol}//${window.location.host}/ws/collab` })
  }

  setBinaryHandler(handler: ((data: ArrayBuffer) => void) | null) {
    this.binaryHandler = handler
  }

  /**
   * 每次连接**建立**都触发，含重连 —— 不止首次 connect()。用来在重连瞬间
   * 清掉本地缓存的求助/房间状态：旧连接期间的 pending/active 可能早就过时了，
   * 服务端会在 handleCollabOpen 里紧接着补发 requests（老师）或 help_status
   * （还在排队/协作中的学生），补发落地前先归零，好过让过时状态活过一次重连。
   */
  setConnectHandler(handler: (() => void) | null) {
    this.connectHandler = handler
  }

  protected override onBinary(data: ArrayBuffer) {
    this.binaryHandler?.(data)
  }

  protected override onConnected() {
    this.connectHandler?.()
  }
}

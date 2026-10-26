import { getCurrentScope, onScopeDispose, watch, type Ref } from 'vue'
import { useDocumentVisibility } from '@vueuse/core'
import type { ConnectionStatus } from 'shared/composables/websocket'

/** 交上去之后先等 WebSocket 这么久，再开始兜底 */
const GRACE = 5000
/** WebSocket 不通时从这个间隔起拉，每次乘 1.5，最慢到 MAX_FAST */
const MIN_FAST = 2000
const MAX_FAST = 10_000
/** WebSocket 好好的：结果会推过来，轮询只是防 pub/sub 丢那一条，隔这么久问一次 */
const SLOW = 20_000
/** 连着失败这么多次就不拉了 */
const MAX_ERRORS = 5

/**
 * 判题、流程图评分的结果「WebSocket 推、轮询兜底」里的兜底那一半。
 *
 * 原来是交上去 5 秒还没结果就每 2 秒（流程图 3 秒）拉一次，分不清「WebSocket 断了」和
 * 「队列排得长」。服务器只有两核，一个班 50 人一起交时判题队列要排一分钟，几乎每个人都
 * 进了轮询，每秒二十几个请求全在和判题抢 CPU。
 *
 * 能分清的依据：服务端收到 subscribe 会立刻回一帧当前状态（pending / judging 也回），
 * 断线重连后 websocket.ts 会自动重新订阅、再回一帧。所以调用方收到**这一条**的任何帧就
 * `confirm()`，此后只要连接没断，就知道结果会推过来，轮询退到 20 秒一次；连接一断立刻
 * 回到快档。页面藏在后台时不拉：切回来时 WebSocket 会自己重连、重放当前状态。
 *
 * `poll` 返回 true 表示有结果了、不用再拉。抛错按快档退避接着拉（掉线那几秒拉失败是
 * 常事，原来一次失败就永久停掉，之后要是又丢了推送就一直转圈），连着失败
 * MAX_ERRORS 次才放弃，别对着一个坏掉的接口一直刷。
 */
export function useFallbackPoll(options: { status: Ref<ConnectionStatus>; poll: () => Promise<boolean> }) {
  const visibility = useDocumentVisibility()
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let confirmed = false
  let fastDelay = MIN_FAST
  let lastPolledAt = 0
  let errors = 0

  const healthy = () => confirmed && options.status.value === 'connected'

  function schedule(delay: number) {
    clearTimeout(timer)
    timer = setTimeout(tick, delay)
  }

  async function tick() {
    if (!active) return
    if (visibility.value === 'hidden') {
      schedule(SLOW)
      return
    }
    // 刚失败过的不算健康：WebSocket 看着连着，拉却失败了，多半是网刚断、它还没察觉
    if (healthy() && errors === 0 && Date.now() - lastPolledAt < SLOW) {
      schedule(SLOW - (Date.now() - lastPolledAt))
      return
    }
    lastPolledAt = Date.now()
    try {
      if (await options.poll()) {
        stop()
        return
      }
      errors = 0
    } catch (error) {
      console.error('[FallbackPoll] 轮询失败:', error)
      if (++errors >= MAX_ERRORS) {
        stop()
        return
      }
    }
    if (!active) return
    if (healthy() && errors === 0) {
      schedule(SLOW)
    } else {
      schedule(fastDelay)
      fastDelay = Math.min(MAX_FAST, fastDelay * 1.5)
    }
  }

  /** 开始跟一条新的。lastPolledAt 记成现在：WebSocket 一直好的话，第一次拉在 20 秒后 */
  function start() {
    active = true
    confirmed = false
    fastDelay = MIN_FAST
    errors = 0
    lastPolledAt = Date.now()
    schedule(GRACE)
  }

  function stop() {
    active = false
    clearTimeout(timer)
    timer = undefined
  }

  /** 收到了这一条的推送：WebSocket 是通的 */
  function confirm() {
    confirmed = true
  }

  // 连接一断，之前的确认就不算数了，回到快档；重连上之后的重放帧会再确认一次。
  // 本来就没确认的不管：连不上时每次重连都要走一遍 connecting → error → disconnected，
  // 在这里重置的话退避永远退不上去
  watch(options.status, (status) => {
    if (!active || !confirmed || status === 'connected') return
    confirmed = false
    fastDelay = MIN_FAST
    schedule(MIN_FAST)
  })

  // 切回前台：WebSocket 还没确认的话别等满 20 秒
  watch(visibility, (value) => {
    if (active && value === 'visible' && !healthy()) schedule(MIN_FAST)
  })

  if (getCurrentScope()) onScopeDispose(stop)

  return { start, stop, confirm }
}

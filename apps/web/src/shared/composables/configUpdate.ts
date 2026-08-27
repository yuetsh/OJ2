import { useConfigStore } from "shared/store/config"
import { useUserStore } from "shared/store/user"
import {
  useConfigWebSocket,
  type ConfigUpdate,
} from "shared/composables/websocket"

/**
 * 收 /ws/config 的站点配置广播，写进 configStore —— 超管改完配置，所有开着页面
 * 的人不必刷新就生效。
 *
 * 广播里的 key 就是 store 的字段名（后端推的是契约字段名，不是 options 表那套
 * snake_case 列键），所以这里直接按名字赋值，不需要换名。
 */
export function useConfigUpdate() {
  const configStore = useConfigStore()
  const userStore = useUserStore()

  const handleConfigUpdate = (data: ConfigUpdate) => {
    // 认不出来的键直接忽略：后端将来多推一个字段，不该把 store 撑出个野字段
    if (!(data.key in configStore.config)) return
    ;(configStore.config as any)[data.key] = data.value
    // getConfig() 里也是这么设的，站点改名后标签页跟着变，别只更新页面里那份
    if (data.key === "websiteName") document.title = data.value
  }

  // 初始化 WebSocket - handler 会在 onMounted 时自动添加
  const { connect, disconnect } = useConfigWebSocket(handleConfigUpdate)

  // 监听登录状态变化。后端 /ws/config 要求会话，没登录连不上；
  // 没登录的人下次刷新页面时通过 getConfig() 拿到新配置
  watch(
    () => userStore.isAuthed,
    (isAuthed) => {
      if (isAuthed) {
        connect()
      } else {
        disconnect()
      }
    },
    { immediate: true },
  )

  return {
    connect,
    disconnect,
  }
}

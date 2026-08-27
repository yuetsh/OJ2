import { useConfigStore } from "shared/store/config"
import { useUserStore } from "shared/store/user"
import {
  useConfigWebSocket,
  type ConfigUpdate,
} from "shared/composables/websocket"

/**
 * 后端推的是 options 表里的 snake_case 键（`enable_maxkb`），
 * store 里的字段是驼峰（`enableMaxkb`）—— 两边对不上，这里负责换。
 *
 * 原来是直接 `data.key in configStore.config`，snake 键永远命中不了驼峰字段，
 * 于是**一条配置都写不进去**，整个「改完不必刷新」是空转的：站点名称、页脚、
 * 班级名单、允许注册、提交列表看全部、知识库挂件，全都要刷新才生效。
 */
function toCamel(key: string) {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function useConfigUpdate() {
  const configStore = useConfigStore()
  const userStore = useUserStore()

  // 处理 WebSocket 配置更新
  const handleConfigUpdate = (data: ConfigUpdate) => {
    const field = toCamel(data.key)
    // 认不出来的键直接忽略：后端将来多推一个字段，不该把 store 撑出个野字段
    if (!(field in configStore.config)) return
    ;(configStore.config as any)[field] = data.value
    // getConfig() 里也是这么设的，站点改名后标签页跟着变，别只更新页面里那份
    if (field === "websiteName") document.title = data.value
  }

  // 初始化 WebSocket - handler 会在 onMounted 时自动添加
  const { connect, disconnect } = useConfigWebSocket(handleConfigUpdate)

  // 监听登录状态变化
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

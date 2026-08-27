import { useConfigStore } from "shared/store/config"
import { useUserStore } from "shared/store/user"

/**
 * MaxKB 知识库挂件的加载 / 卸载。
 *
 * 两个前提同时满足才加载：**已登录**（挂件本身就要登录才能用）且**后台开关打开**。
 * 任一条件变假就把脚本和它建出来的 DOM 一起撤掉。
 *
 * 脚本**只在这里注入**。原来 vite 有个 inject-maxkb 插件把 <script src> 写进
 * index.html，Vue 还没启动就已经加载执行了，后台开关根本拦不住 —— 别再加回去。
 *
 * 配置的实时推送不归这里管：App.vue 的 useConfigUpdate() 收 /ws/config 的广播、
 * 写进 configStore，下面那个 watch 自然就跟着动。这里再开一条连接是重复的，
 * 而且没登录时会撞 401（后端 /ws/config 要求会话）。
 */
export function useMaxKB() {
  const configStore = useConfigStore()
  const userStore = useUserStore()
  const isLoaded = ref(false)

  const url = import.meta.env.PUBLIC_MAXKB_URL

  const loadMaxKBScript = () => {
    // 没配地址就什么都不做。这道判断原来在 vite 插件里，插件删掉之后挪过来，
    // 否则会拿 undefined 当 src 去请求一个 /undefined
    if (!url) return
    if (!userStore.isAuthed) return
    if (!configStore.config.enableMaxkb) return

    if (document.querySelector(`script[src="${url}"]`)) {
      isLoaded.value = true
      return
    }

    const script = document.createElement("script")
    script.src = url
    script.async = true
    script.defer = true
    script.onload = () => {
      isLoaded.value = true
    }
    script.onerror = () => {
      console.error("Failed to load MaxKB script")
    }
    document.head.appendChild(script)
  }

  const removeMaxKBScript = () => {
    if (!url) return
    document.querySelector(`script[src="${url}"]`)?.remove()
    // 脚本删掉只是不再重复执行，它已经建出来的挂件 DOM 得自己收拾
    const removeElements = () => {
      document.querySelectorAll('[id^="maxkb-"]').forEach((el) => el.remove())
    }
    if (document.readyState === "complete") {
      removeElements()
    } else {
      window.addEventListener("load", removeElements, { once: true })
    }
    isLoaded.value = false
  }

  // 登录态和开关任一变化都重新判一次。immediate 是必须的：
  // 页面加载时这两个值就已经定了，不会再触发一次变化
  watch(
    () => [userStore.isAuthed, configStore.config.enableMaxkb] as const,
    ([authed, enabled]) => {
      if (authed && enabled) {
        loadMaxKBScript()
      } else {
        removeMaxKBScript()
      }
    },
    { immediate: true },
  )

  return {
    loadMaxKBScript,
    removeMaxKBScript,
    isLoaded: readonly(isLoaded),
  }
}

<script setup lang="ts">
import { darkTheme, dateZhCN, zhCN } from "naive-ui"
import "normalize.css"
import "./index.css"
import { useConfigStore } from "shared/store/config"
import { useConfigUpdate } from "shared/composables/configUpdate"
import { useMaxKB } from "shared/composables/maxkb"
import { useUserStore } from "shared/store/user"

const isDark = useDark()
const configStore = useConfigStore()
const userStore = useUserStore()

// 初始化配置和实时更新
onMounted(() => {
  configStore.getConfig()
  userStore.getMyProfile()
})

// 配置实时推送 + MaxKB 挂件。阶段 2 时因为后端还没有 /ws/config 而暂时关掉，
// 阶段 3 迁完之后一直没接回来 —— 表现是管理员改站点配置后学生要刷新才生效、
// 知识库挂件根本不出现，且没有任何报错。两者现在都走新后端的 /ws/config。
useConfigUpdate()
useMaxKB()

// 延迟加载 highlight.js，避免阻塞首屏
const hljsInstance = ref<any>(null)
const loadHighlightJS = async () => {
  if (hljsInstance.value) return hljsInstance.value

  const [hljs, c, cpp, python, java, javascript, go, sql] = await Promise.all([
    import("highlight.js/lib/core"),
    import("highlight.js/lib/languages/c"),
    import("highlight.js/lib/languages/cpp"),
    import("highlight.js/lib/languages/python"),
    import("highlight.js/lib/languages/java"),
    import("highlight.js/lib/languages/javascript"),
    import("highlight.js/lib/languages/go"),
    import("highlight.js/lib/languages/sql"),
  ]).then((modules) => modules.map((m) => m.default))

  hljs.registerLanguage("c", c)
  hljs.registerLanguage("python", python)
  hljs.registerLanguage("cpp", cpp)
  hljs.registerLanguage("java", java)
  hljs.registerLanguage("javascript", javascript)
  hljs.registerLanguage("go", go)
  hljs.registerLanguage("sql", sql)

  hljsInstance.value = hljs
  return hljs
}

// 在空闲时预加载
onMounted(() => {
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => loadHighlightJS())
  } else {
    setTimeout(() => loadHighlightJS(), 1000)
  }
})

provide("hljs", hljsInstance)
</script>

<template>
  <n-config-provider
    :theme="isDark ? darkTheme : null"
    :locale="zhCN"
    :date-locale="dateZhCN"
    :hljs="hljsInstance"
  >
    <n-dialog-provider>
      <n-message-provider>
        <router-view></router-view>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

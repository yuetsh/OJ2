<script setup lang="ts">
import { darkTheme, dateZhCN, zhCN } from "naive-ui"
import "normalize.css"
import "./index.css"
import { useConfigStore } from "shared/store/config"
import { useConfigUpdate } from "shared/composables/configUpdate"
import { useMaxKB } from "shared/composables/maxkb"
import { useUserStore } from "shared/store/user"
import { useCollabStore } from "shared/store/collab"

const isDark = useDark()
const configStore = useConfigStore()
const userStore = useUserStore()
const collabStore = useCollabStore()

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

// 课堂求助通道。和 /ws/config 一样是全局常驻的：老师可能正在后台改题时
// 收到求助，学生也要在排队期间一直挂着，所以不放在题目页里起落
watch(
  () => userStore.isAuthed,
  (isAuthed) => {
    if (isAuthed) collabStore.connect()
    else collabStore.disconnect()
  },
  { immediate: true },
)

// 延迟加载 highlight.js，避免阻塞首屏
const hljsInstance = ref<any>(null)
const loadHighlightJS = async () => {
  if (hljsInstance.value) return hljsInstance.value

  // 逐个取 .default，不要在 Promise.all 后面 map —— 那样元组会塌成
  // (HLJSApi | LanguageFn)[]，每个元素都变成联合类型，hljs 上就找不到方法了
  const [core, c, cpp, python, java, javascript, go, sql] = await Promise.all([
    import("highlight.js/lib/core"),
    import("highlight.js/lib/languages/c"),
    import("highlight.js/lib/languages/cpp"),
    import("highlight.js/lib/languages/python"),
    import("highlight.js/lib/languages/java"),
    import("highlight.js/lib/languages/javascript"),
    import("highlight.js/lib/languages/go"),
    import("highlight.js/lib/languages/sql"),
  ])
  const hljs = core.default

  hljs.registerLanguage("c", c.default)
  hljs.registerLanguage("python", python.default)
  hljs.registerLanguage("cpp", cpp.default)
  hljs.registerLanguage("java", java.default)
  hljs.registerLanguage("javascript", javascript.default)
  hljs.registerLanguage("go", go.default)
  hljs.registerLanguage("sql", sql.default)

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

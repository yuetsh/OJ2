<script setup lang="ts">
import { darkTheme, dateZhCN, zhCN } from "naive-ui"
import "normalize.css"
import "./index.css"
import { useConfigStore } from "shared/store/config"
import { useConfigUpdate } from "shared/composables/configUpdate"
import { useUserStore } from "shared/store/user"
import { useCollabStore } from "shared/store/collab"
import CollabHost from "shared/components/CollabHost.vue"

const isDark = useDark()
const configStore = useConfigStore()
const userStore = useUserStore()
const collabStore = useCollabStore()

// 初始化配置和实时更新
onMounted(() => {
  configStore.getConfig()
  userStore.getMyProfile()
})

// 配置实时推送。阶段 2 时因为后端还没有 /ws/config 而暂时关掉，阶段 3 迁完之后一直
// 没接回来 —— 表现是管理员改站点配置后学生要刷新才生效，且没有任何报错。现在走新后端的 /ws/config。
useConfigUpdate()

// 课堂求助通道。和 /ws/config 一样是全局常驻的：老师可能正在后台改题时
// 收到求助，学生也要在排队期间一直挂着，所以不放在题目页里起落。
//
// 演示模式下整个关掉。它是超管把界面伪装成学生用来投屏的，而服务端只认库里的
// 真实身份：连着的话这个人会被算进「在线老师」，学生因此拿到 pending 而不是
// no_teacher，排队等一个顶栏里根本没有求助列表的人；反过来他自己看到的求助
// 按钮点下去，服务端回的是「教师不能发起求助」。两头都不对，索性对演示模式
// 关闭这个功能（EditorToolbar.vue 的按钮同步隐藏）。
watch(
  () => userStore.isAuthed && !userStore.demoMode,
  (available) => {
    if (available) collabStore.connect()
    else collabStore.disconnect()
  },
  { immediate: true },
)

// n-code（提交详情、看代码的弹框）用的 highlight.js，空闲时再加载，不挡首屏
const hljsInstance = shallowRef<typeof import("shared/highlight").hljs>()
onMounted(() => {
  const load = async () => {
    hljsInstance.value = (await import("shared/highlight")).hljs
  }
  if ("requestIdleCallback" in window) requestIdleCallback(load)
  else setTimeout(load, 1000)
})
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
        <!-- 求助提示 / 列表 / 协作弹框。和上面那条常驻连接同级，
             这样切到 /admin（另一套布局、没有顶栏）也照常收得到 -->
        <CollabHost />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
